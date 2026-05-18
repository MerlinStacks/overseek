import { Box, Code2, ImageIcon, List, Menu, Minus, PanelTop, RectangleHorizontal, Share2, Smartphone, Ticket, Type } from 'lucide-react';
import { createEmailDesignId, type EmailBlock } from '../../../lib/emailDesignerV2';

export type PaletteKey = 'siteLogo' | 'text' | 'list' | 'button' | 'image' | 'divider' | 'menu' | 'social' | 'rawHtml' | 'footer' | 'product' | 'coupon';

export interface PaletteItem {
    key: PaletteKey;
    label: string;
    group: 'General' | 'WooCommerce';
    icon: typeof Type;
}

export const paletteItems: PaletteItem[] = [
    { key: 'siteLogo', label: 'Site Logo', group: 'General', icon: PanelTop },
    { key: 'text', label: 'Text', group: 'General', icon: Type },
    { key: 'list', label: 'List', group: 'General', icon: List },
    { key: 'button', label: 'Button', group: 'General', icon: RectangleHorizontal },
    { key: 'image', label: 'Image', group: 'General', icon: ImageIcon },
    { key: 'divider', label: 'Divider', group: 'General', icon: Minus },
    { key: 'menu', label: 'Menu', group: 'General', icon: Menu },
    { key: 'social', label: 'Social', group: 'General', icon: Share2 },
    { key: 'rawHtml', label: 'HTML', group: 'General', icon: Code2 },
    { key: 'footer', label: 'Footer', group: 'General', icon: Smartphone },
    { key: 'product', label: 'Product', group: 'WooCommerce', icon: Box },
    { key: 'coupon', label: 'Coupon', group: 'WooCommerce', icon: Ticket },
];

export const defaultSocialLinks = [{ label: 'Facebook', href: '#' }, { label: 'Instagram', href: '#' }, { label: 'TikTok', href: '#' }];

export const createBlock = (type: EmailBlock['type']): EmailBlock => {
    const id = createEmailDesignId(type);
    if (type === 'siteLogo') return { id, type, props: { src: '', alt: 'Site logo', width: 160, align: 'center', fallbackText: 'Your Store' } };
    if (type === 'text') return { id, type, props: { html: '<p>Add your copy here.</p>', align: 'left', size: 15, lineHeight: 1.6 } };
    if (type === 'image') return { id, type, props: { src: 'https://via.placeholder.com/560x260?text=Image', alt: 'Email image', width: 560, align: 'center' } };
    if (type === 'button') return { id, type, props: { label: 'Shop Now', href: '{{store_url}}', align: 'center' } };
    if (type === 'list') return { id, type, props: { items: ['First benefit', 'Second benefit', 'Third benefit'], ordered: false } };
    if (type === 'divider') return { id, type, props: { color: '#e2e8f0', padding: '16px 0' } };
    if (type === 'spacer') return { id, type, props: { height: 24 } };
    if (type === 'product') return { id, type, props: { showImage: true, showDescription: true, showPrice: true, buttonLabel: 'View Product', buttonHref: '{{store_url}}' } };
    if (type === 'orderSummary') return { id, type, props: { heading: 'Order summary', showTotals: true } };
    if (type === 'address') return { id, type, props: { title: 'Shipping address', source: 'shipping' } };
    if (type === 'coupon') return { id, type, props: { headline: 'Your exclusive offer', code: '{{coupon.code}}', description: '{{coupon.description}}' } };
    if (type === 'menu') return { id, type, props: { links: [{ label: 'Shop', href: '{{store_url}}' }, { label: 'Account', href: '{{store_url}}/account' }, { label: 'Contact', href: '{{store_url}}/contact' }], align: 'center' } };
    if (type === 'social') return { id, type, props: { links: defaultSocialLinks, align: 'center' } };
    if (type === 'footer') return { id, type, props: { text: 'You are receiving this email from Your Store.', unsubscribeLabel: 'Unsubscribe', unsubscribeUrl: '{{unsubscribe_url}}', align: 'center' } };
    return { id, type: 'rawHtml', props: { html: '<div style="padding:16px;">Custom HTML</div>' } };
};

export const createPaletteBlock = (key: PaletteKey, accountName: string, logoUrl = '', socialLinks = defaultSocialLinks): EmailBlock => {
    if (key === 'siteLogo') {
        return { id: createEmailDesignId('siteLogo'), type: 'siteLogo', props: { src: logoUrl, alt: `${accountName} logo`, width: 160, align: 'center', fallbackText: accountName } };
    }
    if (key === 'list') return createBlock('list');
    if (key === 'menu') return createBlock('menu');
    if (key === 'social') {
        const usableSocialLinks = socialLinks.filter((link) => link.label.trim() && link.href.trim());
        return { id: createEmailDesignId('social'), type: 'social', props: { links: usableSocialLinks.length ? usableSocialLinks : defaultSocialLinks, align: 'center' } };
    }
    if (key === 'footer') return { id: createEmailDesignId('footer'), type: 'footer', props: { text: `You are receiving this email from ${accountName}.`, unsubscribeLabel: 'Unsubscribe', unsubscribeUrl: '{{unsubscribe_url}}', align: 'center' } };
    if (key === 'rawHtml') return createBlock('rawHtml');
    return createBlock(key);
};
