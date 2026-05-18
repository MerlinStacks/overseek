import type { EmailBlock, EmailDesignTheme } from '../../../lib/emailDesignerV2';

export function LiveBlock({ block, theme, onUpdate }: { block: EmailBlock; theme: EmailDesignTheme; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    if (block.type === 'siteLogo') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center' }}>{block.props.src ? <img src={block.props.src} alt={block.props.alt || block.props.fallbackText || 'Logo'} width={block.props.width || 160} style={{ display: 'block', maxWidth: '100%', height: 'auto', border: 0, margin: '0 auto' }} /> : <h1 style={{ margin: 0, color: theme.textColor, fontSize: 28, lineHeight: 1.25 }}>{block.props.fallbackText || block.props.alt || 'Your Store'}</h1>}</div>;
    }
    if (block.type === 'text') {
        return <div contentEditable suppressContentEditableWarning onBlur={(event) => onUpdate((draft) => { if (draft.type === 'text') draft.props.html = event.currentTarget.innerHTML; })} dangerouslySetInnerHTML={{ __html: block.props.html }} style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'left', fontSize: block.props.size || 15, lineHeight: block.props.lineHeight || 1.6, color: block.props.color || theme.textColor, outline: 'none' }} />;
    }
    if (block.type === 'button') {
        return <div style={{ padding: block.props.padding || '16px 0', textAlign: block.props.align || 'center' }}><span contentEditable suppressContentEditableWarning onBlur={(event) => onUpdate((draft) => { if (draft.type === 'button') draft.props.label = event.currentTarget.textContent || 'Button'; })} style={{ display: 'inline-block', background: block.props.backgroundColor || theme.primaryColor, color: block.props.color || '#ffffff', borderRadius: block.props.borderRadius ?? theme.borderRadius, padding: '12px 20px', fontWeight: 700, fontSize: 14, outline: 'none' }}>{block.props.label || 'Button'}</span></div>;
    }
    if (block.type === 'list') {
        const Tag = block.props.ordered ? 'ol' : 'ul';
        return <div style={{ padding: block.props.padding || '8px 0', color: block.props.color || theme.textColor }}><Tag style={{ margin: 0, paddingLeft: 22, lineHeight: 1.6 }}>{block.props.items.map((item, index) => <li key={index} contentEditable suppressContentEditableWarning onBlur={(event) => onUpdate((draft) => { if (draft.type === 'list') draft.props.items[index] = event.currentTarget.textContent || ''; })} style={{ margin: '0 0 6px', outline: 'none' }}>{item}</li>)}</Tag></div>;
    }
    if (block.type === 'image') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center' }}><img src={block.props.src} alt={block.props.alt || ''} width={block.props.width || 560} style={{ display: 'block', maxWidth: '100%', height: 'auto', border: 0, margin: '0 auto' }} /></div>;
    }
    if (block.type === 'coupon') {
        return <div style={{ padding: 18, margin: '8px 0', background: '#eef2ff', border: `1px dashed ${theme.primaryColor}`, borderRadius: theme.borderRadius, textAlign: 'center' }}><p contentEditable suppressContentEditableWarning onBlur={(event) => onUpdate((draft) => { if (draft.type === 'coupon') draft.props.headline = event.currentTarget.textContent || ''; })} style={{ margin: '0 0 6px', color: theme.textColor, fontSize: 18, fontWeight: 700, outline: 'none' }}>{block.props.headline}</p><p style={{ margin: '0 0 8px', color: theme.primaryColor, fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{block.props.code || '{{coupon.code}}'}</p><p style={{ margin: 0, color: theme.mutedTextColor, lineHeight: 1.5 }}>{block.props.description || '{{coupon.description}}'}</p></div>;
    }
    if (block.type === 'menu' || block.type === 'social') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 14, lineHeight: 1.5 }}>{block.props.links.map((link, index) => <span key={`${link.label}-${index}`} contentEditable={block.type === 'menu'} suppressContentEditableWarning onBlur={(event) => onUpdate((draft) => { if (draft.type === block.type) draft.props.links[index].label = event.currentTarget.textContent || link.label; })} style={block.type === 'social' ? { display: 'inline-block', margin: '0 6px', width: 34, height: 34, lineHeight: '34px', borderRadius: 999, background: block.props.color || theme.primaryColor, color: '#ffffff', textAlign: 'center', fontWeight: 700, fontSize: 13, outline: 'none' } : { display: 'inline-block', margin: '0 10px', color: block.props.color || theme.primaryColor, fontWeight: 600, outline: 'none' }}>{block.type === 'social' ? getSocialInitial(link.label) : link.label}</span>)}</div>;
    }
    if (block.type === 'footer') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 12, lineHeight: 1.6, color: block.props.color || theme.mutedTextColor }}><p contentEditable suppressContentEditableWarning onBlur={(event) => onUpdate((draft) => { if (draft.type === 'footer') draft.props.text = event.currentTarget.textContent || ''; })} style={{ margin: 0, outline: 'none' }}>{block.props.text}</p><span style={{ color: theme.primaryColor }}>{block.props.unsubscribeLabel || 'Unsubscribe'}</span></div>;
    }
    if (block.type === 'divider') return <div style={{ padding: block.props.padding || '16px 0' }}><div style={{ borderTop: `1px solid ${block.props.color || '#e2e8f0'}`, fontSize: 0, lineHeight: 0 }}>&nbsp;</div></div>;
    if (block.type === 'spacer') return <div style={{ height: block.props.height, lineHeight: `${block.props.height}px`, fontSize: block.props.height }}>&nbsp;</div>;
    if (block.type === 'product') {
        const name = block.props.productName || 'Select a product';
        const image = block.props.productImage || '';
        const price = block.props.productPrice || '';
        const description = block.props.productDescription || 'Choose a WooCommerce product in block settings.';
        return <div style={{ padding: '18px 0', textAlign: 'center' }}>{block.props.showImage && image && <img src={image} alt={name} width="220" style={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 10, margin: '0 auto 14px' }} />}<h3 style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 20, lineHeight: 1.3 }}>{name}</h3>{block.props.showDescription && <p style={{ margin: '0 0 10px', color: '#64748b', lineHeight: 1.6 }}>{description}</p>}{block.props.showPrice && price && <p style={{ margin: '0 0 14px', color: theme.primaryColor, fontWeight: 700 }}>{price}</p>}<span style={{ display: 'inline-block', background: theme.primaryColor, color: '#ffffff', borderRadius: theme.borderRadius, padding: '10px 16px', fontWeight: 700 }}>{block.props.buttonLabel || 'View Product'}</span></div>;
    }
    if (block.type === 'orderSummary') return <div style={{ padding: '12px 0' }}><h3 style={{ margin: '0 0 12px', color: theme.textColor, fontSize: 18 }}>{block.props.heading || 'Order summary'}</h3><div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, color: theme.mutedTextColor }}>{'{{order.itemsTable}}'}</div>{block.props.showTotals && <p style={{ textAlign: 'right', fontWeight: 700, color: theme.textColor }}>Total: {'{{order.total}}'}</p>}</div>;
    if (block.type === 'address') return <div style={{ padding: '12px 0' }}><h3 style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 16 }}>{block.props.title}</h3><p style={{ margin: 0, color: theme.mutedTextColor, lineHeight: 1.6 }}>{block.props.source === 'shipping' ? '{{order.shippingAddress}}' : '{{order.billingAddress}}'}</p></div>;
    return <div dangerouslySetInnerHTML={{ __html: block.props.html }} />;
}

function getSocialInitial(label: string): string {
    const normalized = label.trim().toLowerCase();
    if (normalized.includes('facebook')) return 'f';
    if (normalized.includes('instagram')) return 'IG';
    if (normalized.includes('tiktok')) return 'TT';
    if (normalized.includes('youtube')) return 'YT';
    if (normalized.includes('x') || normalized.includes('twitter')) return 'X';
    if (normalized.includes('linkedin')) return 'in';
    return label.trim().slice(0, 2).toUpperCase() || 'S';
}
