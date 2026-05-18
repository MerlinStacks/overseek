export type EmailDeviceVisibility = 'all' | 'desktop' | 'mobile';
export type EmailStackMode = 'stack' | 'reverse' | 'none';

export interface EmailDesignV2Envelope {
    engine: 'overseek-v2';
    version: 1;
    document: EmailDesignV2Document;
}

export interface EmailDesignV2Document {
    meta: {
        title: string;
        previewText?: string;
        category?: 'MARKETING' | 'TRANSACTIONAL';
    };
    theme: EmailDesignTheme;
    sections: EmailSection[];
}

export interface EmailDesignTheme {
    backgroundColor: string;
    contentBackgroundColor: string;
    textColor: string;
    mutedTextColor: string;
    primaryColor: string;
    fontFamily: string;
    contentWidth: number;
    borderRadius: number;
}

export interface EmailSection {
    id: string;
    name?: string;
    backgroundColor?: string;
    padding?: string;
    visibility?: EmailDeviceVisibility;
    stackMode?: EmailStackMode;
    columns: EmailColumn[];
}

export interface EmailColumn {
    id: string;
    width: number;
    blocks: EmailBlock[];
}

export type EmailBlock =
    | SiteLogoBlock
    | TextBlock
    | ImageBlock
    | ButtonBlock
    | ListBlock
    | DividerBlock
    | SpacerBlock
    | ProductBlock
    | OrderSummaryBlock
    | AddressBlock
    | CouponBlock
    | MenuBlock
    | SocialBlock
    | FooterBlock
    | RawHtmlBlock;

interface BaseBlock {
    id: string;
    visibility?: EmailDeviceVisibility;
}

export interface TextBlock extends BaseBlock {
    type: 'text';
    props: {
        html: string;
        align?: 'left' | 'center' | 'right';
        size?: number;
        lineHeight?: number;
        color?: string;
        padding?: string;
    };
}

export interface SiteLogoBlock extends BaseBlock {
    type: 'siteLogo';
    props: {
        src: string;
        alt: string;
        width?: number;
        align?: 'left' | 'center' | 'right';
        fallbackText?: string;
        padding?: string;
    };
}

export interface ImageBlock extends BaseBlock {
    type: 'image';
    props: {
        src: string;
        alt: string;
        href?: string;
        width?: number;
        align?: 'left' | 'center' | 'right';
        padding?: string;
    };
}

export interface ButtonBlock extends BaseBlock {
    type: 'button';
    props: {
        label: string;
        href: string;
        align?: 'left' | 'center' | 'right';
        backgroundColor?: string;
        color?: string;
        padding?: string;
        borderRadius?: number;
    };
}

export interface ListBlock extends BaseBlock {
    type: 'list';
    props: {
        items: string[];
        ordered?: boolean;
        color?: string;
        padding?: string;
    };
}

export interface DividerBlock extends BaseBlock {
    type: 'divider';
    props: {
        color?: string;
        padding?: string;
    };
}

export interface SpacerBlock extends BaseBlock {
    type: 'spacer';
    props: {
        height: number;
    };
}

export interface ProductBlock extends BaseBlock {
    type: 'product';
    props: {
        productId?: string;
        productWooId?: number;
        productName?: string;
        productImage?: string;
        productPrice?: string;
        productDescription?: string;
        productUrl?: string;
        showImage: boolean;
        showDescription: boolean;
        showPrice: boolean;
        buttonLabel: string;
        buttonHref: string;
    };
}

export interface OrderSummaryBlock extends BaseBlock {
    type: 'orderSummary';
    props: {
        heading: string;
        showTotals: boolean;
    };
}

export interface AddressBlock extends BaseBlock {
    type: 'address';
    props: {
        title: string;
        source: 'billing' | 'shipping';
    };
}

export interface CouponBlock extends BaseBlock {
    type: 'coupon';
    props: {
        headline: string;
        code: string;
        description: string;
    };
}

export interface MenuBlock extends BaseBlock {
    type: 'menu';
    props: {
        links: Array<{ label: string; href: string }>;
        align?: 'left' | 'center' | 'right';
        color?: string;
        padding?: string;
    };
}

export interface SocialBlock extends BaseBlock {
    type: 'social';
    props: {
        links: Array<{ label: string; href: string }>;
        align?: 'left' | 'center' | 'right';
        color?: string;
        padding?: string;
    };
}

export interface FooterBlock extends BaseBlock {
    type: 'footer';
    props: {
        text: string;
        unsubscribeLabel: string;
        unsubscribeUrl: string;
        align?: 'left' | 'center' | 'right';
        color?: string;
        padding?: string;
    };
}

export interface RawHtmlBlock extends BaseBlock {
    type: 'rawHtml';
    props: {
        html: string;
        migrationWarning?: string;
    };
}

export const isEmailDesignV2 = (value: unknown): value is EmailDesignV2Envelope => {
    const candidate = value as Partial<EmailDesignV2Envelope> | null;
    return Boolean(candidate && candidate.engine === 'overseek-v2' && candidate.version === 1 && candidate.document);
};

export const createEmailDesignId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function createDefaultEmailDesignV2(options?: {
    title?: string;
    previewText?: string;
    primaryColor?: string;
    logoUrl?: string;
    appName?: string;
}): EmailDesignV2Envelope {
    const primaryColor = options?.primaryColor || '#4f46e5';
    const appName = options?.appName || 'Your Store';
    const logoUrl = options?.logoUrl || '';

    return {
        engine: 'overseek-v2',
        version: 1,
        document: {
            meta: {
                title: options?.title || '',
                previewText: options?.previewText || '',
                category: 'MARKETING',
            },
            theme: {
                backgroundColor: '#f1f5f9',
                contentBackgroundColor: '#ffffff',
                textColor: '#0f172a',
                mutedTextColor: '#64748b',
                primaryColor,
                fontFamily: 'Arial, Helvetica, sans-serif',
                contentWidth: 640,
                borderRadius: 14,
            },
            sections: [
                {
                    id: createEmailDesignId('section'),
                    name: 'Header',
                    backgroundColor: '#ffffff',
                    padding: '24px 28px 12px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{
                        id: createEmailDesignId('column'),
                        width: 100,
                        blocks: logoUrl ? [{
                            id: createEmailDesignId('image'),
                            type: 'siteLogo',
                            props: { src: logoUrl, alt: `${appName} logo`, width: 160, align: 'center', fallbackText: appName },
                        }] : [{
                            id: createEmailDesignId('text'),
                            type: 'text',
                            props: { html: `<h1>${escapeHtml(appName)}</h1>`, align: 'center', size: 28, lineHeight: 1.25 },
                        }],
                    }],
                },
                {
                    id: createEmailDesignId('section'),
                    name: 'Hero',
                    backgroundColor: '#ffffff',
                    padding: '18px 28px 28px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{
                        id: createEmailDesignId('column'),
                        width: 100,
                        blocks: [{
                            id: createEmailDesignId('text'),
                            type: 'text',
                            props: {
                                html: '<h2>Big news from {{store_url}}</h2><p>Write a clear, concise message for your customers. Keep the call to action easy to spot.</p>',
                                align: 'center',
                                size: 16,
                                lineHeight: 1.65,
                            },
                        }, {
                            id: createEmailDesignId('button'),
                            type: 'button',
                            props: { label: 'Shop Now', href: '{{store_url}}', align: 'center' },
                        }],
                    }],
                },
                {
                    id: createEmailDesignId('section'),
                    name: 'Footer',
                    backgroundColor: '#f8fafc',
                    padding: '18px 28px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{
                        id: createEmailDesignId('column'),
                        width: 100,
                        blocks: [{
                            id: createEmailDesignId('text'),
                            type: 'text',
                            props: {
                                html: `<p>You are receiving this email from ${escapeHtml(appName)}.<br /><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`,
                                align: 'center',
                                size: 12,
                                color: '#64748b',
                                lineHeight: 1.6,
                            },
                        }],
                    }],
                },
            ],
        },
    };
}

export function createEmailDesignV2FromUnknown(value: unknown, options?: {
    title?: string;
    previewText?: string;
    primaryColor?: string;
    logoUrl?: string;
    appName?: string;
}): EmailDesignV2Envelope {
    if (isEmailDesignV2(value)) {
        return {
            ...value,
            document: {
                ...value.document,
                meta: {
                    ...value.document.meta,
                    title: value.document.meta.title || options?.title || '',
                    previewText: value.document.meta.previewText || options?.previewText || '',
                },
            },
        };
    }

    const migrated = migrateUnlayerDesign(value, options);
    if (migrated) return migrated;

    return createDefaultEmailDesignV2(options);
}

function migrateUnlayerDesign(value: unknown, options?: {
    title?: string;
    previewText?: string;
    primaryColor?: string;
    logoUrl?: string;
    appName?: string;
}): EmailDesignV2Envelope | null {
    const source = value as { body?: { rows?: unknown[]; values?: Record<string, unknown> } } | null;
    const rows = source?.body?.rows;
    if (!Array.isArray(rows)) return null;

    const base = createDefaultEmailDesignV2(options);
    const bodyValues = source?.body?.values || {};
    const fontValue = bodyValues.fontFamily as { value?: string } | undefined;

    base.document.theme.backgroundColor = typeof bodyValues.backgroundColor === 'string' ? bodyValues.backgroundColor : base.document.theme.backgroundColor;
    base.document.theme.fontFamily = fontValue?.value || base.document.theme.fontFamily;
    base.document.sections = rows.map((row, rowIndex) => migrateUnlayerRow(row, base.document.theme, rowIndex));

    if (base.document.sections.length === 0) return null;
    return base;
}

function migrateUnlayerRow(row: unknown, theme: EmailDesignTheme, rowIndex: number): EmailSection {
    const rowValue = row as { id?: string; columns?: unknown[]; values?: Record<string, unknown> };
    const columns = Array.isArray(rowValue.columns) ? rowValue.columns : [];
    const width = columns.length > 0 ? Math.floor(100 / columns.length) : 100;

    return {
        id: rowValue.id || createEmailDesignId('section'),
        name: `Migrated section ${rowIndex + 1}`,
        backgroundColor: typeof rowValue.values?.backgroundColor === 'string' ? rowValue.values.backgroundColor : theme.contentBackgroundColor,
        padding: typeof rowValue.values?.padding === 'string' ? rowValue.values.padding : '0',
        visibility: 'all',
        stackMode: 'stack',
        columns: columns.length > 0 ? columns.map((column) => migrateUnlayerColumn(column, width)) : [{
            id: createEmailDesignId('column'),
            width: 100,
            blocks: [],
        }],
    };
}

function migrateUnlayerColumn(column: unknown, width: number): EmailColumn {
    const columnValue = column as { id?: string; contents?: unknown[] };
    const contents = Array.isArray(columnValue.contents) ? columnValue.contents : [];
    return {
        id: columnValue.id || createEmailDesignId('column'),
        width,
        blocks: contents.map(migrateUnlayerContent),
    };
}

function migrateUnlayerContent(content: unknown): EmailBlock {
    const contentValue = content as { id?: string; type?: string; values?: Record<string, unknown> };
    const values = contentValue.values || {};
    const id = contentValue.id || createEmailDesignId(contentValue.type || 'block');

    if (contentValue.type === 'text') {
        return {
            id,
            type: 'text',
            props: {
                html: typeof values.text === 'string' ? values.text : '<p>Migrated text</p>',
                align: parseAlign(values.align),
                size: parseNumber(values.fontSize, 15),
                lineHeight: parseNumber(values.lineHeight, 1.6),
                color: typeof values.color === 'string' ? values.color : undefined,
                padding: typeof values.padding === 'string' ? values.padding : undefined,
            },
        };
    }

    if (contentValue.type === 'image') {
        const src = values.src as { url?: string } | undefined;
        return {
            id,
            type: 'image',
            props: {
                src: src?.url || 'https://via.placeholder.com/560x260?text=Image',
                alt: typeof values.altText === 'string' ? values.altText : 'Image',
                href: typeof values.href === 'string' ? values.href : undefined,
                width: parseNumber(values.width, 560),
                align: parseAlign(values.align) || 'center',
                padding: typeof values.padding === 'string' ? values.padding : undefined,
            },
        };
    }

    if (contentValue.type === 'button') {
        return {
            id,
            type: 'button',
            props: {
                label: typeof values.text === 'string' ? stripTags(values.text) : 'Button',
                href: typeof values.href === 'string' ? values.href : '{{store_url}}',
                align: parseAlign(values.align) || 'center',
                backgroundColor: typeof values.backgroundColor === 'string' ? values.backgroundColor : undefined,
                padding: typeof values.padding === 'string' ? values.padding : undefined,
                borderRadius: parseNumber(values.borderRadius, undefined),
            },
        };
    }

    if (contentValue.type === 'divider') {
        return {
            id,
            type: 'divider',
            props: {
                color: typeof values.borderColor === 'string' ? values.borderColor : '#e2e8f0',
                padding: typeof values.padding === 'string' ? values.padding : undefined,
            },
        };
    }

    return {
        id,
        type: 'rawHtml',
        props: {
            html: `<div style="padding:16px;border:1px dashed #cbd5e1;color:#475569;font-family:Arial,sans-serif;">Unsupported migrated Unlayer block: ${escapeHtml(contentValue.type || 'unknown')}</div>`,
            migrationWarning: `Unsupported Unlayer block type: ${contentValue.type || 'unknown'}`,
        },
    };
}

function parseAlign(value: unknown): 'left' | 'center' | 'right' | undefined {
    return value === 'left' || value === 'center' || value === 'right' ? value : undefined;
}

function parseNumber(value: unknown, fallback: number | undefined): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return fallback;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTags(value: string): string {
    return value.replace(/<[^>]*>/g, '').trim();
}

export function compileEmailDesignV2(envelope: EmailDesignV2Envelope): string {
    const { document } = envelope;
    const theme = document.theme;
    const previewText = document.meta.previewText
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(document.meta.previewText)}</div>`
        : '';
    const sectionHtml = document.sections.map((section) => renderSection(section, theme)).join('');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(document.meta.title || 'Email')}</title>
  <style>
    @media only screen and (max-width: 640px) {
      .os-mobile-hidden { display: none !important; }
      .os-mobile-block { display: block !important; width: 100% !important; }
      .os-mobile-reverse { display: table-header-group !important; }
    }
    @media only screen and (min-width: 641px) {
      .os-desktop-hidden { display: none !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${theme.backgroundColor};font-family:${theme.fontFamily};color:${theme.textColor};">
  ${previewText}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.backgroundColor};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${theme.contentWidth}px;background:${theme.contentBackgroundColor};border-radius:${theme.borderRadius}px;overflow:hidden;">
          ${sectionHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderSection(section: EmailSection, theme: EmailDesignTheme): string {
    const visibilityClass = getVisibilityClass(section.visibility);
    const columns = section.columns.length > 0 ? section.columns : [{ id: createEmailDesignId('column'), width: 100, blocks: [] }];
    const columnHtml = columns.map((column, index) => {
        const stackClass = getStackClass(section.stackMode, index, columns.length);
        return `<td class="${stackClass}" width="${column.width}%" valign="top" style="vertical-align:top;width:${column.width}%;">${column.blocks.map((block) => renderBlock(block, theme)).join('')}</td>`;
    }).join('');

    return `<tr class="${visibilityClass}"><td style="background:${section.backgroundColor || theme.contentBackgroundColor};padding:${section.padding || '0'};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${columnHtml}</tr></table></td></tr>`;
}

function renderBlock(block: EmailBlock, theme: EmailDesignTheme): string {
    const visibilityClass = getVisibilityClass(block.visibility);

    if (block.type === 'siteLogo') {
        const props = block.props;
        const content = props.src
            ? `<img src="${escapeHtml(props.src)}" alt="${escapeHtml(props.alt || props.fallbackText || 'Logo')}" width="${props.width || 160}" style="display:block;max-width:100%;height:auto;border:0;margin:0 auto;" />`
            : `<h1 style="margin:0;color:${theme.textColor};font-size:28px;line-height:1.25;">${escapeHtml(props.fallbackText || props.alt || 'Your Store')}</h1>`;
        return `<div class="${visibilityClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};">${content}</div>`;
    }

    if (block.type === 'text') {
        const props = block.props;
        return `<div class="${visibilityClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'left'};font-size:${props.size || 15}px;line-height:${props.lineHeight || 1.6};color:${props.color || theme.textColor};">${props.html}</div>`;
    }

    if (block.type === 'image') {
        const props = block.props;
        const image = `<img src="${escapeHtml(props.src)}" alt="${escapeHtml(props.alt || '')}" width="${props.width || 560}" style="display:block;max-width:100%;height:auto;border:0;margin:0 auto;" />`;
        const linked = props.href ? `<a href="${escapeHtml(props.href)}">${image}</a>` : image;
        return `<div class="${visibilityClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};">${linked}</div>`;
    }

    if (block.type === 'button') {
        const props = block.props;
        return `<div class="${visibilityClass}" style="padding:${props.padding || '16px 0'};text-align:${props.align || 'center'};"><a href="${escapeHtml(props.href || '{{store_url}}')}" style="display:inline-block;background:${props.backgroundColor || theme.primaryColor};color:${props.color || '#ffffff'};text-decoration:none;border-radius:${props.borderRadius ?? theme.borderRadius}px;padding:12px 20px;font-weight:700;font-size:14px;">${escapeHtml(props.label || 'Button')}</a></div>`;
    }

    if (block.type === 'list') {
        const tag = block.props.ordered ? 'ol' : 'ul';
        const items = block.props.items.map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`).join('');
        return `<div class="${visibilityClass}" style="padding:${block.props.padding || '8px 0'};color:${block.props.color || theme.textColor};"><${tag} style="margin:0;padding-left:22px;line-height:1.6;">${items}</${tag}></div>`;
    }

    if (block.type === 'divider') {
        return `<div class="${visibilityClass}" style="padding:${block.props.padding || '16px 0'};"><div style="border-top:1px solid ${block.props.color || '#e2e8f0'};font-size:0;line-height:0;">&nbsp;</div></div>`;
    }

    if (block.type === 'spacer') {
        return `<div class="${visibilityClass}" style="height:${block.props.height}px;line-height:${block.props.height}px;font-size:${block.props.height}px;">&nbsp;</div>`;
    }

    if (block.type === 'product') {
        const props = block.props;
        const productName = props.productName || '{{product.name}}';
        const productImage = props.productImage || '{{product.image}}';
        const productPrice = props.productPrice || '{{product.price}}';
        const productDescription = props.productDescription || '{{product.description}}';
        const productUrl = props.productUrl || props.buttonHref || '{{store_url}}';
        return `<div class="${visibilityClass}" style="padding:18px 0;text-align:center;">
            ${props.showImage ? `<img src="${escapeHtml(productImage)}" alt="${escapeHtml(productName)}" width="220" style="display:block;max-width:100%;height:auto;border-radius:10px;margin:0 auto 14px;" />` : ''}
            <h3 style="margin:0 0 8px;color:${theme.textColor};font-size:20px;line-height:1.3;">${escapeHtml(productName)}</h3>
            ${props.showDescription ? `<p style="margin:0 0 10px;color:#64748b;line-height:1.6;">${escapeHtml(productDescription)}</p>` : ''}
            ${props.showPrice ? `<p style="margin:0 0 14px;color:${theme.primaryColor};font-weight:700;">${escapeHtml(productPrice)}</p>` : ''}
            <a href="${escapeHtml(productUrl)}" style="display:inline-block;background:${theme.primaryColor};color:#ffffff;text-decoration:none;border-radius:${theme.borderRadius}px;padding:10px 16px;font-weight:700;">${escapeHtml(props.buttonLabel || 'View Product')}</a>
        </div>`;
    }

    if (block.type === 'orderSummary') {
        return `<div class="${visibilityClass}" style="padding:12px 0;"><h3 style="margin:0 0 12px;color:${theme.textColor};font-size:18px;">${escapeHtml(block.props.heading || 'Order summary')}</h3>{{order.itemsTable}}${block.props.showTotals ? '<p style="text-align:right;font-weight:700;color:#0f172a;">Total: {{order.total}}</p>' : ''}</div>`;
    }

    if (block.type === 'address') {
        const tag = block.props.source === 'shipping' ? '{{order.shippingAddress}}' : '{{order.billingAddress}}';
        return `<div class="${visibilityClass}" style="padding:12px 0;"><h3 style="margin:0 0 8px;color:${theme.textColor};font-size:16px;">${escapeHtml(block.props.title)}</h3><p style="margin:0;color:${theme.mutedTextColor};line-height:1.6;">${tag}</p></div>`;
    }

    if (block.type === 'coupon') {
        return `<div class="${visibilityClass}" style="padding:18px;margin:8px 0;background:#eef2ff;border:1px dashed ${theme.primaryColor};border-radius:${theme.borderRadius}px;text-align:center;"><p style="margin:0 0 6px;color:${theme.textColor};font-size:18px;font-weight:700;">${escapeHtml(block.props.headline)}</p><p style="margin:0 0 8px;color:${theme.primaryColor};font-size:22px;font-weight:800;letter-spacing:1px;">${escapeHtml(block.props.code || '{{coupon.code}}')}</p><p style="margin:0;color:${theme.mutedTextColor};line-height:1.5;">${escapeHtml(block.props.description || '{{coupon.description}}')}</p></div>`;
    }

    if (block.type === 'menu' || block.type === 'social') {
        const props = block.props;
        const links = props.links.map((link) => block.type === 'social'
            ? `<a href="${escapeHtml(link.href)}" title="${escapeHtml(link.label)}" style="display:inline-block;margin:0 6px;width:34px;height:34px;line-height:34px;border-radius:999px;background:${props.color || theme.primaryColor};color:#ffffff;text-align:center;text-decoration:none;font-weight:700;font-size:13px;">${escapeHtml(getSocialInitial(link.label))}</a>`
            : `<a href="${escapeHtml(link.href)}" style="display:inline-block;margin:0 10px;color:${props.color || theme.primaryColor};text-decoration:none;font-weight:600;">${escapeHtml(link.label)}</a>`).join('');
        return `<div class="${visibilityClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};font-size:14px;line-height:1.5;">${links}</div>`;
    }

    if (block.type === 'footer') {
        const props = block.props;
        return `<div class="${visibilityClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};font-size:12px;line-height:1.6;color:${props.color || theme.mutedTextColor};"><p style="margin:0;">${escapeHtml(props.text)}<br /><a href="${escapeHtml(props.unsubscribeUrl || '{{unsubscribe_url}}')}" style="color:${theme.primaryColor};">${escapeHtml(props.unsubscribeLabel || 'Unsubscribe')}</a></p></div>`;
    }

    return `<div class="${visibilityClass}">${block.props.html}</div>`;
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

function getVisibilityClass(visibility?: EmailDeviceVisibility): string {
    if (visibility === 'desktop') return 'os-mobile-hidden';
    if (visibility === 'mobile') return 'os-desktop-hidden';
    return '';
}

function getStackClass(stackMode: EmailStackMode = 'stack', index: number, total: number): string {
    if (stackMode === 'none') return '';
    if (stackMode === 'reverse' && index === 0 && total > 1) return 'os-mobile-block os-mobile-reverse';
    return 'os-mobile-block';
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function getEmailDesignV2BlockLabel(block: EmailBlock): string {
    const labels: Record<EmailBlock['type'], string> = {
        siteLogo: 'Site Logo',
        text: 'Text',
        image: 'Image',
        button: 'Button',
        list: 'List',
        divider: 'Divider',
        spacer: 'Spacer',
        product: 'Product',
        orderSummary: 'Order Summary',
        address: 'Address',
        coupon: 'Coupon',
        menu: 'Menu',
        social: 'Social',
        footer: 'Footer',
        rawHtml: 'Raw HTML',
    };
    return labels[block.type];
}
