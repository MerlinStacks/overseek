import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export const generateInvoicePDF = async (order, settings) => {
    const input = document.querySelector('.invoice-print-area .invoice-paper');

    if (!input) {
        alert("Could not find invoice element to generate PDF.");
        return;
    }

    try {
        // Temporarily make it visible for capture if it's hidden or absolute
        const originalPosition = input.style.position;
        const originalDisplay = input.style.display;

        // We rely on the fact that .invoice-print-area is in the DOM but hidden/absolute
        // html2canvas needs it to be rendered. If it's effectively invisible, it might not capture.
        // However, in our CSS, it's just z-indexed out or absolute.

        const canvas = await html2canvas(input, {
            scale: 2, // 2 is usually good for Retina. 
            logging: false,
            useCORS: true,
            backgroundColor: '#ffffff',
            windowWidth: 794, // Force typical A4 pixel width at 96 DPI (210mm approx)
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        const imgWidth = canvas.width;
        const imgHeight = canvas.height;

        // Calculate ratio to fit width
        const ratio = pdfWidth / imgWidth;
        const finalHeight = imgHeight * ratio;

        // If height exceeds one page, we might need multi-page logic, 
        // but for a simple "Download Image as PDF" this is the most robust way to keep design 1:1.
        // For true multi-page text-selectable PDF with custom design, we'd need a complex robust renderer.
        // For now, let's fit it or split pages.

        let heightLeft = finalHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, finalHeight);
        heightLeft -= pdfHeight;

        while (heightLeft > 0) {
            position = heightLeft - finalHeight; // Move up
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, finalHeight);
            heightLeft -= pdfHeight;
        }

        pdf.save(`Invoice-${order.id}.pdf`);
    } catch (error) {
        console.error("PDF Generation Error:", error);
        alert("Failed to generate PDF. check console.");
    }
};
