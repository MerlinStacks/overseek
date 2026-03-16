
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
import { flushSync } from 'react-dom';
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
    // 1. Create off-screen container matching A4 width
    const container = document.createElement('div');
    container.style.cssText = [
        'position: fixed',
        'left: -9999px',
        'top: 0',
        `width: ${CONTAINER_WIDTH_PX}px`,
        'background: white',
        'z-index: -1',
        // Ensure text renders at print quality
        '-webkit-font-smoothing: antialiased',
    ].join(';');
    document.body.appendChild(container);


    let root: ReturnType<typeof createRoot> | null = null;
    try {
        // 2. Render InvoiceRenderer synchronously into the container
        root = createRoot(container);
        flushSync(() => {
            root!.render(
                createElement(InvoiceRenderer, {
                    layout: grid,
                    items,
                    data: order,
                    readOnly: true,
                    pageMode: 'single',
                })
            );
        });

        // 3. Wait for all images (logo, etc.) to finish loading
        await waitForImages(container);

        // 4. Extra animation frame for layout to fully settle
        await nextFrame();

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

        // 6. Capture the rendered DOM with html2canvas
        const canvas = await html2canvas(container, {
            scale: CAPTURE_SCALE,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            width: CONTAINER_WIDTH_PX,
            windowWidth: CONTAINER_WIDTH_PX,
        });

        // 7. Create paginated PDF from the canvas
        const pdf = createPaginatedPdf(canvas);
        pdf.save(`Invoice_${order.number}.pdf`);
    } catch (err) {
        Logger.error('Failed to generate invoice PDF', { error: err });
        throw err;
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

/**
 * Slices a tall canvas into A4-proportioned pages and builds a jsPDF document.
 * Each page is extracted as a separate canvas slice to avoid image distortion.
 */
function createPaginatedPdf(canvas: HTMLCanvasElement): jsPDF {
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

    // Multi-page — slice canvas into A4-height chunks
    const pageHeightPx = (A4_HEIGHT_MM / mmPerPx) * CAPTURE_SCALE;
    let yOffset = 0;
    let pageIndex = 0;

    while (yOffset < canvas.height) {
        if (pageIndex > 0) pdf.addPage();

        const sliceHeight = Math.min(pageHeightPx, canvas.height - yOffset);

        // Create a slice canvas for this page
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceHeight;
        const ctx = slice.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(
                canvas,
                0, yOffset,          // Source x, y
                canvas.width, sliceHeight,  // Source width, height
                0, 0,                // Destination x, y
                canvas.width, sliceHeight   // Destination width, height
            );
        }

        const sliceHeightMM = (sliceHeight / CAPTURE_SCALE) * mmPerPx;
        const imgData = slice.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_MM, sliceHeightMM);

        yOffset += pageHeightPx;
        pageIndex++;
    }

    return pdf;
}
