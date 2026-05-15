
/**
 * Invoice PDF Generator
 *
 * Primary path: HTML renderer capture (designer-accurate output).
 * Fallback path: vector/text generation when capture fails.
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { Logger } from './logger';
import { InvoiceRenderer } from '../components/invoicing/InvoiceRenderer';
import { generateVectorInvoicePDF } from './InvoiceGeneratorVector';

const ALLOW_VECTOR_FALLBACK = import.meta.env.VITE_INVOICE_ALLOW_VECTOR_FALLBACK === 'true';

/** A4 dimensions in mm */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/** Container width in px — matches InvoiceRenderer's design width (794px = ~210mm at 96dpi) */
const CONTAINER_WIDTH_PX = 794;

/** html2canvas scale factor — 2× for crisp text on retina/print */
const CAPTURE_SCALE = 2;

interface OrderData {
    number: string;
    [key: string]: unknown;
}

type InvoiceRendererProps = ComponentProps<typeof InvoiceRenderer>;
const PDF_CAPTURE_ATTR = 'data-invoice-pdf-root';

/**
 * Generates a PDF invoice that matches the designer HTML preview exactly.
 * Renders InvoiceRenderer off-screen, captures via html2canvas, paginates into A4 pages.
 */
export const generateInvoicePDF = async (
    order: OrderData,
    grid: InvoiceRendererProps['layout'],
    items: InvoiceRendererProps['items'],
    templateName: string = 'Invoice',
    settings?: InvoiceRendererProps['settings']
): Promise<void> => {
    // 1. Create hidden container — must stay within viewport for html2canvas
    //    to capture correctly. We use opacity:0 + overflow:hidden instead of
    //    left:-9999px which html2canvas cannot capture.
    const container = document.createElement('div');
    const captureId = `invoice-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    container.setAttribute(PDF_CAPTURE_ATTR, captureId);
    container.style.cssText = [
        'position: fixed',
        'left: 0',
        'top: 0',
        `width: ${CONTAINER_WIDTH_PX}px`,
        'background: white',
        'opacity: 0',
        'pointer-events: none',
        'z-index: -9999',
        'overflow: auto',
        '-webkit-font-smoothing: antialiased',
    ].join(';');
    document.body.appendChild(container);
    let root: ReturnType<typeof createRoot> | null = null;
    try {
        // 2. Render InvoiceRenderer into the container
        root = createRoot(container);
        root.render(
            createElement(InvoiceRenderer, {
                layout: grid,
                items,
                data: order,
                settings,
                readOnly: true,
                pageMode: 'single',
            })
        );

        // 3. Wait for React render to complete — React 18 batches renders,
        //    so requestAnimationFrame alone may fire before DOM is populated.
        //    Use a real delay followed by frames for layout to settle.
        await delay(500);
        await nextFrame();
        normalizeImageSources(container);
        await inlineImageSources(container);
        await waitForImages(container);
        await nextFrame();

        // Make container visible for html2canvas (it reads computed styles)
        container.style.opacity = '1';

        // Strip decorative UI styling that shouldn't appear in the PDF
        const innerDiv = container.querySelector(':scope > div') as HTMLElement;
        if (innerDiv) {
            innerDiv.style.boxShadow = 'none';
            innerDiv.style.outline = 'none';
            innerDiv.style.border = 'none';
            innerDiv.style.borderRadius = '0';
            innerDiv.style.padding = '0';
            innerDiv.style.maxWidth = 'none';
            innerDiv.style.width = `${CONTAINER_WIDTH_PX}px`;
            innerDiv.classList.remove('shadow-2xl', 'ring-1', 'rounded-sm');
        }

        // Collect safe page break points before we patch styles
        const breakPoints = collectBreakPoints(container);

        // 4. Resolve oklch() colors for html2canvas compatibility.
        //    html2canvas 1.x parses raw CSS stylesheet rules and crashes on oklch().
        //    We temporarily patch ALL stylesheets, replacing oklch→hex, then restore.
        inlineResolvedColors(container);
        const stylesheetPatches = patchStylesheets();

        let canvas: HTMLCanvasElement;
        try {
            // 5. Capture the rendered DOM with html2canvas.
            // Prefer foreignObjectRendering so the browser renders modern CSS
            // colors itself instead of html2canvas parsing Tailwind v4 tokens.
            canvas = await captureInvoiceCanvas(container, captureId);
        } finally {
            // Always restore stylesheets — even if capture throws
            restoreStylesheets(stylesheetPatches);
        }

        // 6. Create paginated PDF from the canvas with smart break points
        const pdf = createPaginatedPdf(canvas, breakPoints);
        const orderNumber = order.number || order.order_number || order.id || 'draft';
        const safeTemplateName = String(templateName || 'Invoice')
            .trim()
            .replace(/[^a-zA-Z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'Invoice';
        pdf.save(`${safeTemplateName}_${orderNumber}.pdf`);
        Logger.info('Invoice PDF renderer used', { renderer: 'designer-capture' });
    } catch (err: unknown) {
        const typedError = err instanceof Error ? err : new Error(String(err));
        const msg = typedError.message || String(err);
        Logger.warn('Designer invoice capture failed', {
            error: msg,
            stack: typedError.stack,
            vectorFallbackEnabled: ALLOW_VECTOR_FALLBACK
        });

        if (!ALLOW_VECTOR_FALLBACK) {
            throw new Error(`Invoice generation failed in canonical renderer: ${msg}`);
        }

        Logger.warn('Using non-canonical vector fallback for invoice PDF');

        try {
            await generateVectorInvoicePDF(
                order,
                grid as Array<{ i: string; x: number; y: number; w: number; h: number }>,
                items as Array<{ id?: string; type: string; content?: string; logo?: string; businessDetails?: string; style?: { fontSize?: string; fontWeight?: string; textAlign?: 'left' | 'center' | 'right' } }>,
                templateName,
                settings as Record<string, unknown> | undefined
            );
            Logger.warn('Invoice PDF renderer used', { renderer: 'vector-fallback' });
        } catch (vectorError: unknown) {
            const typedVectorError = vectorError instanceof Error ? vectorError : new Error(String(vectorError));
            const vectorMsg = typedVectorError.message || String(vectorError);
            Logger.error('Failed to generate invoice PDF (capture + vector fallback)', {
                captureError: msg,
                vectorError: vectorMsg,
                vectorStack: typedVectorError.stack
            });
            throw new Error(`Invoice generation failed: ${vectorMsg}`);
        }
    } finally {
        // Always cleanup: unmount React tree + remove container from DOM
        try { root?.unmount(); } catch { /* already unmounted or never mounted */ }
        document.body.removeChild(container);
    }
};

/**
 * Waits for every <img> in the container to finish loading.
 * Resolves immediately for already-complete images; errors are swallowed
 * so a broken logo doesn't block the entire PDF.
 */
function waitForImages(container: HTMLElement): Promise<void[]> {
    const IMAGE_TIMEOUT_MS = 5000;
    const images = container.querySelectorAll('img');
    return Promise.all(
        Array.from(images).map((img) =>
            img.complete
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                      const timer = setTimeout(resolve, IMAGE_TIMEOUT_MS);
                      img.onload = () => { clearTimeout(timer); resolve(); };
                      img.onerror = () => { clearTimeout(timer); resolve(); };
                  })
        )
    );
}

function normalizeImageSources(container: HTMLElement): void {
    const images = container.querySelectorAll('img');
    images.forEach((img) => {
        const rawSrc = img.getAttribute('src');
        if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) {
            return;
        }

        try {
            const normalized = new URL(rawSrc, window.location.origin).toString();
            img.setAttribute('src', normalized);
            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'no-referrer-when-downgrade';
            img.loading = 'eager';
            img.decoding = 'sync';
        } catch {
            // Keep original src when parsing fails
        }
    });
}

async function inlineImageSources(container: HTMLElement): Promise<void> {
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all(images.map(async (img) => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;

        try {
            const response = await fetch(src, { mode: 'cors', credentials: 'omit' });
            if (!response.ok) return;
            const blob = await response.blob();
            const dataUrl = await blobToDataUrl(blob);
            img.setAttribute('src', dataUrl);
        } catch {
            // Keep original src when CORS or fetch fails.
        }
    }));
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('Failed to read blob as data URL'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
    });
}

/** Yields two animation frames to let the browser paint and layout settle. */
function nextFrame(): Promise<void> {
    return new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
}

/** Promise-based setTimeout wrapper. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureInvoiceCanvas(container: HTMLElement, captureId: string): Promise<HTMLCanvasElement> {
    const baseOptions = {
        scale: CAPTURE_SCALE,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: CONTAINER_WIDTH_PX,
        windowWidth: CONTAINER_WIDTH_PX,
        logging: false,
        onclone: (clonedDocument: Document) => {
            patchStylesheets(clonedDocument);
            const clonedContainer = clonedDocument.querySelector(
                `[${PDF_CAPTURE_ATTR}="${captureId}"]`
            );
            if (clonedContainer instanceof HTMLElement) {
                inlineResolvedColors(clonedContainer);
                normalizeImageSources(clonedContainer);
            }
        },
    } as const;

    try {
        return await html2canvas(container, {
            ...baseOptions,
            foreignObjectRendering: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('unsupported color function')) {
            throw error;
        }

        Logger.warn('Invoice PDF foreignObject capture failed, retrying with standard renderer', { error: message });

        return await html2canvas(container, {
            ...baseOptions,
            foreignObjectRendering: false,
        });
    }
}

/**
 * Converts a modern CSS color (oklch, oklab, etc.) to a hex string using the
 * Canvas 2D API. The canvas context's fillStyle setter accepts any valid CSS color
 * and always returns a hex string (#rrggbb) when read back.
 * Returns the original value if no conversion needed or conversion fails.
 */
/** Lazy-initialized canvas context — avoids crash on SSR where document is undefined. */
const MODERN_COLOR_PATTERN = /\boklch\(|\boklab\(|\blab\(|\blch\(|\bcolor\(|\bcolor-mix\(/i;

function containsModernColorSyntax(value: string): boolean {
    return MODERN_COLOR_PATTERN.test(value);
}

function getColorConversionCtx(targetDocument: Document = document): CanvasRenderingContext2D | null {
    if (typeof targetDocument === 'undefined') {
        return null;
    }
    return targetDocument.createElement('canvas').getContext('2d');
}

function resolveColorToHex(color: string, targetDocument: Document = document): string {
    if (!color || color === 'transparent' || color === 'none' || color === 'inherit'
        || color === 'currentcolor' || color === 'initial' || color === 'unset') {
        return color;
    }
    // Only convert if it contains an unsupported color function
    if (!containsModernColorSyntax(color)) {
        return color;
    }
    try {
        const ctx = getColorConversionCtx(targetDocument);
        if (!ctx) return color;
        ctx.fillStyle = '#000000'; // Reset
        ctx.fillStyle = color;
        return ctx.fillStyle; // Returns hex like #rrggbb
    } catch {
        return color;
    }
}

/**
 * html2canvas 1.x parses raw CSS stylesheet rules from the CSSOM. It encounters
 * oklch() in the actual CSSStyleRule values and crashes. Inline style overrides
 * don't help because the parser reads stylesheets BEFORE element styles.
 *
 * Fix: Temporarily modify every CSSStyleRule property that contains oklch()
 * to its hex equivalent, capture, then restore. We store originals for rollback.
 */
interface PatchedValue {
    rule: CSSStyleRule;
    prop: string;
    original: string;
    priority: string;
}

/**
 * Recursively walks CSS rules (handles @media, @layer, @supports nesting)
 * and replaces any property value containing oklch/oklab with its hex equivalent.
 * Returns an array of patches for rollback.
 */
function patchStylesheets(targetDocument: Document = document): PatchedValue[] {
    const patches: PatchedValue[] = [];

    const walkRules = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
            // Recurse into grouped rules (@media, @supports, @layer)
            if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
                walkRules((rule as CSSGroupingRule).cssRules);
                continue;
            }
            if (!(rule instanceof CSSStyleRule)) continue;

            for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                const value = rule.style.getPropertyValue(prop);
                if (containsModernColorSyntax(value)) {
                    const priority = rule.style.getPropertyPriority(prop);
                    const resolved = resolveColorToHex(value.trim(), targetDocument);
                    if (resolved !== value.trim()) {
                        patches.push({ rule, prop, original: value, priority });
                        rule.style.setProperty(prop, resolved, priority);
                    }
                }
            }
        }
    };

    for (const sheet of Array.from(targetDocument.styleSheets)) {
        try {
            walkRules(sheet.cssRules);
        } catch {
            // Cross-origin stylesheet — cannot access rules
        }
    }
    return patches;
}

/** Restores all patched CSS rules to their original values. */
function restoreStylesheets(patches: PatchedValue[]): void {
    for (const { rule, prop, original, priority } of patches) {
        try {
            rule.style.setProperty(prop, original, priority);
        } catch {
            // Rule may have been removed — ignore
        }
    }
}

const COLOR_PROPERTIES = [
    'color', 'backgroundColor', 'borderColor',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'outlineColor', 'textDecorationColor',
] as const;

/**
 * Belt-and-suspenders: also inline resolved colors on every element.
 * This catches any oklch from computed styles that the stylesheet patch missed.
 */
function inlineResolvedColors(container: HTMLElement): void {
    const allElements = [container, ...Array.from(container.querySelectorAll('*'))] as HTMLElement[];
    const targetDocument = container.ownerDocument;
    for (const el of allElements) {
        const computed = getComputedStyle(el);
        for (const prop of COLOR_PROPERTIES) {
            const value = computed[prop];
            if (value) {
                const resolved = resolveColorToHex(value, targetDocument);
                if (resolved !== value) {
                    el.style.setProperty(prop, resolved);
                }
            }
        }
        const shadow = computed.boxShadow;
        if (shadow && shadow !== 'none' &&
            containsModernColorSyntax(shadow)) {
            el.style.boxShadow = 'none';
        }
    }
}

/**
 * Collects Y pixel positions of "safe" page break points from the rendered DOM.
 * Scans block boundaries: direct children of the content div, table rows, and
 * other block-level elements. These positions are in CSS pixels relative to
 * the container top.
 */
function collectBreakPoints(container: HTMLElement): number[] {
    const points = new Set<number>();
    const containerRect = container.getBoundingClientRect();

    // Direct children of the rendered InvoiceRenderer wrapper
    const innerDiv = container.querySelector(':scope > div') as HTMLElement;
    if (!innerDiv) return [];

    // All block-level child boundaries (each represents a section: header, customer, table, etc.)
    const scanChildren = (parent: HTMLElement, depth: number, inTableFooter = false, inTableRow = false) => {
        if (depth > 3) return; // Don't recurse too deep
        for (const child of Array.from(parent.children) as HTMLElement[]) {
            const rect = child.getBoundingClientRect();
            const bottomY = rect.bottom - containerRect.top;
            const isTableFooter = child.tagName === 'TFOOT';
            const isTableRow = child.tagName === 'TR';
            const insideFooter = inTableFooter || isTableFooter;

            // Avoid page breaks inside totals/footer sections.
            // We keep whole tfoot blocks together by only allowing break points
            // above them or after the entire table block.
            if (!insideFooter && !inTableRow) {
                points.add(Math.round(bottomY));
            }

            // Recurse into tables to get row-level break points
            if (child.tagName === 'TABLE' || child.tagName === 'TBODY') {
                scanChildren(child, depth + 1, insideFooter, false);
            }
            // Recurse into table rows to break between them
            if (child.tagName === 'TR' && !insideFooter) {
                points.add(Math.round(bottomY));
            }
            // Recurse into div containers for section-level breaks only.
            // Do not recurse into divs inside a table row, otherwise we create
            // break points inside a single line item block.
            if (child.tagName === 'DIV' && child.children.length > 0 && depth < 2 && !isTableRow && !inTableRow) {
                scanChildren(child, depth + 1, insideFooter, false);
            }

            if (isTableRow && child.children.length > 0) {
                scanChildren(child, depth + 1, insideFooter, true);
            }
        }
    };

    scanChildren(innerDiv, 0, false, false);

    return Array.from(points).sort((a, b) => a - b);
}

/**
 * Slices a tall canvas into A4-proportioned pages, preferring to break at
 * safe content boundaries (between blocks/rows) instead of cutting through text.
 */
function createPaginatedPdf(
    canvas: HTMLCanvasElement,
    breakPointsCss: number[]
): jsPDF {
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    const scaledCanvasWidth = canvas.width / CAPTURE_SCALE;
    const scaledCanvasHeight = canvas.height / CAPTURE_SCALE;

    // How many mm does 1 CSS pixel map to in the PDF
    const mmPerPx = A4_WIDTH_MM / scaledCanvasWidth;
    const totalHeightMM = scaledCanvasHeight * mmPerPx;

    if (totalHeightMM <= A4_HEIGHT_MM) {
        // Single page — content fits on one A4
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, A4_WIDTH_MM, totalHeightMM);
        return pdf;
    }

    // Convert CSS break points to canvas pixel positions (accounting for scale)
    const breakPointsCanvas = breakPointsCss.map(y => y * CAPTURE_SCALE);

    // Multi-page — slice at safe break points
    const pageHeightPx = (A4_HEIGHT_MM / mmPerPx) * CAPTURE_SCALE;
    // Allow break points within 20% above the ideal cut line
    const searchThreshold = pageHeightPx * 0.2;
    // Prefer not to split content inside a row-like block.
    // If no break exists in the threshold window, we can fall back to the last
    // known safe break before idealCut, as long as the page is not too underfilled.
    const MIN_PAGE_FILL_RATIO = 0.55;

    let yOffset = 0;
    let pageIndex = 0;

    while (yOffset < canvas.height) {
        if (pageIndex > 0) pdf.addPage();

        const idealCut = yOffset + pageHeightPx;
        let actualCut: number;

        if (idealCut >= canvas.height) {
            // Last page — take whatever remains
            actualCut = canvas.height;
        } else {
            // Find the best safe break point: closest to idealCut but not past it
            // Search range: [idealCut - threshold, idealCut]
            const searchMin = idealCut - searchThreshold;
            let bestBreak: number | null = null;
            let lastSafeBreakBeforeIdeal: number | null = null;

            for (const bp of breakPointsCanvas) {
                if (bp <= yOffset) continue;     // Already past this point
                if (bp > idealCut) break;         // Beyond the ideal cut
                lastSafeBreakBeforeIdeal = bp;
                if (bp >= searchMin) {
                    bestBreak = bp;               // Closest safe break within range
                }
            }

            if (bestBreak !== null) {
                actualCut = bestBreak;
            } else if (lastSafeBreakBeforeIdeal !== null) {
                const fallbackSliceHeight = lastSafeBreakBeforeIdeal - yOffset;
                if (fallbackSliceHeight >= (pageHeightPx * MIN_PAGE_FILL_RATIO)) {
                    actualCut = lastSafeBreakBeforeIdeal;
                } else {
                    actualCut = idealCut;
                }
            } else {
                actualCut = idealCut;
            }
        }

        const sliceHeight = actualCut - yOffset;

        // Create a full A4-height slice canvas (white-filled for short last pages)
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceHeight;
        const ctx = slice.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(
                canvas,
                0, yOffset,
                canvas.width, sliceHeight,
                0, 0,
                canvas.width, sliceHeight
            );
        }

        const sliceHeightMM = (sliceHeight / CAPTURE_SCALE) * mmPerPx;
        const imgData = slice.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, A4_WIDTH_MM, sliceHeightMM);

        // Guard against infinite loops — ensure forward progress
        yOffset = Math.max(actualCut, yOffset + 1);
        pageIndex++;
        if (pageIndex > 50) break; // Safety cap
    }

    return pdf;
}
