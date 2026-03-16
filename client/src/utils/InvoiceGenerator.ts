
/**
 * Invoice PDF Generator
 *
 * Renders the InvoiceRenderer React component into a hidden off-screen container,
 * captures it with html2canvas, and paginates into an A4 PDF via jsPDF.
 *
 * Why: This guarantees pixel-perfect match between the designer preview and
 * the generated PDF — both use the exact same InvoiceRenderer component.
 * Previously, this file had ~460 lines of duplicated rendering logic
 * (column widths, currency formatting, metadata extraction, page breaks)
 * that constantly drifted out of sync with the HTML preview.
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Logger } from './logger';
import { InvoiceRenderer } from '../components/invoicing/InvoiceRenderer';

/** A4 dimensions in mm */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/** Container width in px — matches InvoiceRenderer's design width (794px = ~210mm at 96dpi) */
const CONTAINER_WIDTH_PX = 794;

/** html2canvas scale factor — 2× for crisp text on retina/print */
const CAPTURE_SCALE = 2;

interface OrderData {
    number: string;
    [key: string]: any;
}

/**
 * Generates a PDF invoice that matches the designer HTML preview exactly.
 * Renders InvoiceRenderer off-screen, captures via html2canvas, paginates into A4 pages.
 */
export const generateInvoicePDF = async (
    order: OrderData,
    grid: any[],
    items: any[],
    _templateName: string = 'Invoice'
): Promise<void> => {
    // 1. Create hidden container — must stay within viewport for html2canvas
    //    to capture correctly. We use opacity:0 + overflow:hidden instead of
    //    left:-9999px which html2canvas cannot capture.
    const container = document.createElement('div');
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
                readOnly: true,
                pageMode: 'single',
            })
        );

        // 3. Wait for React render to complete — React 18 batches renders,
        //    so requestAnimationFrame alone may fire before DOM is populated.
        //    Use a real delay followed by frames for layout to settle.
        await delay(500);
        await nextFrame();
        await waitForImages(container);
        await nextFrame();

        // Make container visible for html2canvas (it reads computed styles)
        container.style.opacity = '1';

        // 4. Resolve oklch() colors → rgb() for html2canvas compatibility.
        //    Tailwind v4 uses oklch() which html2canvas 1.x cannot parse.
        //    getComputedStyle() returns browser-resolved rgb() values.
        resolveColorsForCapture(container);

        // 5. Strip decorative UI styling that shouldn't appear in the PDF
        //    InvoiceRenderer's readOnly container has shadow/ring/rounded for the
        //    on-screen preview, but these appear as artifacts in the captured image.
        const innerDiv = container.querySelector(':scope > div') as HTMLElement;
        if (innerDiv) {
            innerDiv.style.boxShadow = 'none';
            innerDiv.style.outline = 'none';
            innerDiv.style.border = 'none';
            innerDiv.style.borderRadius = '0';
            // Remove Tailwind ring (uses box-shadow with --tw-ring-* vars)
            innerDiv.classList.remove('shadow-2xl', 'ring-1', 'rounded-sm');
        }

        // 6. Collect safe page break points from the rendered DOM before capture
        //    These are Y positions (in CSS px) of block/row boundaries where
        //    we can safely split pages without cutting through text.
        const breakPoints = collectBreakPoints(container);

        // 7. Capture the rendered DOM with html2canvas
        const canvas = await html2canvas(container, {
            scale: CAPTURE_SCALE,
            useCORS: true,
            // allowTaint must be true — the logo image may not have CORS headers,
            // and false causes html2canvas to throw on any cross-origin resource.
            allowTaint: true,
            backgroundColor: '#ffffff',
            width: CONTAINER_WIDTH_PX,
            windowWidth: CONTAINER_WIDTH_PX,
            logging: false,
        });

        // 8. Create paginated PDF from the canvas with smart break points
        const pdf = createPaginatedPdf(canvas, breakPoints);
        pdf.save(`Invoice_${order.number}.pdf`);
    } catch (err: any) {
        const msg = err?.message || String(err);
        Logger.error('Failed to generate invoice PDF', { error: msg, stack: err?.stack });
        throw new Error(`Invoice generation failed: ${msg}`);
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
    const images = container.querySelectorAll('img');
    return Promise.all(
        Array.from(images).map((img) =>
            img.complete
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                      img.onload = () => resolve();
                      img.onerror = () => resolve(); // Don't block on failed images
                  })
        )
    );
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

/**
 * Resolves all oklch() (and other modern CSS color functions) to rgb() on every
 * element in the tree. html2canvas 1.x cannot parse oklch(), which Tailwind v4
 * uses extensively. The browser's getComputedStyle() returns resolved rgb() values
 * regardless of the original CSS format, so we bake them into inline styles.
 */
const COLOR_PROPERTIES = [
    'color',
    'backgroundColor',
    'borderColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'outlineColor',
    'textDecorationColor',
] as const;

function resolveColorsForCapture(container: HTMLElement): void {
    const elements = container.querySelectorAll('*');
    elements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const computed = getComputedStyle(htmlEl);
        for (const prop of COLOR_PROPERTIES) {
            const value = computed[prop];
            // Only override if the computed value contains an unsupported function
            if (value && (value.includes('oklch') || value.includes('oklab') || value.includes('lab(') || value.includes('lch('))) {
                htmlEl.style[prop as any] = value;
            }
        }
        // Also resolve box-shadow which may contain oklch colors
        const shadow = computed.boxShadow;
        if (shadow && shadow !== 'none' && (shadow.includes('oklch') || shadow.includes('oklab'))) {
            htmlEl.style.boxShadow = shadow;
        }
    });
    // Also resolve on the container itself
    const computed = getComputedStyle(container);
    for (const prop of COLOR_PROPERTIES) {
        const value = computed[prop];
        if (value && (value.includes('oklch') || value.includes('oklab'))) {
            container.style[prop as any] = value;
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
    const scanChildren = (parent: HTMLElement, depth: number) => {
        if (depth > 3) return; // Don't recurse too deep
        for (const child of Array.from(parent.children) as HTMLElement[]) {
            const rect = child.getBoundingClientRect();
            const bottomY = rect.bottom - containerRect.top;
            points.add(Math.round(bottomY));

            // Recurse into tables to get row-level break points
            if (child.tagName === 'TABLE' || child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
                scanChildren(child, depth + 1);
            }
            // Recurse into table rows to break between them
            if (child.tagName === 'TR') {
                points.add(Math.round(bottomY));
            }
            // Recurse into div containers (order_table wrapper, totals, etc.)
            if (child.tagName === 'DIV' && child.children.length > 0 && depth < 2) {
                scanChildren(child, depth + 1);
            }
        }
    };

    scanChildren(innerDiv, 0);

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
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_MM, totalHeightMM);
        return pdf;
    }

    // Convert CSS break points to canvas pixel positions (accounting for scale)
    const breakPointsCanvas = breakPointsCss.map(y => y * CAPTURE_SCALE);

    // Multi-page — slice at safe break points
    const pageHeightPx = (A4_HEIGHT_MM / mmPerPx) * CAPTURE_SCALE;
    // Allow break points within 20% above the ideal cut line
    const searchThreshold = pageHeightPx * 0.2;

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

            for (const bp of breakPointsCanvas) {
                if (bp <= yOffset) continue;     // Already past this point
                if (bp > idealCut) break;         // Beyond the ideal cut
                if (bp >= searchMin) {
                    bestBreak = bp;               // Closest safe break within range
                }
            }

            // Use the safe break or fall back to the exact page height
            actualCut = bestBreak ?? idealCut;
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
        const imgData = slice.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_MM, sliceHeightMM);

        yOffset = actualCut;
        pageIndex++;
    }

    return pdf;
}

