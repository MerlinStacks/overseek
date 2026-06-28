import { sanitizeEmailHtml } from '../utils/emailHtml';

export type EmailDeviceVisibility = 'all' | 'desktop' | 'mobile';
export type EmailStackMode = 'stack' | 'reverse' | 'none';
export type SocialIconStyle = 'solid' | 'outline' | 'glyph';
export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'x' | 'linkedin' | 'pinterest' | 'generic';
export type SocialIconSet = 'native' | 'classic';
export type OrderItemsFormat = 'table' | 'compact' | 'list';

const EMAIL_DARK_BACKGROUND = '#0f172a';
const EMAIL_DARK_CONTENT_BACKGROUND = '#111827';
const EMAIL_DARK_SECTION_BACKGROUND = '#111827';
const EMAIL_DARK_TEXT = '#f8fafc';
const EMAIL_DARK_MUTED_TEXT = '#cbd5e1';
const EMAIL_DARK_BORDER = '#334155';

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
    backgroundType?: 'solid';
    backgroundColor?: string;
    padding?: string;
    borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: [number, number, number, number];
    displayCondition?: {
        enabled: boolean;
        expression: string;
    };
    visibility?: EmailDeviceVisibility;
    stackMode?: EmailStackMode;
    columns: EmailColumn[];
}

export interface EmailColumn {
    id: string;
    width: number;
    backgroundColor?: string;
    padding?: string;
    verticalAlign?: 'top' | 'middle' | 'bottom';
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
    | CartItemsBlock
    | CartLinkBlock
    | OrderSummaryBlock
    | OrderTrackingBlock
    | AddressBlock
    | CouponBlock
    | ReviewBlock
    | MenuBlock
    | SocialBlock
    | FooterBlock
    | RawHtmlBlock;

interface BaseBlock {
    id: string;
    visibility?: EmailDeviceVisibility;
    responsive?: boolean;
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
        fontSize?: number;
        fontWeight?: number;
        fontStyle?: 'normal' | 'italic';
        textDecoration?: 'none' | 'underline' | 'line-through';
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
        productRegularPrice?: string;
        productDescription?: string;
        productUrl?: string;
        showImage: boolean;
        showTitle?: boolean;
        showDescription: boolean;
        showPrice: boolean;
        showRegularPrice?: boolean;
        showButton?: boolean;
        buttonLabel: string;
        buttonHref: string;
    };
}

export interface CartItemsBlock extends BaseBlock {
    type: 'cartItems';
    props: {
        heading: string;
        showTotal: boolean;
        padding?: string;
        align?: 'left' | 'center' | 'right';
    };
}

export interface CartLinkBlock extends BaseBlock {
    type: 'cartLink';
    props: {
        label: string;
        href: string;
        body?: string;
        align?: 'left' | 'center' | 'right';
        backgroundColor?: string;
        color?: string;
        padding?: string;
        borderRadius?: number;
    };
}

export interface OrderSummaryBlock extends BaseBlock {
    type: 'orderSummary';
    props: {
        heading: string;
        showTotals: boolean;
        itemsFormat?: OrderItemsFormat;
    };
}

export interface OrderTrackingBlock extends BaseBlock {
    type: 'orderTracking';
    props: {
        heading: string;
        body: string;
        buttonLabel: string;
        showTrackingNumber?: boolean;
        align?: 'left' | 'center' | 'right';
        padding?: string;
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

export interface ReviewBlock extends BaseBlock {
    type: 'review';
    props: {
        headline: string;
        rating: string;
        content: string;
        reviewer: string;
        productName: string;
        ctaLabel: string;
        ctaHref: string;
        showHeadline?: boolean;
        showRating?: boolean;
        showContent?: boolean;
        showReviewer?: boolean;
        showProductName?: boolean;
        showCta?: boolean;
        backgroundColor?: string;
        borderColor?: string;
        padding?: string;
        align?: 'left' | 'center' | 'right';
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
        links: Array<{ label: string; href: string; iconStyle?: SocialIconStyle }>;
        align?: 'left' | 'center' | 'right';
        color?: string;
        padding?: string;
        iconStyle?: SocialIconStyle;
        iconSet?: SocialIconSet;
    };
}

export interface FooterBlock extends BaseBlock {
    type: 'footer';
    props: {
        html?: string;
        align?: 'left' | 'center' | 'right';
        color?: string;
        padding?: string;
    };
}

function buildDefaultFooterHtml(accountName: string): string {
    return `<p>You are receiving this email from ${escapeHtml(accountName)}.<br /><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`;
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
                            id: createEmailDesignId('footer'),
                            type: 'footer',
                            props: {
                                html: buildDefaultFooterHtml(appName),
                                align: 'center',
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

function joinClasses(...classes: Array<string | undefined>): string {
    return classes.filter(Boolean).join(' ');
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
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(document.meta.title || 'Email')}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media only screen and (max-width: 640px) {
      .os-mobile-hidden { display: none !important; }
      .os-mobile-block { display: block !important; width: 100% !important; }
      .os-mobile-reverse { display: table-header-group !important; }
      .os-responsive-block { display: block !important; width: 100% !important; max-width: 100% !important; }
    }
    @media only screen and (min-width: 641px) {
      .os-desktop-hidden { display: none !important; }
    }
    @media (prefers-color-scheme: dark) {
      body, .os-email-bg { background:${EMAIL_DARK_BACKGROUND} !important; color:${EMAIL_DARK_TEXT} !important; }
      .os-email-card { background:${EMAIL_DARK_CONTENT_BACKGROUND} !important; }
      .os-email-section { background:${EMAIL_DARK_SECTION_BACKGROUND} !important; border-color:${EMAIL_DARK_BORDER} !important; }
      .os-email-text, .os-email-list, .os-email-heading, .os-email-product-title, .os-email-review-content { color:${EMAIL_DARK_TEXT} !important; }
      .os-email-muted, .os-email-footer, .os-email-footer a { color:${EMAIL_DARK_MUTED_TEXT} !important; }
      .os-email-divider { border-top-color:${EMAIL_DARK_BORDER} !important; }
      .os-email-coupon { background:#1e1b4b !important; border-color:#818cf8 !important; }
      .os-email-review { background:#451a03 !important; border-color:#92400e !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${theme.backgroundColor};font-family:${theme.fontFamily};color:${theme.textColor};">
  ${previewText}
  <table class="os-email-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.backgroundColor};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table class="os-email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${theme.contentWidth}px;background:${theme.contentBackgroundColor};border-radius:${theme.borderRadius}px;overflow:hidden;">
          ${sectionHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function toAbsoluteUrl(url: string, options: { allowData?: boolean; allowCid?: boolean } = {}): string {
    const value = url.trim();
    if (!value) return value;
    if (value.includes('{{') || value.includes('}}')) return value;
    if (value.startsWith('#')) return value;

    const isAllowedProtocol = (protocol: string) => {
        if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') return true;
        if (options.allowData && protocol === 'data:') return true;
        if (options.allowCid && protocol === 'cid:') return true;
        return false;
    };

    try {
        const base = typeof window !== 'undefined' && window.location?.origin ? `${window.location.origin}/` : undefined;
        const parsed = base ? new URL(value, base) : new URL(value);
        return isAllowedProtocol(parsed.protocol) ? parsed.toString() : '';
    } catch {
        return '';
    }
}

function isEmailImageSource(url: string): boolean {
    return /^(https?:|data:|cid:)/i.test(url.trim());
}

function renderSection(section: EmailSection, theme: EmailDesignTheme): string {
    const visibilityClass = getVisibilityClass(section.visibility);
    const columns = section.columns.length > 0 ? section.columns : [{ id: createEmailDesignId('column'), width: 100, blocks: [] }];
    const borderStyle = section.borderStyle || 'none';
    const borderWidth = section.borderWidth || 0;
    const borderColor = section.borderColor || '#e2e8f0';
    const radius = section.borderRadius || [0, 0, 0, 0];
    const columnHtml = columns.map((column, index) => {
        const stackClass = getStackClass(section.stackMode, index, columns.length);
        const columnPadding = column.padding || '0';
        const columnBackground = column.backgroundColor ? `background:${column.backgroundColor};` : '';
        const verticalAlign = column.verticalAlign || 'top';
        return `<td class="${stackClass}" width="${column.width}%" valign="${verticalAlign}" style="vertical-align:${verticalAlign};width:${column.width}%;padding:${columnPadding};${columnBackground}">${column.blocks.map((block) => renderBlock(block, theme)).join('')}</td>`;
    }).join('');

    const borderDeclaration = borderStyle === 'none' || borderWidth <= 0 ? 'border:none;' : `border:${borderWidth}px ${borderStyle} ${borderColor};`;
    const rowHtml = `<tr class="${visibilityClass}"><td class="os-email-section" style="background:${section.backgroundColor || theme.contentBackgroundColor};padding:${section.padding || '0'};${borderDeclaration}border-radius:${radius[0]}px ${radius[1]}px ${radius[2]}px ${radius[3]}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${columnHtml}</tr></table></td></tr>`;
    const conditionExpression = section.displayCondition?.enabled ? section.displayCondition.expression.trim() : '';
    if (!conditionExpression) return rowHtml;
    return `{{#if ${conditionExpression}}}${rowHtml}{{/if}}`;
}

function renderBlock(block: EmailBlock, theme: EmailDesignTheme): string {
    const visibilityClass = getVisibilityClass(block.visibility);
    const blockClass = `${visibilityClass}${block.responsive ? `${visibilityClass ? ' ' : ''}os-responsive-block` : ''}`;

    if (block.type === 'siteLogo') {
        const props = block.props;
        const logoSrc = toAbsoluteUrl(props.src || '', { allowData: true, allowCid: true });
        const content = logoSrc && isEmailImageSource(logoSrc)
            ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(props.alt || props.fallbackText || 'Logo')}" width="${props.width || 160}" style="display:block;max-width:100%;height:auto;border:0;margin:0 auto;" />`
            : `<h1 class="os-email-heading" style="margin:0;color:${theme.textColor};font-size:28px;line-height:1.25;">${escapeHtml(props.fallbackText || props.alt || 'Your Store')}</h1>`;
        return `<div class="${blockClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};">${content}</div>`;
    }

    if (block.type === 'text') {
        const props = block.props;
        return `<div class="${joinClasses(blockClass, 'os-email-text')}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'left'};font-size:${props.size || 15}px;line-height:${props.lineHeight || 1.6};color:${props.color || theme.textColor};">${sanitizeEmailHtml(props.html)}</div>`;
    }

    if (block.type === 'image') {
        const props = block.props;
        const imageSrc = toAbsoluteUrl(props.src || '', { allowData: true, allowCid: true });
        if (!isEmailImageSource(imageSrc)) {
            return `<div class="${joinClasses(blockClass, 'os-email-muted')}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};color:${theme.mutedTextColor};font-size:13px;">Image source unavailable</div>`;
        }
        const image = `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(props.alt || '')}" width="${props.width || 560}" style="display:block;max-width:100%;height:auto;border:0;margin:0 auto;" />`;
        const linked = props.href ? `<a href="${escapeHtml(toAbsoluteUrl(props.href))}">${image}</a>` : image;
        return `<div class="${blockClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};">${linked}</div>`;
    }

    if (block.type === 'button') {
        const props = block.props;
        return `<div class="${blockClass}" style="padding:${props.padding || '16px 0'};text-align:${props.align || 'center'};"><a href="${escapeHtml(toAbsoluteUrl(props.href || '{{store_url}}'))}" style="display:inline-block;background:${props.backgroundColor || theme.primaryColor};color:${props.color || '#ffffff'};text-decoration:${props.textDecoration || 'none'};border-radius:${props.borderRadius ?? theme.borderRadius}px;padding:12px 20px;font-weight:${props.fontWeight || 700};font-size:${props.fontSize || 14}px;font-style:${props.fontStyle || 'normal'};">${escapeHtml(props.label || 'Button')}</a></div>`;
    }

    if (block.type === 'list') {
        const tag = block.props.ordered ? 'ol' : 'ul';
        const items = block.props.items.map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`).join('');
        return `<div class="${joinClasses(blockClass, 'os-email-list')}" style="padding:${block.props.padding || '8px 0'};text-align:${(block.props as { align?: string }).align || 'left'};color:${block.props.color || theme.textColor};"><${tag} style="margin:0;padding-left:22px;line-height:1.6;">${items}</${tag}></div>`;
    }

    if (block.type === 'divider') {
        return `<div class="${blockClass}" style="padding:${block.props.padding || '16px 0'};text-align:${(block.props as { align?: string }).align || 'center'};"><div class="os-email-divider" style="border-top:1px solid ${block.props.color || '#e2e8f0'};font-size:0;line-height:0;">&nbsp;</div></div>`;
    }

    if (block.type === 'spacer') {
        return `<div class="${blockClass}" style="padding:${(block.props as { padding?: string }).padding || '8px 0'};height:${block.props.height}px;line-height:${block.props.height}px;font-size:${block.props.height}px;text-align:${(block.props as { align?: string }).align || 'center'};">&nbsp;</div>`;
    }

    if (block.type === 'product') {
        const props = block.props;
        const productSelected = Boolean(props.productId || props.productName);
        const productName = props.productName || '{{product.name}}';
        const productImage = props.productImage || '{{product.image}}';
        const productPrice = props.productPrice || '{{product.price}}';
        const productRegularPrice = props.productRegularPrice || '{{product.regularPrice}}';
        const productDescription = props.productDescription || (productSelected ? '' : 'Choose a WooCommerce product in block settings.');
        const showTitle = props.showTitle !== false;
        const showButton = props.showButton !== false;
        const productUrl = toAbsoluteUrl(props.productUrl || props.buttonHref || '{{store_url}}');
        const productImageSrc = toAbsoluteUrl(productImage, { allowData: true, allowCid: true });
        return `<div class="${blockClass}" style="padding:${(props as { padding?: string }).padding || '18px 0'};text-align:${(props as { align?: string }).align || 'center'};">
            ${props.showImage ? `<img src="${escapeHtml(productImageSrc)}" alt="${escapeHtml(productName)}" width="220" style="display:block;max-width:100%;height:auto;border-radius:10px;margin:0 auto 14px;" />` : ''}
            ${showTitle ? `<h3 class="os-email-product-title" style="margin:0 0 8px;color:${theme.textColor};font-size:20px;line-height:1.3;">${escapeHtml(productName)}</h3>` : ''}
            ${props.showDescription && productDescription ? `<p class="os-email-muted" style="margin:0 0 10px;color:#64748b;line-height:1.6;">${escapeHtml(productDescription)}</p>` : ''}
            ${props.showPrice ? `<p style="margin:0 0 8px;color:${theme.primaryColor};font-weight:700;">${escapeHtml(productPrice)}</p>` : ''}
            ${props.showRegularPrice ? `<p class="os-email-muted" style="margin:0 0 14px;color:${theme.mutedTextColor};font-size:14px;text-decoration:${props.showPrice && Boolean(productPrice) ? 'line-through' : 'none'};">${escapeHtml(productRegularPrice)}</p>` : ''}
            ${showButton ? `<a href="${escapeHtml(productUrl)}" style="display:inline-block;background:${theme.primaryColor};color:#ffffff;text-decoration:none;border-radius:${theme.borderRadius}px;padding:10px 16px;font-weight:700;">${escapeHtml(props.buttonLabel || 'View Product')}</a>` : ''}
        </div>`;
    }

    if (block.type === 'orderSummary') {
        const itemsTag = getOrderItemsMergeTag(block.props.itemsFormat);
        return `<div class="${blockClass}" style="padding:${(block.props as { padding?: string }).padding || '12px 0'};text-align:${(block.props as { align?: string }).align || 'left'};"><h3 class="os-email-heading" style="margin:0 0 12px;color:${theme.textColor};font-size:18px;">${escapeHtml(block.props.heading || 'Order summary')}</h3>${itemsTag}${block.props.showTotals ? `<div class="os-email-text" style="margin:14px 0 0;text-align:right;color:${theme.textColor};"><p style="margin:0 0 4px;font-weight:600;">GST: {{order.taxTotal}}</p><p style="margin:0;font-weight:700;">Total: {{order.total}}</p></div>` : ''}</div>`;
    }

    if (block.type === 'cartItems') {
        const align = block.props.align || 'left';
        return `<div class="${blockClass}" style="padding:${block.props.padding || '12px 0'};text-align:${align};"><h3 class="os-email-heading" style="margin:0 0 12px;color:${theme.textColor};font-size:18px;">${escapeHtml(block.props.heading || 'Your cart')}</h3>{{cart.itemsTable}}${block.props.showTotal ? `<div class="os-email-text" style="margin:14px 0 0;text-align:right;color:${theme.textColor};"><p style="margin:0;font-weight:700;">Cart total: {{cart.total}}</p></div>` : ''}</div>`;
    }

    if (block.type === 'cartLink') {
        const props = block.props;
        const align = props.align || 'center';
        return `<div class="${blockClass}" style="padding:${props.padding || '16px 0'};text-align:${align};">${props.body ? `<p class="os-email-muted" style="margin:0 0 14px;color:${theme.mutedTextColor};line-height:1.6;">${escapeHtml(props.body)}</p>` : ''}<a href="${escapeHtml(toAbsoluteUrl(props.href || '{{cart.recoveryUrl}}'))}" style="display:inline-block;background:${props.backgroundColor || theme.primaryColor};color:${props.color || '#ffffff'};text-decoration:none;border-radius:${props.borderRadius ?? theme.borderRadius}px;padding:12px 20px;font-weight:700;font-size:14px;">${escapeHtml(props.label || 'Return to your cart')}</a></div>`;
    }

    if (block.type === 'orderTracking') {
        const props = block.props;
        const align = props.align || 'center';
        return `<div class="${blockClass}" style="padding:${props.padding || '18px 0'};text-align:${align};"><h3 class="os-email-heading" style="margin:0 0 8px;color:${theme.textColor};font-size:18px;line-height:1.35;">${escapeHtml(props.heading || 'Track your order')}</h3><p class="os-email-muted" style="margin:0 0 14px;color:${theme.mutedTextColor};line-height:1.6;">${escapeHtml(props.body || 'Your order is on its way. Use the button below to track it with Australia Post.')}</p>${props.showTrackingNumber !== false ? `<p class="os-email-muted" style="margin:0 0 14px;color:${theme.mutedTextColor};font-size:13px;line-height:1.4;">Tracking number: <strong style="color:${theme.textColor};">{{order.trackingNumber}}</strong></p>` : ''}<a href="{{order.auspostTrackingUrl}}" style="display:inline-block;background:${theme.primaryColor};color:#ffffff;text-decoration:none;border-radius:${theme.borderRadius}px;padding:12px 20px;font-weight:700;font-size:14px;">${escapeHtml(props.buttonLabel || 'Track with AusPost')}</a></div>`;
    }

    if (block.type === 'address') {
        const tag = block.props.source === 'shipping' ? '{{order.shippingAddress}}' : '{{order.billingAddress}}';
        return `<div class="${blockClass}" style="padding:${(block.props as { padding?: string }).padding || '12px 0'};text-align:${(block.props as { align?: string }).align || 'left'};"><h3 class="os-email-heading" style="margin:0 0 8px;color:${theme.textColor};font-size:16px;">${escapeHtml(block.props.title)}</h3><p class="os-email-muted" style="margin:0;color:${theme.mutedTextColor};line-height:1.6;">${tag}</p></div>`;
    }

    if (block.type === 'coupon') {
        return `<div class="${joinClasses(blockClass, 'os-email-coupon')}" style="padding:${(block.props as { padding?: string }).padding || '18px'};margin:8px 0;background:#eef2ff;border:1px dashed ${theme.primaryColor};border-radius:${theme.borderRadius}px;text-align:${(block.props as { align?: string }).align || 'center'};"><p class="os-email-heading" style="margin:0 0 6px;color:${theme.textColor};font-size:18px;font-weight:700;">${escapeHtml(block.props.headline)}</p><p style="margin:0 0 8px;color:${theme.primaryColor};font-size:22px;font-weight:800;letter-spacing:1px;">${escapeHtml(block.props.code || '{{coupon.code}}')}</p><p class="os-email-muted" style="margin:0;color:${theme.mutedTextColor};line-height:1.5;">${escapeHtml(block.props.description || '{{coupon.description}}')}</p></div>`;
    }

    if (block.type === 'review') {
        const ratingNumber = Math.min(5, Math.max(1, Number(block.props.rating || '5') || 5));
        const stars = '&#9733;'.repeat(ratingNumber);
        const showHeadline = block.props.showHeadline !== false;
        const showRating = block.props.showRating !== false;
        const showContent = block.props.showContent !== false;
        const showReviewer = block.props.showReviewer !== false;
        const showProductName = block.props.showProductName !== false;
        const showCta = block.props.showCta !== false;
        const attribution = [
            showReviewer ? escapeHtml(block.props.reviewer || '{{review.reviewer}}') : '',
            showProductName ? `on ${escapeHtml(block.props.productName || '{{review.productName}}')}` : '',
        ].filter(Boolean).join(' ');
        return `<div class="${joinClasses(blockClass, 'os-email-review')}" style="padding:${block.props.padding || '18px'};margin:8px 0;background:${block.props.backgroundColor || 'transparent'};border:${block.props.borderColor ? `1px solid ${block.props.borderColor}` : '0'};border-radius:${theme.borderRadius}px;text-align:${block.props.align || 'left'};">${showHeadline ? `<p class="os-email-heading" style="margin:0 0 8px;color:${theme.textColor};font-size:18px;font-weight:700;">${escapeHtml(block.props.headline || 'Customer review')}</p>` : ''}${showRating ? `<p style="margin:0 0 8px;color:#b45309;font-size:18px;letter-spacing:1px;">${stars}</p>` : ''}${showContent ? `<p class="os-email-review-content" style="margin:0 0 10px;color:${theme.textColor};line-height:1.6;">${escapeHtml(block.props.content || '{{review.content}}')}</p>` : ''}${attribution ? `<p class="os-email-muted" style="margin:0 0 14px;color:${theme.mutedTextColor};font-size:13px;">- ${attribution}</p>` : ''}${showCta ? `<a href="${escapeHtml(toAbsoluteUrl(block.props.ctaHref || '{{review.requestUrl}}'))}" style="display:inline-block;background:${theme.primaryColor};color:#ffffff;text-decoration:none;border-radius:${theme.borderRadius}px;padding:10px 16px;font-weight:700;">${escapeHtml(block.props.ctaLabel || 'Leave a review')}</a>` : ''}</div>`;
    }

    if (block.type === 'social') {
        const props = block.props;
        const iconSet = props.iconSet || 'native';
        const links = props.links.map((link) => renderSocialIconLink(link.label, toAbsoluteUrl(link.href), link.iconStyle || props.iconStyle || 'solid', props.color || theme.primaryColor, iconSet)).join('');
        return `<div class="${blockClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};font-size:14px;line-height:1.5;">${links}</div>`;
    }

    if (block.type === 'menu') {
        const props = block.props;
        const links = props.links.map((link) => `<a href="${escapeHtml(toAbsoluteUrl(link.href))}" style="display:inline-block;margin:0 10px;color:${props.color || theme.primaryColor};text-decoration:none;font-weight:600;">${escapeHtml(link.label)}</a>`).join('');
        return `<div class="${blockClass}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};font-size:14px;line-height:1.5;">${links}</div>`;
    }

    if (block.type === 'footer') {
        const props = block.props;
        const html = sanitizeEmailHtml(props.html || '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>');
        return `<div class="${joinClasses(blockClass, 'os-email-footer')}" style="padding:${props.padding || '8px 0'};text-align:${props.align || 'center'};font-size:12px;line-height:1.6;color:${props.color || theme.mutedTextColor};">${html}</div>`;
    }

    return `<div class="${blockClass}" style="padding:${(block.props as { padding?: string }).padding || '8px 0'};text-align:${(block.props as { align?: string }).align || 'left'};">${sanitizeEmailHtml(String(block.props.html || ''))}</div>`;
}

function getOrderItemsMergeTag(format: OrderItemsFormat | undefined): string {
    if (format === 'compact') return '{{order.itemsCompact}}';
    if (format === 'list') return '{{order.itemsList}}';
    return '{{order.itemsTable}}';
}

export function getSocialPlatform(label: string): SocialPlatform {
    const normalized = label.trim().toLowerCase();
    if (normalized.includes('facebook')) return 'facebook';
    if (normalized.includes('instagram')) return 'instagram';
    if (normalized.includes('tiktok')) return 'tiktok';
    if (normalized.includes('youtube')) return 'youtube';
    if (normalized === 'x' || normalized.includes('twitter')) return 'x';
    if (normalized.includes('linkedin')) return 'linkedin';
    if (normalized.includes('pinterest')) return 'pinterest';
    return 'generic';
}

export function getSocialIconSvg(label: string, iconStyle: SocialIconStyle = 'solid', color = '#4f46e5', iconSet: SocialIconSet = 'native'): string {
    const platform = getSocialPlatform(label);
    const fill = iconStyle === 'solid' ? '#ffffff' : color;
    const stroke = iconStyle === 'solid' ? '#ffffff' : color;
    const common = 'width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" role="img"';

    if (iconSet === 'classic') {
        if (platform === 'facebook') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M14.2 8.5H17V5h-3.3C10.5 5 9 6.8 9 9.5V12H6v3.6h3V24h3.8v-8.4h3.1l.6-3.6h-3.7V9.9c0-.9.3-1.4 1.4-1.4Z"/></svg>`;
        if (platform === 'instagram') return `<svg ${common} fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><circle cx="17" cy="7" r="1" fill="${stroke}" stroke="none"/></svg>`;
        if (platform === 'tiktok') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M14.6 3h3.1c.2 1.4 1 2.7 2.3 3.5a6 6 0 0 0 2.6.9v3.1a8.7 8.7 0 0 1-5-1.6v6.6c0 3.4-2.5 5.8-5.8 5.8A5.5 5.5 0 0 1 6.2 16c0-3.3 2.7-5.7 6-5.5v3.2c-1.4-.2-2.6.8-2.6 2.2 0 1.3 1 2.3 2.3 2.3 1.5 0 2.5-.9 2.5-2.7V3Z"/></svg>`;
        if (platform === 'youtube') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.6 4.6 12 4.6 12 4.6s-5.6 0-7.5.5a3 3 0 0 0-2.1 2.1A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.9.5 7.5.5 7.5.5s5.6 0 7.5-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z"/></svg>`;
        if (platform === 'x') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M15.3 10.2 21.5 3h-1.9l-5.1 6-4-6H3.3l7.4 10.7L3 21h1.9l6.6-6.1 4.1 6.1h7.1l-7.4-10.8Zm-2.5 2.9-.8-1.2L6.7 4.5h2.9l9.6 15h-2.8l-3.6-6.4Z"/></svg>`;
        if (platform === 'linkedin') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M6.8 8.8H3.4V21h3.4V8.8ZM5.1 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm15.5 11.1c0-3.3-1.8-5.6-4.8-5.6-1.8 0-2.9 1-3.4 1.9V8.8H9.1V21h3.4v-6.6c0-1.7.9-2.8 2.3-2.8 1.3 0 2.3.9 2.3 2.8V21h3.5v-6.9Z"/></svg>`;
        if (platform === 'pinterest') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M12.2 3C7.3 3 4.7 6.2 4.7 9.7c0 2.1 1.1 4.8 2.8 5.6.3.1.4.1.5-.2l.4-1.5c.1-.2 0-.4-.1-.6-.6-.8-.9-1.8-.9-2.9 0-3 2.2-5.8 6-5.8 3.3 0 5.4 2.2 5.4 5.4 0 3.6-1.8 6.1-4.1 6.1-1.3 0-2.3-1.1-2-2.5.4-1.6 1.1-3.3 1.1-4.4 0-1-.5-1.9-1.7-1.9-1.3 0-2.4 1.4-2.4 3.2 0 1.2.4 2 .4 2l-1.6 6.7c-.3 1.2-.2 2.9-.1 4 .1.3.4.4.6.1.4-.8 1.1-2.2 1.5-3.4l.8-3.1c.4.8 1.6 1.5 2.9 1.5 3.8 0 6.5-3.5 6.5-8.2C21 6.1 17.8 3 12.2 3Z"/></svg>`;
    }

    if (platform === 'facebook') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M13.3 20v-7h2.3l.4-2.8h-2.7V8.4c0-.8.2-1.5 1.4-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.1H8v2.8h2.3v7h3Z"/></svg>`;
    if (platform === 'instagram') return `<svg ${common} fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.7" r="1.1" fill="${stroke}" stroke="none"/></svg>`;
    if (platform === 'tiktok') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M14 3c.4 2 1.7 3.3 3.7 3.8v2.8c-1.5-.1-2.7-.6-3.7-1.3v5.5c0 3.4-2.4 5.7-5.7 5.7a5.5 5.5 0 0 1 0-11c.4 0 .8 0 1.1.1v2.8a2.7 2.7 0 0 0-1.1-.2 2.7 2.7 0 0 0 0 5.4c1.5 0 2.7-1 2.7-2.8V3H14Z"/></svg>`;
    if (platform === 'youtube') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M19.6 6.8a2.8 2.8 0 0 0-2-2c-1.8-.5-5.6-.5-5.6-.5s-3.8 0-5.6.5a2.8 2.8 0 0 0-2 2A29.2 29.2 0 0 0 4 12c0 1.8.2 3.5.5 5.2a2.8 2.8 0 0 0 2 2c1.8.5 5.6.5 5.6.5s3.8 0 5.6-.5a2.8 2.8 0 0 0 2-2c.3-1.7.5-3.4.5-5.2 0-1.8-.2-3.5-.6-5.2ZM10.3 15.3V8.7l5.5 3.3-5.5 3.3Z"/></svg>`;
    if (platform === 'x') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M18.9 3h2.8l-6.1 7 7.2 11h-5.7l-4.4-6.8L6.8 21H4l6.5-7.5L3.6 3h5.8l4 6.2L18.9 3Zm-1 16.2h1.6L8.5 4.7H6.8l11.1 14.5Z"/></svg>`;
    if (platform === 'linkedin') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M6 8.5H3V21h3V8.5ZM4.5 3A1.8 1.8 0 1 0 4.5 6.6 1.8 1.8 0 0 0 4.5 3ZM21 13.8c0-3.3-1.8-5.3-4.5-5.3-2 0-2.9 1.1-3.4 1.9v-1.7h-3V21h3v-6.1c0-1.6.3-3.1 2.2-3.1 1.9 0 2 1.8 2 3.2V21h3v-7.2Z"/></svg>`;
    if (platform === 'pinterest') return `<svg ${common} fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.2c-5 0-7.6 3.6-7.6 6.7 0 1.9 1 4.2 2.6 5 .2.1.3.1.4-.2l.4-1.5c0-.2 0-.3-.1-.5-.5-.7-.8-1.6-.8-2.6 0-2.6 2-5.1 5.4-5.1 2.9 0 4.9 2 4.9 4.7 0 3.1-1.5 5.3-3.6 5.3-1.1 0-2-1-1.7-2.2.3-1.4 1-2.9 1-3.9 0-.9-.5-1.7-1.5-1.7-1.2 0-2.1 1.2-2.1 2.9 0 1 .3 1.8.3 1.8l-1.4 5.9c-.2 1-.1 2.5 0 3.5 0 .2.3.3.5.1.3-.7 1-2 1.3-3l.7-2.7c.3.7 1.4 1.3 2.6 1.3 3.3 0 5.7-3.1 5.7-7.2C19.7 6 16.8 3.2 12 3.2Z"/></svg>`;
    return `<svg ${common} fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>`;
}

export function getSocialIconContainerStyle(iconStyle: SocialIconStyle = 'solid', color = '#4f46e5'): string {
    if (iconStyle === 'outline') return `background:transparent;border:1.5px solid ${color};color:${color};`;
    if (iconStyle === 'glyph') return `background:transparent;border:0;color:${color};`;
    return `background:${color};border:1.5px solid ${color};color:#ffffff;`;
}

export function getSocialPlatformColor(platform: SocialPlatform, fallbackColor: string): string {
    if (platform === 'facebook') return '#1877F2';
    if (platform === 'instagram') return '#E4405F';
    if (platform === 'tiktok') return '#111111';
    if (platform === 'youtube') return '#FF0000';
    if (platform === 'x') return '#111111';
    if (platform === 'linkedin') return '#0A66C2';
    if (platform === 'pinterest') return '#E60023';
    return fallbackColor;
}

function getSocialIconImageSrc(platform: SocialPlatform, iconStyle: SocialIconStyle, color: string): string | null {
    if (platform === 'generic') return null;
    const slugs: Record<Exclude<SocialPlatform, 'generic'>, string> = {
        facebook: 'facebook-new',
        instagram: 'instagram-new',
        tiktok: 'tiktok',
        youtube: 'youtube-play',
        x: 'twitterx',
        linkedin: 'linkedin',
        pinterest: 'pinterest',
    };
    const iconColor = iconStyle === 'solid' ? 'ffffff' : color.replace('#', '');
    return `https://img.icons8.com/ios-filled/50/${iconColor}/${slugs[platform]}.png`;
}

function renderSocialIconLink(label: string, href: string, iconStyle: SocialIconStyle, color: string, iconSet: SocialIconSet): string {
    const platform = getSocialPlatform(label);
    const iconColor = iconSet === 'native' ? getSocialPlatformColor(platform, color) : color;
    const imageSrc = getSocialIconImageSrc(platform, iconStyle, iconColor);
    const icon = imageSrc
        ? `<img src="${escapeHtml(imageSrc)}" width="18" height="18" alt="${escapeHtml(label)}" style="display:block;width:18px;height:18px;border:0;outline:none;text-decoration:none;" />`
        : `<span style="display:block;width:18px;height:18px;line-height:18px;font-size:14px;color:${iconStyle === 'solid' ? '#ffffff' : iconColor};">${escapeHtml(label.trim().charAt(0).toUpperCase() || '+')}</span>`;
    return `<a href="${escapeHtml(href)}" title="${escapeHtml(label)}" style="display:inline-block;margin:0 6px;width:34px;height:34px;line-height:34px;border-radius:999px;text-align:center;text-decoration:none;vertical-align:middle;${getSocialIconContainerStyle(iconStyle, iconColor)}"><span style="display:inline-block;width:18px;height:18px;line-height:18px;margin-top:8px;vertical-align:top;">${icon}</span></a>`;
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
        cartItems: 'Cart Items',
        cartLink: 'Cart Link',
        orderSummary: 'Order Summary',
        orderTracking: 'Order Tracking',
        address: 'Address',
        coupon: 'Coupon',
        review: 'Review',
        menu: 'Menu',
        social: 'Social',
        footer: 'Footer',
        rawHtml: 'Raw HTML',
    };
    return labels[block.type];
}
