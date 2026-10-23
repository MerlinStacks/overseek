import type { EmailBlock } from './emailDesign';

/** Defaults shared by the inspector, editable canvas and delivery compiler. */
export function getEmailBlockPadding(block: EmailBlock): string {
    const padding = (block.props as { padding?: string }).padding;
    if (padding) return padding;
    switch (block.type) {
        case 'button': case 'divider': case 'cartLink': return '16px 0';
        case 'product': case 'newProducts': case 'orderTracking': return '18px 0';
        case 'orderSummary': case 'cartItems': case 'address': return '12px 0';
        case 'coupon': case 'review': return '18px';
        case 'deliveryEstimate': return '0';
        default: return '8px 0';
    }
}

export function getEmailBlockAlignment(block: EmailBlock): 'left' | 'center' | 'right' {
    const align = (block.props as { align?: 'left' | 'center' | 'right' }).align;
    if (align) return align;
    return ['text', 'list', 'orderSummary', 'cartItems', 'address', 'rawHtml', 'review'].includes(block.type) ? 'left' : 'center';
}

export function withEmailBlockLayout<T extends EmailBlock>(block: T): T {
    return { ...block, props: { ...block.props, padding: getEmailBlockPadding(block), align: getEmailBlockAlignment(block) } };
}

export function getEmailImageMargin(align: 'left' | 'center' | 'right' = 'center', bottom = '0'): string {
    return align === 'left' ? `0 auto ${bottom} 0` : align === 'right' ? `0 0 ${bottom} auto` : `0 auto ${bottom}`;
}
