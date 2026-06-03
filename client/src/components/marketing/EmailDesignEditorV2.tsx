import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { getInvoiceItemMeta } from '@overseek/core';
import { AlertTriangle, CheckCircle, ClipboardList, Eye, Globe2, GripVertical, History, Layers, Loader2, Lock, LockOpen, Monitor, Pencil, Search, Send, Settings, Smartphone, Trash2, Upload, X } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { evaluateEmailPreflight, groupPreflightIssues, type PreflightIssue } from '../../utils/emailPreflight';
import {
    compileEmailDesignV2,
    createEmailDesignV2FromUnknown,
    createEmailDesignId,
    getEmailDesignV2BlockLabel,
    type EmailBlock,
    type EmailColumn,
    type EmailDesignV2Envelope,
    type EmailDeviceVisibility,
    type EmailSection,
    type EmailStackMode,
    type OrderItemsFormat,
    type SocialIconSet,
    type SocialIconStyle,
} from '../../lib/emailDesignerV2';
import { createAccountFooterHtml, createBlock, createPaletteBlock, paletteItems, type PaletteKey } from './emailDesignerV2/blockFactory';
import { EmailDropCanvas } from './emailDesignerV2/EmailDropCanvas';
import { PaletteGrid } from './emailDesignerV2/PaletteGrid';
import { ProductPicker } from './emailDesignerV2/ProductPicker';
import { productToBlockProps } from './emailDesignerV2/productBlockProps';
import { getEmailDesignWarnings, sanitizeEmailHtml } from '../../utils/emailHtml';

interface Props {
    initialDesign?: unknown;
    initialSubject?: string;
    initialPreviewText?: string;
    onSave: (html: string, design: unknown, meta?: { subject: string; previewText: string; autosave?: boolean }) => void | Promise<void>;
    onCancel: () => void;
}

interface Snapshot {
    id: string;
    createdAt: string;
    design: EmailDesignV2Envelope;
}

interface SavedSectionPreset {
    id: string;
    name: string;
    section: EmailSection;
}

interface InvoiceTemplateRecord {
    layout?: string | { items?: Array<{ type?: string; logo?: string; content?: string }> };
}

const DRAFT_STORAGE_KEY = 'overseek-email-builder-v2-draft';
const HISTORY_STORAGE_KEY = 'overseek-email-builder-v2-history';
const SAVED_SECTIONS_STORAGE_KEY = 'overseek-email-builder-v2-saved-sections';
const MAX_HISTORY = 12;

type BuilderTab = 'structure' | 'blocks' | 'layouts' | 'global';
type LeftSidebarMode = 'builder' | 'blockSettings' | 'sectionSettings' | 'checklist' | 'history' | 'test';

interface StructurePreset {
    id: string;
    widths: number[];
}

const STRUCTURE_PRESETS: StructurePreset[] = [
    { id: 'one-column', widths: [100] },
    { id: 'two-equal', widths: [50, 50] },
    { id: 'one-third-two-third', widths: [33, 67] },
    { id: 'two-third-one-third', widths: [67, 33] },
    { id: 'three-equal', widths: [33, 34, 33] },
    { id: 'quarter-half-quarter', widths: [25, 50, 25] },
    { id: 'four-equal', widths: [25, 25, 25, 25] },
    { id: 'narrow-wide-narrow-wide', widths: [17, 33, 17, 33] },
    { id: 'wide-narrow-narrow-wide', widths: [33, 17, 17, 33] },
];

const cloneDesign = (design: EmailDesignV2Envelope): EmailDesignV2Envelope => (
    typeof structuredClone === 'function' ? structuredClone(design) : JSON.parse(JSON.stringify(design))
);

const RECENT_TEST_RECIPIENTS_KEY = 'overseek-email-builder-v2-test-recipients';
const MAX_TEST_RECIPIENTS = 5;
const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'X', 'Twitter', 'LinkedIn', 'Pinterest'];
const SOCIAL_ICON_STYLES: SocialIconStyle[] = ['solid', 'outline', 'glyph'];
const SOCIAL_ICON_SETS: SocialIconSet[] = ['native', 'classic'];
const ORDER_ITEMS_FORMATS: OrderItemsFormat[] = ['table', 'compact', 'list'];
const LTR_TEXT_STYLE = { direction: 'ltr', unicodeBidi: 'plaintext', writingMode: 'horizontal-tb' } as const;
const PRODUCT_VISIBILITY_FIELDS = [
    { key: 'showImage', label: 'Image' },
    { key: 'showTitle', label: 'Title' },
    { key: 'showDescription', label: 'Description' },
    { key: 'showPrice', label: 'Price' },
    { key: 'showRegularPrice', label: 'Regular Price' },
    { key: 'showButton', label: 'Button' },
] as const;
const REVIEW_VISIBILITY_FIELDS = [
    { key: 'showHeadline', label: 'Headline' },
    { key: 'showRating', label: 'Rating' },
    { key: 'showContent', label: 'Review Content' },
    { key: 'showReviewer', label: 'Reviewer Name' },
    { key: 'showProductName', label: 'Product Name' },
    { key: 'showCta', label: 'CTA Button' },
] as const;

interface PreviewMergeContext {
    storeUrl: string;
    customerFirstName: string;
    customerLastName: string;
    customerEmail: string;
    customerPhone: string;
    orderNumber: string;
    orderDate: string;
    orderStatus: string;
    orderSubtotal: string;
    orderShippingTotal: string;
    orderDiscountTotal: string;
    orderTotal: string;
    orderItemsTable: string;
    orderItemsCompact: string;
    orderItemsList: string;
    orderCustomerNote: string;
    orderTrackingNumber: string;
    orderTrackingUrl: string;
    orderAuspostTrackingUrl: string;
    billingAddress: string;
    shippingAddress: string;
    productName: string;
    productPrice: string;
    productImage: string;
    productDescription: string;
    reviewReviewer: string;
    reviewRating: string;
    reviewContent: string;
    reviewProductName: string;
    reviewProductUrl: string;
}

function applyPreviewMergeTags(html: string, context: PreviewMergeContext): string {
    const replacements: Array<[RegExp, string]> = [
        [/\{\{store_url\}\}/g, context.storeUrl],
        [/\{\{preferences_url\}\}/g, `${context.storeUrl.replace(/\/$/, '')}/my-account/edit-account`],
        [/\{\{unsubscribe_url\}\}/g, `${context.storeUrl.replace(/\/$/, '')}/?unsubscribe=preview`],
        [/\{\{link_trigger\}\}/g, context.storeUrl],
        [/\{\{customer\.firstName\}\}/g, context.customerFirstName],
        [/\{\{customer\.lastName\}\}/g, context.customerLastName],
        [/\{\{customer\.email\}\}/g, context.customerEmail],
        [/\{\{customer\.phone\}\}/g, context.customerPhone],
        [/\{\{contact_first_name\}\}/g, context.customerFirstName],
        [/\{\{contact_last_name\}\}/g, context.customerLastName],
        [/\{\{contact_email\}\}/g, context.customerEmail],
        [/\{\{contact_full_name\}\}/g, [context.customerFirstName, context.customerLastName].filter(Boolean).join(' ')],
        [/\{\{order\.number\}\}/g, context.orderNumber],
        [/\{\{order_id\}\}/g, context.orderNumber],
        [/\{\{\s*order_items(?:\s+[^}]*)?\s*\}\}/g, context.productName || 'your order'],
        [/\{\{order\.date\}\}/g, context.orderDate],
        [/\{\{order\.status\}\}/g, context.orderStatus],
        [/\{\{order\.subtotal\}\}/g, context.orderSubtotal],
        [/\{\{order\.shippingTotal\}\}/g, context.orderShippingTotal],
        [/\{\{order\.discountTotal\}\}/g, context.orderDiscountTotal],
        [/\{\{order\.total\}\}/g, context.orderTotal],
        [/\{\{order\.itemsTable\}\}/g, context.orderItemsTable],
        [/\{\{order\.itemsCompact\}\}/g, context.orderItemsCompact],
        [/\{\{order\.itemsList\}\}/g, context.orderItemsList],
        [/\{\{order\.customerNote\}\}/g, context.orderCustomerNote],
        [/\{\{order\.trackingNumber\}\}/g, context.orderTrackingNumber],
        [/\{\{order\.trackingUrl\}\}/g, context.orderTrackingUrl],
        [/\{\{order\.auspostTrackingUrl\}\}/g, context.orderAuspostTrackingUrl],
        [/\{\{tracking_number\}\}/g, context.orderTrackingNumber],
        [/\{\{tracking_url\}\}/g, context.orderTrackingUrl],
        [/\{\{order\.billingAddress\}\}/g, context.billingAddress],
        [/\{\{order\.shippingAddress\}\}/g, context.shippingAddress],
        [/\{\{product\.name\}\}/g, context.productName],
        [/\{\{product\.price\}\}/g, context.productPrice],
        [/\{\{product\.image\}\}/g, context.productImage],
        [/\{\{product\.description\}\}/g, context.productDescription],
        [/\{\{review\.reviewer\}\}/g, context.reviewReviewer],
        [/\{\{review\.rating\}\}/g, context.reviewRating],
        [/\{\{review\.content\}\}/g, context.reviewContent],
        [/\{\{review\.productName\}\}/g, context.reviewProductName],
        [/\{\{review\.productUrl\}\}/g, context.reviewProductUrl],
    ];

    return replacements.reduce((result, [pattern, value]) => result.replace(pattern, value || ''), html);
}

function sanitizeBidiText(value: string): string {
    return value.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '');
}

function createFallbackPreviewMergeContext(storeUrl: string): PreviewMergeContext {
    return {
        storeUrl,
        customerFirstName: 'Alex',
        customerLastName: 'Taylor',
        customerEmail: 'alex@example.com',
        customerPhone: '+61 400 000 000',
        orderNumber: '1001',
        orderDate: new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }),
        orderStatus: 'processing',
        orderSubtotal: '$89.00',
        orderShippingTotal: '$10.00',
        orderDiscountTotal: '$0.00',
        orderTotal: '$99.00',
        orderItemsTable: '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tbody><tr><td style="padding:12px;border-bottom:1px solid #e5e7eb;">Classic Hoodie</td><td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:center;">1</td><td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:right;">$89.00</td></tr></tbody></table>',
        orderItemsCompact: '<div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif;"><div style="padding:12px;color:#374151;"><strong>Classic Hoodie</strong><br><span style="font-size:13px;color:#6b7280;">Qty: 1 &middot; $89.00</span></div></div>',
        orderItemsList: '<ul style="margin:0;padding-left:20px;color:#374151;line-height:1.6;font-family:Arial,sans-serif;"><li>1 x Classic Hoodie</li></ul>',
        orderCustomerNote: 'Please leave at front door.',
        orderTrackingNumber: '33A1234567890',
        orderTrackingUrl: 'https://auspost.com.au/mypost/track/#/details/33A1234567890',
        orderAuspostTrackingUrl: 'https://auspost.com.au/mypost/track/#/details/33A1234567890',
        billingAddress: 'Alex Taylor<br />12 Market Street<br />Sydney, NSW, 2000<br />AU',
        shippingAddress: 'Alex Taylor<br />12 Market Street<br />Sydney, NSW, 2000<br />AU',
        productName: 'Classic Hoodie',
        productPrice: '$89.00',
        productImage: 'https://via.placeholder.com/600x600?text=Product+Image',
        productDescription: 'Comfortable everyday hoodie with a relaxed fit.',
        reviewReviewer: 'Alex Taylor',
        reviewRating: '5',
        reviewContent: 'Great quality and very fast shipping.',
        reviewProductName: 'Classic Hoodie',
        reviewProductUrl: `${storeUrl.replace(/\/$/, '')}/products/classic-hoodie`,
    };
}

function normalizePreviewStoreUrl(raw: unknown): string {
    const value = String(raw || '').trim();
    if (!value || value.includes('{{')) return 'https://example.com';
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value}`;
}

function buildAusPostPreviewTrackingUrl(trackingNumber: string): string {
    const trimmed = trackingNumber.trim();
    if (!trimmed) return '';
    return `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(trimmed)}`;
}

function extractPreviewTracking(order: Record<string, unknown>): { trackingNumber: string; trackingUrl: string; auspostTrackingUrl: string } {
    const directItems = Array.isArray(order.tracking_items)
        ? order.tracking_items as Array<Record<string, unknown>>
        : Array.isArray(order.trackingItems)
            ? order.trackingItems as Array<Record<string, unknown>>
            : [];
    const firstItem = directItems[0] || {};
    const trackingNumber = String(
        firstItem.trackingNumber
        || firstItem.tracking_number
        || order.trackingNumber
        || order.tracking_number
        || ''
    ).trim();
    const auspostTrackingUrl = buildAusPostPreviewTrackingUrl(trackingNumber);
    const trackingUrl = String(
        firstItem.trackingUrl
        || firstItem.tracking_url
        || firstItem.tracking_link
        || order.trackingUrl
        || order.tracking_url
        || auspostTrackingUrl
        || ''
    ).trim();

    return { trackingNumber, trackingUrl, auspostTrackingUrl };
}

function escapePreviewHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPreviewOrderItemImage(item: Record<string, unknown>): string {
    const image = item.image;
    if (typeof image === 'string') return image.trim();
    if (image && typeof image === 'object') {
        const imageValue = image as Record<string, unknown>;
        return String(imageValue.src || imageValue.url || '').trim();
    }

    const images = item.images;
    if (Array.isArray(images) && images.length > 0) {
        const firstImage = images[0];
        if (typeof firstImage === 'string') return firstImage.trim();
        if (firstImage && typeof firstImage === 'object') {
            const imageValue = firstImage as Record<string, unknown>;
            return String(imageValue.src || imageValue.url || '').trim();
        }
    }

    return String(item.productImage || item.product_image || item.thumbnail || item.thumbnail_url || '').trim();
}

function renderPreviewOrderItemsTable(items: Array<Record<string, unknown>>, formatMoney: (value: unknown) => string): string {
    if (!items.length) return '<p style="color:#6b7280;font-style:italic;">No items</p>';

    const rows = items.map((item) => {
        const image = getPreviewOrderItemImage(item);
        const name = escapePreviewHtml(String(item.name || item.productName || 'Product'));
        const quantity = escapePreviewHtml(String(item.quantity || 1));
        const price = escapePreviewHtml(formatMoney(item.total || item.price));
        const itemMeta = getInvoiceItemMeta(item)
            .filter((meta) => String(meta.value || '').trim())
            .slice(0, 12)
            .map((meta) => `${escapePreviewHtml(meta.label)}: ${escapePreviewHtml(String(meta.value || '').replace(/\s+/g, ' ').trim())}`)
            .join('<br />');
        return `<tr style="border-bottom:1px solid #e5e7eb;">${image ? `<td style="padding:12px;vertical-align:top;"><img src="${escapePreviewHtml(image)}" alt="${name}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;" /></td>` : '<td style="padding:12px;"></td>'}<td style="padding:12px;color:#374151;">${name}${itemMeta ? `<br /><span style="font-size:12px;color:#6b7280;">${itemMeta}</span>` : ''}</td><td style="padding:12px;text-align:center;color:#374151;">${quantity}</td><td style="padding:12px;text-align:right;color:#374151;">${price}</td></tr>`;
    }).join('');

    return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;"><thead><tr style="background:#f3f4f6;"><th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;width:60px;"></th><th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Product</th><th style="padding:12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;width:60px;">Qty</th><th style="padding:12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;width:100px;">Price</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPreviewOrderItemsCompact(items: Array<Record<string, unknown>>, formatMoney: (value: unknown) => string): string {
    if (!items.length) return '<p style="color:#6b7280;font-style:italic;">No items</p>';

    return `<div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif;">${items.map((item) => {
        const name = escapePreviewHtml(String(item.name || item.productName || item.product_name || 'Product'));
        const quantity = escapePreviewHtml(String(item.quantity || 1));
        const total = escapePreviewHtml(formatMoney(item.total || item.price));
        return `<div style="padding:12px;border-bottom:1px solid #e5e7eb;color:#374151;"><strong>${name}</strong><br><span style="font-size:13px;color:#6b7280;">Qty: ${quantity} &middot; ${total}</span></div>`;
    }).join('')}</div>`;
}

function renderPreviewOrderItemsList(items: Array<Record<string, unknown>>): string {
    if (!items.length) return '<p style="color:#6b7280;font-style:italic;">No items</p>';

    return `<ul style="margin:0;padding-left:20px;color:#374151;line-height:1.6;font-family:Arial,sans-serif;">${items.map((item) => {
        const name = escapePreviewHtml(String(item.name || item.productName || item.product_name || 'Product'));
        const quantity = escapePreviewHtml(String(item.quantity || 1));
        return `<li>${quantity} x ${name}</li>`;
    }).join('')}</ul>`;
}

function parseBoxSpacing(value: string): [number, number, number, number] {
    const parts = value.trim().split(/\s+/).map((part) => Number(part.replace('px', '')) || 0);
    if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
    if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
    if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] || 0];
}

function toBoxSpacing(values: [number, number, number, number]): string {
    return values.map((value) => `${Math.max(0, Math.round(value))}px`).join(' ');
}

function normalizeColumnWidths(section: EmailSection) {
    if (section.columns.length === 0) return;
    const total = section.columns.reduce((sum, column) => sum + Math.max(1, column.width || 0), 0);
    let running = 0;
    section.columns.forEach((column, index) => {
        if (index === section.columns.length - 1) {
            column.width = Math.max(1, 100 - running);
            return;
        }
        const next = Math.max(1, Math.round((Math.max(1, column.width || 0) / total) * 100));
        column.width = next;
        running += next;
    });
}

function isEmailSafeImageUrl(value: string): boolean {
    const candidate = value.trim();
    if (!candidate) return false;
    return /^(https?:|data:|cid:)/i.test(candidate);
}

export function EmailDesignEditorV2({ initialDesign, initialSubject = '', initialPreviewText = '', onSave, onCancel }: Props) {
    const { token, user } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
    const [design, setDesign] = useState<EmailDesignV2Envelope>(() => {
        return createEmailDesignV2FromUnknown(initialDesign, {
            title: initialSubject,
            previewText: initialPreviewText,
            appName: currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store',
            logoUrl: currentAccount?.appearance?.logoUrl || '',
            primaryColor: currentAccount?.appearance?.primaryColor || '#4f46e5',
        });
    });
    const [selectedSectionId, setSelectedSectionId] = useState(() => design.document.sections[0]?.id || '');
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [leftSidebarMode, setLeftSidebarMode] = useState<LeftSidebarMode>('builder');
    const [builderTab, setBuilderTab] = useState<BuilderTab>('blocks');
    const [blockSearch, setBlockSearch] = useState('');
    const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
    const [previewSurface, setPreviewSurface] = useState<'canvas' | 'html'>('canvas');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [issues, setIssues] = useState<PreflightIssue[]>([]);
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [savedSections, setSavedSections] = useState<SavedSectionPreset[]>([]);
    const [testEmail, setTestEmail] = useState(user?.email || '');
    const [testStatus, setTestStatus] = useState<string | null>(null);
    const [sendingTest, setSendingTest] = useState(false);
    const [recentRecipients, setRecentRecipients] = useState<string[]>([]);
    const [missingEmailAccount, setMissingEmailAccount] = useState(false);
    const [invoiceLogoUrl, setInvoiceLogoUrl] = useState('');
    const [previewMergeContext, setPreviewMergeContext] = useState<PreviewMergeContext | null>(null);

    const html = useMemo(() => compileEmailDesignV2(design), [design]);
    const mergedPreviewHtml = useMemo(() => (
        previewMergeContext ? applyPreviewMergeTags(html, previewMergeContext) : html
    ), [html, previewMergeContext]);
    const iframePreviewHtml = useMemo(() => {
        const baseHref = typeof window !== 'undefined' ? window.location.origin : '';
        if (!baseHref) return mergedPreviewHtml;
        return mergedPreviewHtml.includes('<head>')
            ? mergedPreviewHtml.replace('<head>', `<head><base href="${baseHref}/">`)
            : mergedPreviewHtml;
    }, [mergedPreviewHtml]);
    const selectedSection = design.document.sections.find((section) => section.id === selectedSectionId) || design.document.sections[0];
    const selectedBlock = selectedSection?.columns.flatMap((column) => column.blocks).find((block) => block.id === selectedBlockId) || null;
    const groupedIssues = groupPreflightIssues(issues);
    const designWarnings = useMemo(() => getEmailDesignWarnings(design), [design]);
    const visiblePaletteItems = paletteItems.filter((item) => item.label.toLowerCase().includes(blockSearch.trim().toLowerCase()));
    const saveStatus = saving ? 'Autosaving...' : saveError ? 'Autosave failed, draft kept' : hasUnsavedChanges ? 'Autosave pending' : lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : 'Ready';
    const hideOnDesktop = selectedSection?.visibility === 'mobile';
    const hideOnMobile = selectedSection?.visibility === 'desktop';

    const appearanceLogoUrl = currentAccount?.appearance?.logoUrl || '';
    const brandLogoUrl = isEmailSafeImageUrl(invoiceLogoUrl) ? invoiceLogoUrl : appearanceLogoUrl;
    const accountName = currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store';
    const accountFooterHtml = currentAccount?.appearance?.emailFooterHtml || createAccountFooterHtml(accountName);

    useEffect(() => {
        const accountMeta = currentAccount as unknown as Record<string, unknown>;
        const baseStoreUrl = normalizePreviewStoreUrl(accountMeta?.woocommerceUrl || accountMeta?.url);
        const fallbackContext = createFallbackPreviewMergeContext(baseStoreUrl);

        if (!token || !currentAccount?.id) {
            setPreviewMergeContext(fallbackContext);
            return;
        }

        setPreviewMergeContext(fallbackContext);

        const controller = new AbortController();

        const fetchPreviewData = async () => {
            try {
                const listResponse = await fetch('/api/orders?limit=1', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id,
                    },
                    signal: controller.signal,
                });

                if (!listResponse.ok) return;
                const listPayload = await listResponse.json() as { orders?: Array<{ id?: string; wooId?: number }> };
                const newest = listPayload.orders?.[0];
                if (!newest?.id) return;

                const detailResponse = await fetch(`/api/orders/${newest.id}`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id,
                    },
                    signal: controller.signal,
                });
                if (!detailResponse.ok) return;

                const order = await detailResponse.json() as Record<string, unknown>;
                const billing = (order.billing as Record<string, unknown> | undefined) || {};
                const shipping = (order.shipping as Record<string, unknown> | undefined) || {};
                const lineItems = Array.isArray(order.line_items) ? order.line_items as Array<Record<string, unknown>> : [];
                const firstItem = lineItems[0] || {};

                const firstName = String(billing.first_name || '').trim();
                const lastName = String(billing.last_name || '').trim();
                const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Customer';
                const productName = String(firstItem.name || 'Product');
                const productTotal = String(firstItem.total || firstItem.price || order.total || '');
                const currency = String(order.currency || 'AUD');
                const storeUrl = normalizePreviewStoreUrl(accountMeta.woocommerceUrl || accountMeta.url);

                const fmtDate = (raw: unknown) => {
                    const value = String(raw || '');
                    if (!value) return '';
                    const parsed = new Date(value);
                    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' });
                };
                const fmtMoney = (raw: unknown) => {
                    const value = Number(raw);
                    if (!Number.isFinite(value)) return String(raw || '');
                    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
                };
                const fmtAddress = (address: Record<string, unknown>) => {
                    const parts = [
                        [address.first_name, address.last_name].filter(Boolean).join(' '),
                        address.company,
                        address.address_1,
                        address.address_2,
                        [address.city, address.state, address.postcode].filter(Boolean).join(', '),
                        address.country,
                    ].filter(Boolean);
                    return parts.join('<br />');
                };

                const lineItemPermalink = String(firstItem.permalink || firstItem.product_permalink || '').trim();
                const productPath = firstItem.slug ? `/product/${String(firstItem.slug)}` : `/?p=${String(firstItem.product_id || '')}`;
                const resolvedProductUrl = lineItemPermalink || `${storeUrl.replace(/\/$/, '')}${productPath}`;
                const tracking = extractPreviewTracking(order);

                setPreviewMergeContext({
                    storeUrl,
                    customerFirstName: firstName,
                    customerLastName: lastName,
                    customerEmail: String(billing.email || ''),
                    customerPhone: String(billing.phone || ''),
                    orderNumber: String(order.number || order.id || ''),
                    orderDate: fmtDate(order.date_created),
                    orderStatus: String(order.status || ''),
                    orderSubtotal: fmtMoney(order.subtotal),
                    orderShippingTotal: fmtMoney(order.shipping_total),
                    orderDiscountTotal: fmtMoney(order.discount_total),
                    orderTotal: fmtMoney(order.total),
                    orderItemsTable: renderPreviewOrderItemsTable(lineItems, fmtMoney),
                    orderItemsCompact: renderPreviewOrderItemsCompact(lineItems, fmtMoney),
                    orderItemsList: renderPreviewOrderItemsList(lineItems),
                    orderCustomerNote: String(order.customer_note || ''),
                    orderTrackingNumber: tracking.trackingNumber,
                    orderTrackingUrl: tracking.trackingUrl,
                    orderAuspostTrackingUrl: tracking.auspostTrackingUrl,
                    billingAddress: fmtAddress(billing),
                    shippingAddress: fmtAddress(shipping),
                    productName,
                    productPrice: fmtMoney(productTotal),
                    productImage: String((firstItem.image as Record<string, unknown> | undefined)?.src || ''),
                    productDescription: String(firstItem.name ? `From your latest order: ${firstItem.name}` : ''),
                    reviewReviewer: fullName,
                    reviewRating: '5',
                    reviewContent: `I love my ${productName}. Great quality and fast shipping.`,
                    reviewProductName: productName,
                    reviewProductUrl: resolvedProductUrl,
                });
            } catch {
                // Preview data is best-effort and should not block editing.
            }
        };

        fetchPreviewData();

        return () => {
            controller.abort();
        };
    }, [token, currentAccount]);

    const autosaveTimerRef = useRef<number | null>(null);
    const latestDesignRef = useRef(design);
    const latestHtmlRef = useRef(html);
    const baselineDesignRef = useRef(JSON.stringify(design));
    const autosaveInFlightRef = useRef(false);
    const autosaveAgainRef = useRef(false);
    const didMountRef = useRef(false);

    const setDirtyDesign = useCallback((updater: (draft: EmailDesignV2Envelope) => void) => {
        setDesign((current) => {
            const next = cloneDesign(current);
            updater(next);
            try {
                localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ design: next, updatedAt: new Date().toISOString() }));
            } catch {
                // Draft persistence is best-effort and should not block editing.
            }
            setHasUnsavedChanges(true);
            setSaveError(false);
            return next;
        });
    }, []);

    const saveSnapshot = useCallback((nextDesign: EmailDesignV2Envelope) => {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        let current: Snapshot[] = [];
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Snapshot[];
                current = Array.isArray(parsed) ? parsed : [];
            } catch {
                current = [];
            }
        }
        const next = [{ id: createEmailDesignId('snapshot'), createdAt: new Date().toISOString(), design: nextDesign }, ...current].slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
        setSnapshots(next);
    }, []);

    const addStructurePreset = (widths: number[], insertIndex?: number) => {
        setDirtyDesign((draft) => {
            const section: EmailSection = {
                id: createEmailDesignId('section'),
                name: widths.length === 1 ? 'New section' : `${widths.length}-column section`,
                backgroundColor: draft.document.theme.contentBackgroundColor,
                padding: '22px 28px',
                visibility: 'all',
                stackMode: 'stack',
                columns: widths.map((width) => ({
                    id: createEmailDesignId('column'),
                    width,
                    blocks: [],
                })),
            };
            if (typeof insertIndex === 'number') {
                draft.document.sections.splice(insertIndex, 0, section);
            } else {
                draft.document.sections.push(section);
            }
            setSelectedSectionId(section.id);
            setSelectedBlockId(null);
        });
    };

    const handleDropStructure = (event: DragEvent, insertIndex: number) => {
        event.preventDefault();
        event.stopPropagation();
        const structureWidths = event.dataTransfer.getData('application/x-overseek-structure');
        if (!structureWidths) return;
        addStructurePreset(JSON.parse(structureWidths) as number[], insertIndex);
    };

    const addPaletteBlock = (sectionId: string, key: PaletteKey, insertIndex?: number, columnId?: string) => {
        const logoUrl = brandLogoUrl;
        const socialLinks = currentAccount?.appearance?.socialLinks || [];
        const block = createPaletteBlock(key, accountName, logoUrl, socialLinks, accountFooterHtml);
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === sectionId);
            const column = columnId ? section?.columns.find((item) => item.id === columnId) : section?.columns[0];
            const blocks = column?.blocks;
            if (!blocks) return;
            if (typeof insertIndex === 'number') blocks.splice(insertIndex, 0, block);
            else blocks.push(block);
            setSelectedSectionId(sectionId);
            setSelectedBlockId(block.id);
        });
    };

    const moveBlock = (blockId: string, targetSectionId: string, targetIndex?: number, columnId?: string) => {
        setDirtyDesign((draft) => {
            let movingBlock: EmailBlock | null = null;
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const currentIndex = column.blocks.findIndex((block) => block.id === blockId);
                    if (currentIndex >= 0) {
                        [movingBlock] = column.blocks.splice(currentIndex, 1);
                    }
                }
            }
            if (!movingBlock) return;
            const targetSection = draft.document.sections.find((section) => section.id === targetSectionId);
            const targetColumn = columnId ? targetSection?.columns.find((item) => item.id === columnId) : targetSection?.columns[0];
            const blocks = targetColumn?.blocks;
            if (!blocks) return;
            const nextIndex = typeof targetIndex === 'number' ? Math.min(targetIndex, blocks.length) : blocks.length;
            blocks.splice(nextIndex, 0, movingBlock);
            setSelectedSectionId(targetSectionId);
            setSelectedBlockId(blockId);
        });
    };

    const handleDropOnSection = (event: DragEvent, sectionId: string, insertIndex?: number, columnId?: string) => {
        event.preventDefault();
        event.stopPropagation();
        const structureWidths = event.dataTransfer.getData('application/x-overseek-structure');
        const paletteKey = event.dataTransfer.getData('application/x-overseek-block') as PaletteKey;
        const blockId = event.dataTransfer.getData('application/x-overseek-existing-block');
        if (structureWidths) return;
        else if (paletteKey) addPaletteBlock(sectionId, paletteKey, insertIndex, columnId);
        else if (blockId) moveBlock(blockId, sectionId, insertIndex, columnId);
    };

    const updateSection = (key: keyof EmailSection, value: string) => {
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === selectedSectionId);
            if (!section) return;
            if (key === 'visibility') section.visibility = value as EmailDeviceVisibility;
            else if (key === 'stackMode') section.stackMode = value as EmailStackMode;
            else if (key === 'name' || key === 'backgroundColor' || key === 'padding') section[key] = value;
        });
    };

    const updateSelectedSection = (updater: (section: EmailSection) => void) => {
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === selectedSectionId);
            if (!section) return;
            updater(section);
        });
    };

    const updateSectionPaddingSide = (sideIndex: number, value: string) => {
        updateSelectedSection((section) => {
            const next = parseBoxSpacing(section.padding || '0');
            next[sideIndex] = Number(value) || 0;
            section.padding = toBoxSpacing(next);
        });
    };

    const updateSectionBorderRadiusSide = (sideIndex: number, value: string) => {
        updateSelectedSection((section) => {
            const current = section.borderRadius || [0, 0, 0, 0];
            const next: [number, number, number, number] = [current[0], current[1], current[2], current[3]];
            next[sideIndex] = Number(value) || 0;
            section.borderRadius = next;
        });
    };

    const updateSectionColumnWidth = (columnId: string, value: string) => {
        updateSelectedSection((section) => {
            const width = Math.max(5, Math.min(100, Number(value) || 0));
            const column = section.columns.find((item) => item.id === columnId);
            if (!column) return;
            column.width = width;
            normalizeColumnWidths(section);
        });
    };

    const updateSectionColumn = (columnId: string, updater: (column: EmailColumn) => void) => {
        updateSelectedSection((section) => {
            const column = section.columns.find((item) => item.id === columnId);
            if (column) updater(column);
        });
    };

    const updateSectionColumnPaddingSide = (columnId: string, sideIndex: number, value: string) => {
        updateSectionColumn(columnId, (column) => {
            const next = parseBoxSpacing(column.padding || '0');
            next[sideIndex] = Math.max(0, Number(value) || 0);
            column.padding = toBoxSpacing(next);
        });
    };

    const addSectionColumn = () => {
        updateSelectedSection((section) => {
            const nextCount = section.columns.length + 1;
            const width = Math.max(10, Math.floor(100 / nextCount));
            section.columns.push({ id: createEmailDesignId('column'), width, blocks: [] });
            normalizeColumnWidths(section);
        });
    };

    const cloneSectionWithFreshIds = (section: EmailSection): EmailSection => {
        const next = cloneDesign({ engine: 'overseek-v2', version: 1, document: { meta: { title: '' }, theme: design.document.theme, sections: [section] } }).document.sections[0];
        next.id = createEmailDesignId('section');
        next.columns.forEach((column) => {
            column.id = createEmailDesignId('column');
            column.blocks.forEach((block) => { block.id = createEmailDesignId(block.type); });
        });
        return next;
    };

    const saveSelectedSectionPreset = () => {
        if (!selectedSection) return;
        const name = window.prompt('Save structure as', selectedSection.name || 'Reusable section')?.trim();
        if (!name) return;
        const nextPreset: SavedSectionPreset = { id: createEmailDesignId('section-preset'), name, section: cloneSectionWithFreshIds(selectedSection) };
        const next = [nextPreset, ...savedSections.filter((preset) => preset.name !== name)].slice(0, 12);
        setSavedSections(next);
        localStorage.setItem(SAVED_SECTIONS_STORAGE_KEY, JSON.stringify(next));
    };

    const insertSavedSectionPreset = (preset: SavedSectionPreset) => {
        setDirtyDesign((draft) => {
            const section = cloneSectionWithFreshIds(preset.section);
            draft.document.sections.push(section);
            setSelectedSectionId(section.id);
            setSelectedBlockId(null);
        });
    };

    const removeSectionColumn = (columnId: string) => {
        updateSelectedSection((section) => {
            if (section.columns.length <= 1) return;
            const index = section.columns.findIndex((item) => item.id === columnId);
            if (index < 0) return;
            const removed = section.columns[index];
            const fallbackIndex = index === 0 ? 1 : index - 1;
            const fallback = section.columns[fallbackIndex];
            if (removed?.blocks?.length && fallback) {
                fallback.blocks.unshift(...removed.blocks);
            }
            section.columns = section.columns.filter((item) => item.id !== columnId);
            normalizeColumnWidths(section);
        });
    };

    const setSectionHideOnDesktop = (checked: boolean) => {
        updateSelectedSection((section) => {
            if (checked) section.visibility = 'mobile';
            else if (section.visibility === 'mobile') section.visibility = 'all';
        });
    };

    const setSectionHideOnMobile = (checked: boolean) => {
        updateSelectedSection((section) => {
            if (checked) section.visibility = 'desktop';
            else if (section.visibility === 'desktop') section.visibility = 'all';
        });
    };

    const updateBlock = (updater: (block: EmailBlock) => void) => {
        if (!selectedBlockId) return;
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const block = column.blocks.find((item) => item.id === selectedBlockId);
                    if (block) updater(block);
                }
            }
        });
    };

    const updateBlockById = (blockId: string, updater: (block: EmailBlock) => void) => {
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const block = column.blocks.find((item) => item.id === blockId);
                    if (block) updater(block);
                }
            }
        });
    };

    const updateTheme = (key: keyof EmailDesignV2Envelope['document']['theme'], value: string | number) => {
        setDirtyDesign((draft) => {
            Object.assign(draft.document.theme, { [key]: value });
        });
    };

    const duplicateBlock = (blockId: string) => {
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const index = column.blocks.findIndex((item) => item.id === blockId);
                    if (index < 0) continue;
                    if (column.blocks[index]?.type === 'footer') return;
                    const duplicated = typeof structuredClone === 'function' ? structuredClone(column.blocks[index]) : JSON.parse(JSON.stringify(column.blocks[index]));
                    duplicated.id = createEmailDesignId(duplicated.type);
                    column.blocks.splice(index + 1, 0, duplicated);
                    setSelectedSectionId(section.id);
                    setSelectedBlockId(duplicated.id);
                    return;
                }
            }
        });
    };

    const deleteBlockById = (blockId: string) => {
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    column.blocks = column.blocks.filter((block) => block.id !== blockId || block.type === 'footer');
                }
            }
            if (selectedBlockId === blockId) setSelectedBlockId(null);
        });
    };

    const deleteSelectedBlock = () => {
        if (!selectedBlockId) return;
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    column.blocks = column.blocks.filter((block) => block.id !== selectedBlockId || block.type === 'footer');
                }
            }
            setSelectedBlockId(null);
        });
    };

    const deleteSectionById = (sectionId: string) => {
        if (design.document.sections.length <= 1) return;
        setDirtyDesign((draft) => {
            draft.document.sections = draft.document.sections.filter((section) => section.id !== sectionId);
            setSelectedSectionId(draft.document.sections[0]?.id || '');
            setSelectedBlockId(null);
        });
    };

    const deleteSelectedSection = () => {
        if (!selectedSection) return;
        deleteSectionById(selectedSection.id);
    };

    const saveSocialLinksAsDefaults = async (links: Array<{ label: string; href: string }>) => {
        if (!currentAccount || !token) return;
        const appearance = {
            ...(currentAccount.appearance || {}),
            socialLinks: links.filter((link) => link.label.trim() && link.href.trim()),
        };
        const response = await fetch(`/api/accounts/${currentAccount.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ appearance }),
        });
        if (response.ok) {
            await refreshAccounts();
        }
    };

    const applyStarterLayout = (type: 'promo' | 'product' | 'cart' | 'followup' | 'coupon' | 'review') => {
        const logoUrl = brandLogoUrl;
        const heroCopy: Record<typeof type, string> = {
            promo: '<h2>Something new just landed</h2><p>Give customers a clear reason to click with a focused offer and one strong call to action.</p>',
            product: '<h2>Meet your next favourite product</h2><p>Showcase the item, explain the benefit, and send customers straight to the product page.</p>',
            cart: '<h2>You left something behind</h2><p>Your basket is still waiting. Complete checkout before your items sell out.</p>',
            followup: '<h2>Thanks for your order</h2><p>Here is everything you need to know about what happens next.</p>',
            coupon: '<h2>A little thank you</h2><p>Use this code on your next order before it expires.</p>',
            review: '<h2>Share your experience</h2><p>Your feedback helps other shoppers and helps us keep improving every order.</p>',
        };
        setDirtyDesign((draft) => {
            draft.document.sections = [
                {
                    id: createEmailDesignId('section'),
                    name: 'Header',
                    backgroundColor: draft.document.theme.contentBackgroundColor,
                    padding: '24px 28px 12px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{ id: createEmailDesignId('column'), width: 100, blocks: [createPaletteBlock('siteLogo', accountName, logoUrl)] }],
                },
                {
                    id: createEmailDesignId('section'),
                    name: 'Main message',
                    backgroundColor: draft.document.theme.contentBackgroundColor,
                    padding: '18px 28px 28px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{
                        id: createEmailDesignId('column'),
                        width: 100,
                        blocks: [
                            { id: createEmailDesignId('text'), type: 'text', props: { html: heroCopy[type], align: 'center', size: 16, lineHeight: 1.65 } },
                            type === 'product'
                                ? createBlock('product')
                                : type === 'coupon'
                                    ? createBlock('coupon')
                                    : type === 'review'
                                        ? createBlock('review')
                                        : createBlock('button'),
                        ],
                    }],
                },
                {
                    id: createEmailDesignId('section'),
                    name: 'Footer',
                    backgroundColor: '#f8fafc',
                    padding: '18px 28px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{ id: createEmailDesignId('column'), width: 100, blocks: [createPaletteBlock('footer', accountName, '', [], accountFooterHtml)] }],
                },
            ];
            setSelectedSectionId(draft.document.sections[1]?.id || draft.document.sections[0]?.id || '');
            setSelectedBlockId(null);
        });
    };

    const runChecklist = () => {
        setIssues([
            ...evaluateEmailPreflight({ html, subject: design.document.meta.title, emailCategory: design.document.meta.category || 'MARKETING' }),
            ...designWarnings.map((warning) => ({ id: warning.id, severity: 'warning' as const, message: warning.message })),
        ]);
        setLeftSidebarMode('checklist');
    };

    const persistLatestDesign = useCallback(async () => {
        const nextDesign = latestDesignRef.current;
        const serializedAtStart = JSON.stringify(nextDesign);
        if (serializedAtStart === baselineDesignRef.current) return;

        if (autosaveInFlightRef.current) {
            autosaveAgainRef.current = true;
            return;
        }

        autosaveInFlightRef.current = true;
        setSaving(true);
        setSaveError(false);

        try {
            await onSave(latestHtmlRef.current, nextDesign, {
                subject: nextDesign.document.meta.title,
                previewText: nextDesign.document.meta.previewText || '',
                autosave: true,
            });

            try {
                saveSnapshot(nextDesign);
            } catch {
                // Version history is best-effort and should not mark server autosave as failed.
            }
            baselineDesignRef.current = serializedAtStart;

            if (JSON.stringify(latestDesignRef.current) === serializedAtStart) {
                try {
                    localStorage.removeItem(DRAFT_STORAGE_KEY);
                } catch {
                    // Ignore local draft cleanup failures.
                }
                setHasUnsavedChanges(false);
                setLastSavedAt(new Date());
            } else {
                setHasUnsavedChanges(true);
                autosaveAgainRef.current = true;
            }
        } catch {
            setSaveError(true);
            setHasUnsavedChanges(true);
        } finally {
            autosaveInFlightRef.current = false;
            setSaving(false);

            if (autosaveAgainRef.current) {
                autosaveAgainRef.current = false;
                if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = window.setTimeout(() => {
                    autosaveTimerRef.current = null;
                    void persistLatestDesign();
                }, 500);
            }
        }
    }, [onSave, saveSnapshot]);

    const sendTestEmail = async () => {
        const recipient = testEmail.trim();
        if (!recipient || !recipient.includes('@') || !currentAccount) {
            setTestStatus('Enter a valid recipient first.');
            return;
        }
        setSendingTest(true);
        setTestStatus(null);
        setMissingEmailAccount(false);
        try {
            const response = await fetch('/api/marketing/test-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify({ to: recipient, subject: design.document.meta.title || 'Email Builder Test', content: html }),
            });
            if (!response.ok) {
                const payload = await response.json();
                const message = payload?.error || payload?.message || 'Failed to send test email.';
                const isMissingEmailAccount = message.includes('No email account configured') || message.includes('No sending-capable email account');
                setMissingEmailAccount(isMissingEmailAccount);
                setTestStatus(isMissingEmailAccount ? 'No sending email account is configured. Add one in Settings > Email before sending a test.' : message);
                return;
            }
            const nextRecipients = [recipient, ...recentRecipients.filter((item) => item !== recipient)].slice(0, MAX_TEST_RECIPIENTS);
            localStorage.setItem(RECENT_TEST_RECIPIENTS_KEY, JSON.stringify(nextRecipients));
            setRecentRecipients(nextRecipients);
            setTestStatus(`Test email sent to ${recipient}.`);
        } catch {
            setTestStatus('Failed to send test email.');
        } finally {
            setSendingTest(false);
        }
    };

    const handleClose = async () => {
        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }

        if (hasUnsavedChanges) {
            await persistLatestDesign();
        }

        onCancel();
    };

    useEffect(() => {
        latestDesignRef.current = design;
        latestHtmlRef.current = html;

        if (!didMountRef.current) {
            didMountRef.current = true;
            baselineDesignRef.current = JSON.stringify(design);
            return;
        }

        const serialized = JSON.stringify(design);
        const dirty = serialized !== baselineDesignRef.current;
        setHasUnsavedChanges(dirty);

        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }

        if (!dirty) return;

        try {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ design, updatedAt: new Date().toISOString() }));
        } catch {
            // Draft persistence is best-effort. Server autosave still runs below.
        }

        autosaveTimerRef.current = window.setTimeout(() => {
            autosaveTimerRef.current = null;
            void persistLatestDesign();
        }, 1000);

        return () => {
            if (autosaveTimerRef.current) {
                window.clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
            }
        };
    }, [design, html, persistLatestDesign]);

    useEffect(() => {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Snapshot[];
                setSnapshots(Array.isArray(parsed) ? parsed : []);
            } catch {
                setSnapshots([]);
            }
        }
        const savedSectionsRaw = localStorage.getItem(SAVED_SECTIONS_STORAGE_KEY);
        if (savedSectionsRaw) {
            try {
                const parsed = JSON.parse(savedSectionsRaw) as SavedSectionPreset[];
                setSavedSections(Array.isArray(parsed) ? parsed : []);
            } catch {
                setSavedSections([]);
            }
        }
        const recipientRaw = localStorage.getItem(RECENT_TEST_RECIPIENTS_KEY);
        if (recipientRaw) {
            try {
                const parsed = JSON.parse(recipientRaw) as string[];
                setRecentRecipients(Array.isArray(parsed) ? parsed.slice(0, MAX_TEST_RECIPIENTS) : []);
            } catch {
                setRecentRecipients([]);
            }
        }
    }, []);

    useEffect(() => {
        if (!token || !currentAccount) return;
        const loadInvoiceLogo = async () => {
            try {
                const response = await fetch('/api/invoices/templates', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id,
                    },
                });
                if (!response.ok) return;
                const templates = await response.json() as InvoiceTemplateRecord[];
                const layout = templates[0]?.layout;
                const parsed = typeof layout === 'string' ? JSON.parse(layout) as { items?: Array<{ type?: string; logo?: string; content?: string }> } : layout;
                const items = Array.isArray(parsed?.items) ? parsed.items : [];
                const logoItem = items.find((item) => item.logo || (item.type === 'image' && item.content));
                const logo = logoItem?.logo || logoItem?.content || '';
                if (logo) setInvoiceLogoUrl(logo);
            } catch {
                // Invoice logo is optional. Account appearance remains the fallback.
            }
        };
        loadInvoiceLogo();
    }, [currentAccount, token]);

    useEffect(() => {
        if (!brandLogoUrl) return;
        setDesign((current) => {
            const next = cloneDesign(current);
            let changed = false;
            for (const section of next.document.sections) {
                for (const column of section.columns) {
                    for (const block of column.blocks) {
                        if (block.type === 'siteLogo' && block.props.src !== brandLogoUrl) {
                            block.props.src = brandLogoUrl;
                            changed = true;
                        }
                    }
                }
            }
            return changed ? next : current;
        });
    }, [brandLogoUrl]);

    useEffect(() => {
        if (!accountFooterHtml) return;
        setDesign((current) => {
            const next = cloneDesign(current);
            let changed = false;
            for (const section of next.document.sections) {
                for (const column of section.columns) {
                    for (const block of column.blocks) {
                        if (block.type === 'footer' && block.props.html !== accountFooterHtml) {
                            block.props.html = accountFooterHtml;
                            changed = true;
                        }
                    }
                }
            }
            return changed ? next : current;
        });
    }, [accountFooterHtml]);

    useEffect(() => {
        const handler = (event: BeforeUnloadEvent) => {
            if (!hasUnsavedChanges) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/55 backdrop-blur-sm">
            <div className="flex h-full flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
                <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex min-w-0 items-center gap-3 border-r border-slate-200 pr-4 dark:border-slate-800">
                        <div className="min-w-0 flex-1">
                            <input
                                value={design.document.meta.title}
                                onChange={(event) => setDirtyDesign((draft) => { draft.document.meta.title = sanitizeBidiText(event.target.value); })}
                                placeholder="Add a Subject Text"
                                className="block w-full border-0 bg-transparent p-0 text-base font-semibold text-slate-950 placeholder:text-slate-950 focus:ring-0 dark:text-white dark:placeholder:text-white"
                                dir="ltr"
                                style={LTR_TEXT_STYLE}
                            />
                            <input
                                value={design.document.meta.previewText || ''}
                                onChange={(event) => setDirtyDesign((draft) => { draft.document.meta.previewText = sanitizeBidiText(event.target.value); })}
                                placeholder="Add a Preview Text"
                                className="mt-0.5 block w-full border-0 bg-transparent p-0 text-sm text-indigo-500 placeholder:text-indigo-500 focus:ring-0 dark:text-indigo-300"
                                dir="ltr"
                                style={LTR_TEXT_STYLE}
                            />
                        </div>
                        <Pencil size={17} className="shrink-0 text-slate-500 dark:text-slate-400" />
                    </div>
                    <div className="flex items-center justify-center gap-2">
                        <div className="flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                            <button onClick={() => setPreviewSurface('canvas')} className={`rounded-md px-2.5 py-2 text-xs font-semibold ${previewSurface === 'canvas' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Live canvas preview" aria-label="Live canvas preview">Canvas</button>
                            <button onClick={() => setPreviewSurface('html')} className={`rounded-md px-2.5 py-2 text-xs font-semibold ${previewSurface === 'html' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Real email HTML preview" aria-label="Real email HTML preview">Real Email</button>
                        </div>
                        <div className="flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                            <button onClick={() => setPreviewMode('desktop')} className={`rounded-md p-2 ${previewMode === 'desktop' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Desktop preview" aria-label="Desktop preview"><Monitor size={16} /></button>
                            <button onClick={() => setPreviewMode('mobile')} className={`rounded-md p-2 ${previewMode === 'mobile' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Mobile preview" aria-label="Mobile preview"><Smartphone size={16} /></button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold md:inline-flex ${saveError ? 'bg-red-100 text-red-800' : hasUnsavedChanges || saving ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {saveStatus}
                        </span>
                        <button onClick={runChecklist} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><ClipboardList size={16} />Checklist</button>
                        <button onClick={() => setLeftSidebarMode('history')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><History size={16} />History</button>
                        <button onClick={() => setLeftSidebarMode('test')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><Send size={16} />Test</button>
                        <button onClick={() => void handleClose()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{saving ? <Loader2 className="animate-spin" size={16} /> : <X size={16} />}Close</button>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[324px_1fr]">
                    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                        {leftSidebarMode === 'builder' && (
                            <>
                                <div className="m-3 grid grid-cols-3 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
                                    {(['structure', 'blocks', 'layouts'] as BuilderTab[]).map((tab) => (
                                        <button key={tab} onClick={() => setBuilderTab(tab)} className={`rounded-md px-3 py-2 capitalize transition ${builderTab === tab ? 'bg-white text-slate-950 shadow-md dark:bg-slate-950 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}>{tab}</button>
                                    ))}
                                </div>

                        {builderTab === 'blocks' && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
                                <label className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950">
                                    <Search size={15} />
                                    <input value={blockSearch} onChange={(event) => setBlockSearch(sanitizeBidiText(event.target.value))} placeholder="Search blocks" className="w-full border-0 bg-transparent p-0 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-0 dark:text-slate-100" dir="ltr" style={LTR_TEXT_STYLE} />
                                </label>
                                <div>
                                    <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">General</p>
                                    <PaletteGrid items={visiblePaletteItems.filter((item) => item.group === 'General')} onAdd={(key) => selectedSection && addPaletteBlock(selectedSection.id, key)} />
                                </div>
                                <div className="mt-6">
                                    <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">WooCommerce</p>
                                    <PaletteGrid items={visiblePaletteItems.filter((item) => item.group === 'WooCommerce')} onAdd={(key) => selectedSection && addPaletteBlock(selectedSection.id, key)} />
                                </div>
                            </div>
                        )}

                        {builderTab === 'structure' && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
                                <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">Structure</p>
                                <div className="space-y-5">
                                    {STRUCTURE_PRESETS.map((preset) => (
                                        <StructureSkeleton key={preset.id} preset={preset} onAdd={() => addStructurePreset(preset.widths)} />
                                    ))}
                                </div>
                                <p className="mb-2 mt-6 text-sm font-medium text-slate-950 dark:text-white">Starter layouts</p>
                                <div className="space-y-2">
                                    {([
                                        ['promo', 'Promo email'],
                                        ['product', 'New product'],
                                        ['cart', 'Abandoned cart'],
                                        ['followup', 'Order follow-up'],
                                        ['coupon', 'Coupon drop'],
                                        ['review', 'Review request'],
                                    ] as const).map(([type, label]) => (
                                        <button key={type} onClick={() => applyStarterLayout(type)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Layers size={15} />{label}</button>
                                    ))}
                                </div>
                                <p className="mb-2 mt-6 text-sm font-medium text-slate-950 dark:text-white">Reusable sections</p>
                                <div className="space-y-2">
                                    {savedSections.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">Save a structure from Structure settings to reuse it here.</p>}
                                    {savedSections.map((preset) => (
                                        <button key={preset.id} onClick={() => insertSavedSectionPreset(preset)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Layers size={15} />{preset.name}</button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {builderTab === 'layouts' && selectedSection && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 space-y-3">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Section settings</p>
                                <Field label="Name" value={selectedSection.name || ''} onChange={(value) => updateSection('name', value)} />
                                <SelectField label="Background type" value={selectedSection.backgroundType || 'solid'} options={['solid']} onChange={(value) => updateSelectedSection((section) => { section.backgroundType = value as 'solid'; })} />
                                <ColorField label="Background color" value={selectedSection.backgroundColor || '#ffffff'} onChange={(value) => updateSection('backgroundColor', value)} />
                                <SelectField label="Border style" value={selectedSection.borderStyle || 'none'} options={['none', 'solid', 'dashed', 'dotted']} onChange={(value) => updateSelectedSection((section) => { section.borderStyle = value as EmailSection['borderStyle']; })} />
                                {(selectedSection.borderStyle || 'none') !== 'none' && (
                                    <>
                                        <ColorField label="Border color" value={selectedSection.borderColor || '#e2e8f0'} onChange={(value) => updateSelectedSection((section) => { section.borderColor = value; })} />
                                        <Field label="Border width" type="number" value={String(selectedSection.borderWidth ?? 1)} onChange={(value) => updateSelectedSection((section) => { section.borderWidth = Math.max(1, Number(value) || 1); })} />
                                    </>
                                )}
                                <FourSideField label="Border radius" values={selectedSection.borderRadius || [0, 0, 0, 0]} onChange={updateSectionBorderRadiusSide} />
                                <FourSideField label="Padding" values={parseBoxSpacing(selectedSection.padding || '0')} onChange={updateSectionPaddingSide} />
                                <ToggleField label="Hide on desktop" checked={hideOnDesktop} onChange={setSectionHideOnDesktop} />
                                <ToggleField label="Hide on mobile" checked={hideOnMobile} onChange={setSectionHideOnMobile} />
                                <SelectField label="Mobile stack" value={selectedSection.stackMode || 'stack'} options={['stack', 'reverse', 'none']} onChange={(value) => updateSection('stackMode', value)} />
                                <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Display condition</p>
                                        <button
                                            type="button"
                                            onClick={() => updateSelectedSection((section) => {
                                                const current = section.displayCondition?.enabled ?? false;
                                                section.displayCondition = {
                                                    enabled: !current,
                                                    expression: section.displayCondition?.expression || 'customer.isVip',
                                                };
                                            })}
                                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"
                                        >
                                            {selectedSection.displayCondition?.enabled ? 'Remove condition' : 'Add condition'}
                                        </button>
                                    </div>
                                    {selectedSection.displayCondition?.enabled && (
                                        <Field
                                            label="Condition expression"
                                            value={selectedSection.displayCondition.expression || ''}
                                            onChange={(value) => updateSelectedSection((section) => {
                                                section.displayCondition = { enabled: true, expression: value };
                                            })}
                                        />
                                    )}
                                </div>
                                <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Columns</p>
                                        <button onClick={addSectionColumn} disabled={selectedSection.columns.length >= 4} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">Add column</button>
                                    </div>
                                    {selectedSection.columns.map((column, index) => (
                                        <div key={column.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className="text-xs text-slate-600 dark:text-slate-300">Column {index + 1}</span>
                                                <button onClick={() => removeSectionColumn(column.id)} disabled={selectedSection.columns.length <= 1} className="text-xs text-red-600 disabled:opacity-40">Remove</button>
                                            </div>
                                            <Field label="Width %" type="number" value={String(column.width)} onChange={(value) => updateSectionColumnWidth(column.id, value)} />
                                            <ColorField label="Background color" value={column.backgroundColor || selectedSection.backgroundColor || design.document.theme.contentBackgroundColor || '#ffffff'} onChange={(value) => updateSectionColumn(column.id, (draft) => { draft.backgroundColor = value; })} />
                                            <FourSideField label="Padding" values={parseBoxSpacing(column.padding || '0')} onChange={(sideIndex, value) => updateSectionColumnPaddingSide(column.id, sideIndex, value)} />
                                            <SelectField label="Vertical align" value={column.verticalAlign || 'top'} options={['top', 'middle', 'bottom']} onChange={(value) => updateSectionColumn(column.id, (draft) => { draft.verticalAlign = value as EmailColumn['verticalAlign']; })} />
                                        </div>
                                    ))}
                                </div>
                                <button onClick={deleteSelectedSection} disabled={design.document.sections.length <= 1} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash2 size={14} />Delete section</button>
                            </div>
                        )}
                        {builderTab === 'global' && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 space-y-3">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Global styles</p>
                                <Field label="Email background" value={design.document.theme.backgroundColor} onChange={(value) => updateTheme('backgroundColor', value)} />
                                <Field label="Content background" value={design.document.theme.contentBackgroundColor} onChange={(value) => updateTheme('contentBackgroundColor', value)} />
                                <Field label="Text color" value={design.document.theme.textColor} onChange={(value) => updateTheme('textColor', value)} />
                                <Field label="Primary color" value={design.document.theme.primaryColor} onChange={(value) => updateTheme('primaryColor', value)} />
                                <Field label="Font family" value={design.document.theme.fontFamily} onChange={(value) => updateTheme('fontFamily', value)} />
                                <Field label="Content width" type="number" value={String(design.document.theme.contentWidth)} onChange={(value) => updateTheme('contentWidth', Number(value) || 640)} />
                                <Field label="Border radius" type="number" value={String(design.document.theme.borderRadius)} onChange={(value) => updateTheme('borderRadius', Number(value) || 0)} />
                            </div>
                        )}
                                <div className="mt-auto flex border-t border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
                                    <button onClick={() => setBuilderTab('layouts')} className="flex flex-1 items-center justify-center gap-1 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"><Settings size={14} />Layout Settings</button>
                                    <button onClick={() => setBuilderTab('global')} className="flex flex-1 items-center justify-center gap-1 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"><Globe2 size={14} />Global Settings</button>
                                </div>
                            </>
                        )}

                        {leftSidebarMode === 'blockSettings' && (
                            <div className="min-h-0 flex-1 overflow-auto p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Block settings</p>
                                    <button type="button" onClick={() => setLeftSidebarMode('builder')} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" aria-label="Close block settings"><X size={16} /></button>
                                </div>
                                <BlockEditor block={selectedBlock} onUpdate={updateBlock} onDelete={deleteSelectedBlock} canDelete={selectedBlock?.type !== 'footer'} sections={design.document.sections} selectedSectionId={selectedSectionId} onSelectBlock={setSelectedBlockId} onDropOnSection={handleDropOnSection} onSaveSocialDefaults={saveSocialLinksAsDefaults} token={token || undefined} accountId={currentAccount?.id} />
                            </div>
                        )}

                        {leftSidebarMode === 'sectionSettings' && selectedSection && (
                            <div className="min-h-0 flex-1 overflow-auto p-4 space-y-3">
                                <PanelHeader title="Structure settings" onClose={() => setLeftSidebarMode('builder')} />
                                <Field label="Name" value={selectedSection.name || ''} onChange={(value) => updateSection('name', value)} />
                                <ColorField label="Background color" value={selectedSection.backgroundColor || design.document.theme.contentBackgroundColor || '#ffffff'} onChange={(value) => updateSection('backgroundColor', value)} />
                                <LabeledSelectField
                                    label="Border style"
                                    value={selectedSection.borderStyle || 'none'}
                                    options={[
                                        { value: 'none', label: 'Not Set' },
                                        { value: 'solid', label: 'Solid' },
                                        { value: 'dashed', label: 'Dashed' },
                                        { value: 'dotted', label: 'Dotted' },
                                    ]}
                                    onChange={(value) => updateSelectedSection((section) => { section.borderStyle = value as EmailSection['borderStyle']; })}
                                />
                                {(selectedSection.borderStyle || 'none') !== 'none' && (
                                    <>
                                        <ColorField label="Border color" value={selectedSection.borderColor || '#e2e8f0'} onChange={(value) => updateSelectedSection((section) => { section.borderColor = value; })} />
                                        <Field label="Border width" type="number" value={String(selectedSection.borderWidth ?? 1)} onChange={(value) => updateSelectedSection((section) => { section.borderWidth = Math.max(1, Number(value) || 1); })} />
                                    </>
                                )}
                                <LinkedFourSideField label="Border radius" values={selectedSection.borderRadius || [0, 0, 0, 0]} onChange={updateSectionBorderRadiusSide} />
                                <LinkedFourSideField label="Padding" values={parseBoxSpacing(selectedSection.padding || '0')} onChange={updateSectionPaddingSide} defaultLinked />
                                <ToggleField label="Responsive structure" checked={(selectedSection.stackMode || 'stack') !== 'none'} onChange={(checked) => updateSection('stackMode', checked ? 'stack' : 'none')} />
                                <ToggleField label="Hide on mobile" checked={hideOnMobile} onChange={setSectionHideOnMobile} />
                                <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Columns</p>
                                    {selectedSection.columns.map((column, index) => (
                                        <div key={column.id} className="space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
                                            <p className="text-xs text-slate-600 dark:text-slate-300">Column {index + 1}</p>
                                            <Field label="Width %" type="number" value={String(column.width)} onChange={(value) => updateSectionColumnWidth(column.id, value)} />
                                            <ColorField label="Background color" value={column.backgroundColor || selectedSection.backgroundColor || design.document.theme.contentBackgroundColor || '#ffffff'} onChange={(value) => updateSectionColumn(column.id, (draft) => { draft.backgroundColor = value; })} />
                                            <LinkedFourSideField label="Padding" values={parseBoxSpacing(column.padding || '0')} onChange={(sideIndex, value) => updateSectionColumnPaddingSide(column.id, sideIndex, value)} />
                                            <SelectField label="Vertical align" value={column.verticalAlign || 'top'} options={['top', 'middle', 'bottom']} onChange={(value) => updateSectionColumn(column.id, (draft) => { draft.verticalAlign = value as EmailColumn['verticalAlign']; })} />
                                        </div>
                                    ))}
                                </div>
                                <button type="button" onClick={saveSelectedSectionPreset} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200"><Layers size={14} />Save as reusable section</button>
                            </div>
                        )}

                        {leftSidebarMode === 'checklist' && <div className="min-h-0 flex-1 overflow-auto p-4"><PanelHeader title="Preflight checklist" onClose={() => setLeftSidebarMode('builder')} /><ChecklistPanel issues={issues} groupedIssues={groupedIssues} /></div>}
                        {leftSidebarMode === 'history' && <div className="min-h-0 flex-1 overflow-auto p-4"><PanelHeader title="Version history" onClose={() => setLeftSidebarMode('builder')} /><HistoryPanel snapshots={snapshots} onRestore={(snapshot) => { setDesign(cloneDesign(snapshot.design)); setSelectedSectionId(snapshot.design.document.sections[0]?.id || ''); setSelectedBlockId(null); setHasUnsavedChanges(true); }} /></div>}
                        {leftSidebarMode === 'test' && <div className="min-h-0 flex-1 overflow-auto p-4"><PanelHeader title="Send test email" onClose={() => setLeftSidebarMode('builder')} /><div className="space-y-3"><Field label="Recipient" value={testEmail} onChange={setTestEmail} type="email" />
                            {recentRecipients.length > 0 && <div className="flex flex-wrap gap-2">{recentRecipients.map((recipient) => <button key={recipient} onClick={() => setTestEmail(recipient)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-800 dark:text-slate-300">{recipient}</button>)}</div>}
                            {testStatus && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{testStatus}</p>}
                            {missingEmailAccount && <button onClick={() => { window.location.href = '/settings?tab=email'; }} className="inline-flex w-full items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">Set up email account</button>}
                            <button onClick={sendTestEmail} disabled={sendingTest} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{sendingTest ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}Send test</button></div></div>}
                    </aside>

                    <main className="min-h-0 overflow-auto bg-slate-200/70 p-4 dark:bg-slate-950">
                        <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3">
                            <p className="text-sm text-slate-600 dark:text-slate-300">{previewSurface === 'canvas' ? 'Live email canvas. Drag blocks into place and edit content directly.' : 'Real email preview from compiled HTML. This is the exact markup that gets saved and sent.'}</p>
                        </div>
                        {designWarnings.length > 0 && (
                            <div className="mx-auto mb-3 max-w-4xl rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100">
                                <div className="flex items-start gap-2">
                                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                    <div>
                                        <p className="font-semibold">Designer warnings</p>
                                        {designWarnings.slice(0, 3).map((warning) => <p key={warning.id}>{warning.message}</p>)}
                                        {designWarnings.length > 3 && <p>{designWarnings.length - 3} more warnings in the checklist.</p>}
                                    </div>
                                </div>
                            </div>
                        )}
                        {previewSurface === 'canvas' ? (
                            <ErrorBoundary
                                onReset={() => {
                                    setSelectedSectionId((prev) => prev || design.document.sections[0]?.id || '');
                                    setSelectedBlockId(null);
                                }}
                            >
                                <EmailDropCanvas theme={design.document.theme} previewMode={previewMode} sections={design.document.sections} selectedSectionId={selectedSectionId} selectedBlockId={selectedBlockId} onSelectSection={(id) => { setSelectedSectionId(id); setSelectedBlockId(null); }} onSelectBlock={setSelectedBlockId} onUpdateBlock={updateBlockById} onDuplicateBlock={duplicateBlock} onDeleteBlock={deleteBlockById} onDeleteSection={deleteSectionById} onOpenSettings={() => setLeftSidebarMode('blockSettings')} onOpenSectionSettings={() => setLeftSidebarMode('sectionSettings')} onDropOnSection={handleDropOnSection} onDropStructure={handleDropStructure} />
                            </ErrorBoundary>
                        ) : (
                            <div className="mx-auto w-full rounded-3xl border border-slate-300 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                <div className="mx-auto overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700" style={{ width: previewMode === 'mobile' ? 390 : Math.min(design.document.theme.contentWidth, 920), maxWidth: '100%' }}>
                                    <iframe
                                        title="Compiled email HTML preview"
                                        srcDoc={iframePreviewHtml}
                                        className="h-[78vh] w-full bg-white"
                                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                                    />
                                </div>
                            </div>
                        )}
                    </main>

                </div>
            </div>
        </div>
    );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <input type={type} value={value} onChange={(event) => onChange(sanitizeBidiText(event.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" dir="ltr" style={LTR_TEXT_STYLE} />
        </label>
    );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="flex gap-2">
                <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-800" />
                <input value={value} onChange={(event) => onChange(sanitizeBidiText(event.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" dir="ltr" style={LTR_TEXT_STYLE} />
            </div>
        </label>
    );
}

function FourSideField({ label, values, onChange }: { label: string; values: [number, number, number, number]; onChange: (index: number, value: string) => void }) {
    const sideLabels = ['Top', 'Right', 'Bottom', 'Left'];
    return (
        <div className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="grid grid-cols-4 gap-2">
                {values.map((value, index) => (
                    <label key={`${label}-${sideLabels[index]}`} className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">{sideLabels[index]}</span>
                        <input type="number" value={String(value)} onChange={(event) => onChange(index, event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                    </label>
                ))}
            </div>
        </div>
    );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
        </label>
    );
}

function StructureSkeleton({ preset, onAdd }: { preset: StructurePreset; onAdd: () => void }) {
    return (
        <button
            draggable
            onDragStart={(event) => {
                event.dataTransfer.setData('application/x-overseek-structure', JSON.stringify(preset.widths));
                event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={onAdd}
            className="w-full rounded-lg border border-slate-200 bg-white p-2 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-indigo-950/30"
            title="Drag structure into the email"
        >
            <div className="flex h-9 overflow-hidden rounded-md border border-dashed border-slate-500 dark:border-slate-500">
                {preset.widths.map((width, index) => (
                    <div key={`${preset.id}-${index}`} style={{ width: `${width}%` }} className="border-r border-dashed border-slate-500 last:border-r-0 dark:border-slate-500" />
                ))}
            </div>
        </button>
    );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
        </label>
    );
}

function LabeledSelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        </label>
    );
}

function LinkedFourSideField({ label, values, onChange, defaultLinked = true }: { label: string; values: [number, number, number, number]; onChange: (index: number, value: string) => void; defaultLinked?: boolean }) {
    const [isLinked, setIsLinked] = useState(defaultLinked);
    const sideLabels = ['Top', 'Right', 'Bottom', 'Left'];

    return (
        <div className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="grid grid-cols-4 gap-2">
                    {values.map((value, index) => (
                        <label key={`${label}-${sideLabels[index]}`} className="block">
                            <input
                                type="number"
                                value={String(value)}
                                onChange={(event) => {
                                    const nextValue = event.target.value;
                                    if (isLinked) {
                                        for (let i = 0; i < 4; i += 1) onChange(i, nextValue);
                                        return;
                                    }
                                    onChange(index, nextValue);
                                }}
                                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                            <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">{sideLabels[index]}</span>
                        </label>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={() => setIsLinked((current) => !current)}
                    className="h-10 rounded-lg border border-slate-300 px-2 text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    title={isLinked ? 'Unlock sides' : 'Link sides'}
                    aria-label={isLinked ? `Unlock ${label}` : `Link ${label}`}
                >
                    {isLinked ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
            </div>
        </div>
    );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
    return (
        <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" aria-label={`Close ${title}`}><X size={16} /></button>
        </div>
    );
}

function BlockEditor({ block, sections, selectedSectionId, onUpdate, onDelete, canDelete, onSelectBlock, onDropOnSection, onSaveSocialDefaults, token, accountId }: { block: EmailBlock | null; sections: EmailSection[]; selectedSectionId: string; onUpdate: (updater: (block: EmailBlock) => void) => void; onDelete: () => void; canDelete: boolean; onSelectBlock: (id: string) => void; onDropOnSection: (event: DragEvent, sectionId: string, insertIndex?: number, columnId?: string) => void; onSaveSocialDefaults: (links: Array<{ label: string; href: string }>) => void; token?: string; accountId?: string }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [showUrlInput, setShowUrlInput] = useState(false);
    const [urlDraft, setUrlDraft] = useState('');

    useEffect(() => {
        if (block?.type === 'image') {
            setUrlDraft(block.props.src || '');
        }
        setUploadError(null);
    }, [block]);

    if (!block) {
        const section = sections.find((item) => item.id === selectedSectionId);
        const blockEntries: Array<{ block: EmailBlock; index: number; columnId: string }> = [];
        for (const column of section?.columns || []) {
            column.blocks.forEach((item, index) => blockEntries.push({ block: item, index, columnId: column.id }));
        }
        return (
            <div className="space-y-3">
                <p className="font-semibold text-slate-900 dark:text-white">Blocks in section</p>
                {blockEntries.length ? blockEntries.map(({ block: item, index, columnId }) => (
                    <button key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-overseek-existing-block', item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDropOnSection(event, selectedSectionId, index, columnId)} onClick={() => onSelectBlock(item.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800">
                        <span className="inline-flex items-center gap-2"><GripVertical size={14} className="text-slate-400" />{getEmailDesignV2BlockLabel(item)}</span> <Eye size={14} />
                    </button>
                )) : <p className="text-sm text-slate-500">Select a block or add one from the left panel.</p>}
            </div>
        );
    }

    const patchProps = (props: Record<string, unknown>) => onUpdate((draft) => { Object.assign(draft.props, props); });
    const setVisibility = (value: string) => onUpdate((draft) => { draft.visibility = value as EmailDeviceVisibility; });
    const blockAlign = ((block.props as { align?: 'left' | 'center' | 'right' }).align || 'center') as 'left' | 'center' | 'right';
    const blockPadding = (block.props as { padding?: string }).padding || '8px 0';
    const hideOnMobile = (block.visibility || 'all') === 'desktop';

    const handleImageUpload = async (file: File) => {
        if (!token || !accountId) {
            setUploadError('Authentication required');
            return;
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            setUploadError('Invalid file type. Use PNG, JPG, GIF, SVG, or WebP.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError('File too large. Maximum size is 5MB.');
            return;
        }

        setUploadError(null);
        setIsUploading(true);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/invoices/templates/upload-image', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Account-ID': accountId,
                },
                body: formData,
            });

            if (!response.ok) {
                const payload = await response.json();
                throw new Error(payload?.error || 'Upload failed');
            }

            const payload = await response.json();
            if (!payload?.url) {
                throw new Error('Upload failed');
            }
            patchProps({ src: payload.url });
            setUrlDraft(payload.url);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to upload image';
            setUploadError(message);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900 dark:text-white">{getEmailDesignV2BlockLabel(block)}</p>
                {canDelete && <button onClick={onDelete} className="rounded-lg border border-red-200 p-2 text-red-700 hover:bg-red-50"><Trash2 size={14} /></button>}
            </div>
            <SelectField label="Alignment" value={blockAlign} options={['left', 'center', 'right']} onChange={(value) => patchProps({ align: value as 'left' | 'center' | 'right' })} />
            <FourSideField label="Padding" values={parseBoxSpacing(blockPadding)} onChange={(index, value) => {
                const next = parseBoxSpacing(blockPadding);
                next[index] = Math.max(0, Number(value) || 0);
                patchProps({ padding: toBoxSpacing(next) });
            }} />
            <ToggleField label="Hide on mobile" checked={hideOnMobile} onChange={(checked) => setVisibility(checked ? 'desktop' : 'all')} />
            <ToggleField label="Responsive structure" checked={Boolean(block.responsive)} onChange={(checked) => onUpdate((draft) => { draft.responsive = checked; })} />
            <SelectField label="Visibility" value={block.visibility || 'all'} options={['all', 'desktop', 'mobile']} onChange={setVisibility} />
            {block.type === 'siteLogo' && <><Field label="Logo URL" value={block.props.src} onChange={(value) => patchProps({ src: value })} /><Field label="Fallback text" value={block.props.fallbackText || ''} onChange={(value) => patchProps({ fallbackText: value })} /></>}
            {block.type === 'text' && <TextArea label="HTML" value={block.props.html} onChange={(value) => patchProps({ html: sanitizeEmailHtml(value) })} />}
            {block.type === 'image' && <>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleImageUpload(file);
                        event.currentTarget.value = '';
                    }}
                />
                <div className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-6 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-900 text-slate-900">
                        <Upload size={18} />
                    </div>
                    <p className="text-sm font-semibold text-slate-900">Add Image</p>
                    <p className="mt-1 text-xs text-slate-700">Select files from your library or <button type="button" onClick={() => setShowUrlInput((current) => !current)} className="font-medium text-blue-700 underline underline-offset-2">Insert From URL</button></p>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="mt-3 inline-flex items-center justify-center rounded-md border border-blue-600 bg-white px-4 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isUploading ? 'Uploading...' : 'Upload Image'}
                    </button>
                </div>
                {showUrlInput && (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <Field label="Image URL" value={urlDraft} onChange={setUrlDraft} />
                        <button
                            type="button"
                            onClick={() => patchProps({ src: urlDraft.trim() })}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Use URL
                        </button>
                    </div>
                )}
                {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
                <Field label="Alt text" value={block.props.alt} onChange={(value) => patchProps({ alt: value })} />
                <Field label="Link" value={block.props.href || ''} onChange={(value) => patchProps({ href: value })} />
            </>}
            {block.type === 'button' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">Button content and styles are edited directly from the inline toolbar on the canvas.</div>}
            {block.type === 'list' && <ListEditor items={block.props.items} onChange={(items) => patchProps({ items })} />}
            {block.type === 'spacer' && <Field label="Height" type="number" value={String(block.props.height)} onChange={(value) => patchProps({ height: Number(value) || 0 })} />}
            {block.type === 'divider' && <Field label="Color" value={block.props.color || ''} onChange={(value) => patchProps({ color: value })} />}
            {block.type === 'product' && <>
                <ProductPicker onSelect={(product) => patchProps(productToBlockProps(product))} />
                {block.props.productName && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">Selected: {block.props.productName}</p>}
                <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visible Product Fields</p>
                    <div className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">
                        {PRODUCT_VISIBILITY_FIELDS
                            .filter((field) => block.props[field.key] !== false)
                            .map((field) => field.label)
                            .join(', ')}
                    </div>
                    <div className="space-y-2">
                        {PRODUCT_VISIBILITY_FIELDS.map((field) => {
                            const enabled = block.props[field.key] !== false;
                            return (
                                <label key={field.key} className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
                                    <span>{field.label}</span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={enabled}
                                        onClick={() => patchProps({ [field.key]: !enabled })}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${enabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                                    >
                                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </button>
                                </label>
                            );
                        })}
                    </div>
                </div>
                <Field label="Button label" value={block.props.buttonLabel} onChange={(value) => patchProps({ buttonLabel: value })} />
                <Field label="Button URL" value={block.props.buttonHref} onChange={(value) => patchProps({ buttonHref: value, productUrl: value })} />
            </>}
            {block.type === 'orderSummary' && <><Field label="Heading" value={block.props.heading} onChange={(value) => patchProps({ heading: value })} /><SelectField label="Format" value={block.props.itemsFormat || 'table'} options={ORDER_ITEMS_FORMATS} onChange={(value) => patchProps({ itemsFormat: value as OrderItemsFormat })} /><ToggleField label="Show total" checked={block.props.showTotals} onChange={(checked) => patchProps({ showTotals: checked })} /></>}
            {block.type === 'address' && <><Field label="Title" value={block.props.title} onChange={(value) => patchProps({ title: value })} /><SelectField label="Source" value={block.props.source} options={['billing', 'shipping']} onChange={(value) => patchProps({ source: value })} /></>}
            {block.type === 'coupon' && <><Field label="Headline" value={block.props.headline} onChange={(value) => patchProps({ headline: value })} /><Field label="Code" value={block.props.code} onChange={(value) => patchProps({ code: value })} /><Field label="Description" value={block.props.description} onChange={(value) => patchProps({ description: value })} /></>}
            {block.type === 'review' && <>
                <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visible Review Fields</p>
                    <div className="space-y-2">
                        {REVIEW_VISIBILITY_FIELDS.map((field) => {
                            const enabled = block.props[field.key] !== false;
                            return (
                                <label key={field.key} className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
                                    <span>{field.label}</span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={enabled}
                                        onClick={() => patchProps({ [field.key]: !enabled })}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${enabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                                    >
                                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </button>
                                </label>
                            );
                        })}
                    </div>
                </div>
                <Field label="Headline" value={block.props.headline} onChange={(value) => patchProps({ headline: value })} />
                <Field label="Rating (1-5)" type="number" value={block.props.rating} onChange={(value) => patchProps({ rating: value })} />
                <TextArea label="Review content" value={block.props.content} onChange={(value) => patchProps({ content: value })} />
                <Field label="Reviewer name" value={block.props.reviewer} onChange={(value) => patchProps({ reviewer: value })} />
                <Field label="Product name" value={block.props.productName} onChange={(value) => patchProps({ productName: value })} />
                <Field label="CTA label" value={block.props.ctaLabel} onChange={(value) => patchProps({ ctaLabel: value })} />
                <Field label="CTA URL" value={block.props.ctaHref} onChange={(value) => patchProps({ ctaHref: value })} />
            </>}
            {block.type === 'menu' && <LinkListEditor links={block.props.links} onChange={(links) => patchProps({ links })} />}
            {block.type === 'social' && <><SelectField label="Icon pack" value={block.props.iconSet || 'native'} options={SOCIAL_ICON_SETS} onChange={(value) => patchProps({ iconSet: value as SocialIconSet })} /><SelectField label="Default icon style" value={block.props.iconStyle || 'solid'} options={SOCIAL_ICON_STYLES} onChange={(value) => patchProps({ iconStyle: value as SocialIconStyle })} /><SocialLinksEditor links={block.props.links} onChange={(links) => patchProps({ links })} onSaveDefaults={() => onSaveSocialDefaults(block.props.links)} /></>}
            {block.type === 'footer' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">Footer content is managed in Settings &gt; Email and is locked in the designer.</div>}
            {block.type === 'rawHtml' && <TextArea label="Raw HTML" value={block.props.html} onChange={(value) => patchProps({ html: value })} />}
        </div>
    );
}

function LinkListEditor({ links, onChange, onSaveDefaults }: { links: Array<{ label: string; href: string }>; onChange: (links: Array<{ label: string; href: string }>) => void; onSaveDefaults?: () => void }) {
    const updateLink = (index: number, key: 'label' | 'href', value: string) => {
        const next = links.map((link, itemIndex) => itemIndex === index ? { ...link, [key]: value } : link);
        onChange(next);
    };

    return (
        <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Links</p>
            {links.map((link, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <Field label="Label" value={link.label} onChange={(value) => updateLink(index, 'label', value)} />
                    <Field label="URL" value={link.href} onChange={(value) => updateLink(index, 'href', value)} />
                    <button onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-medium text-red-600 hover:text-red-700">Remove link</button>
                </div>
            ))}
            <button onClick={() => onChange([...links, { label: 'New Link', href: '{{store_url}}' }])} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Add link</button>
            {onSaveDefaults && <button onClick={onSaveDefaults} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Save as account social defaults</button>}
        </div>
    );
}

function SocialLinksEditor({ links, onChange, onSaveDefaults }: { links: Array<{ label: string; href: string; iconStyle?: SocialIconStyle }>; onChange: (links: Array<{ label: string; href: string; iconStyle?: SocialIconStyle }>) => void; onSaveDefaults: () => void }) {
    const updateLink = (index: number, key: 'label' | 'href' | 'iconStyle', value: string) => {
        const next = links.map((link, itemIndex) => {
            if (itemIndex !== index) return link;
            if (key === 'iconStyle' && value === 'default') {
                const rest = { ...link };
                delete rest.iconStyle;
                return rest;
            }
            return { ...link, [key]: value };
        });
        onChange(next);
    };

    return (
        <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Social Profiles</p>
            {links.map((link, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <SelectField label="Platform" value={link.label} options={SOCIAL_PLATFORMS.includes(link.label) ? SOCIAL_PLATFORMS : [link.label, ...SOCIAL_PLATFORMS]} onChange={(value) => updateLink(index, 'label', value)} />
                    <SelectField label="Icon style" value={link.iconStyle || 'default'} options={['default', ...SOCIAL_ICON_STYLES]} onChange={(value) => updateLink(index, 'iconStyle', value)} />
                    <Field label="URL" value={link.href} onChange={(value) => updateLink(index, 'href', value)} />
                    <button onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-medium text-red-600 hover:text-red-700">Remove profile</button>
                </div>
            ))}
            <button onClick={() => onChange([...links, { label: 'Facebook', href: '#', iconStyle: 'solid' }])} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Add social profile</button>
            <button onClick={onSaveDefaults} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Save as account social defaults</button>
        </div>
    );
}

function ListEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
    return (
        <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">List items</p>
            {items.map((item, index) => (
                <div key={index} className="flex gap-2">
                    <input value={item} onChange={(event) => onChange(items.map((value, itemIndex) => itemIndex === index ? sanitizeBidiText(event.target.value) : value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" dir="ltr" style={LTR_TEXT_STYLE} />
                    <button onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-red-200 px-2 text-sm text-red-600 hover:bg-red-50">Remove</button>
                </div>
            ))}
            <button onClick={() => onChange([...items, 'New item'])} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Add item</button>
        </div>
    );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <textarea value={value} onChange={(event) => onChange(sanitizeBidiText(event.target.value))} rows={8} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" dir="ltr" style={LTR_TEXT_STYLE} />
        </label>
    );
}

function ChecklistPanel({ issues, groupedIssues }: { issues: PreflightIssue[]; groupedIssues: ReturnType<typeof groupPreflightIssues> }) {
    if (issues.length === 0) {
        return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle size={18} className="mb-2" />No issues found.</div>;
    }
    return (
        <div className="space-y-3">
            <p className="font-semibold text-slate-900 dark:text-white">Preflight checklist</p>
            {[...groupedIssues.blocking, ...groupedIssues.warning].map((issue) => (
                <div key={issue.id} className={`rounded-lg border px-3 py-2 text-sm ${issue.severity === 'blocking' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><AlertTriangle size={14} className="mb-1" />{issue.message}</div>
            ))}
        </div>
    );
}

function HistoryPanel({ snapshots, onRestore }: { snapshots: Snapshot[]; onRestore: (snapshot: Snapshot) => void }) {
    return (
        <div className="space-y-3">
            <p className="font-semibold text-slate-900 dark:text-white">Version history</p>
            {snapshots.length === 0 ? <p className="text-sm text-slate-500">Autosave will create the first snapshot.</p> : snapshots.map((snapshot) => (
                <button key={snapshot.id} onClick={() => onRestore(snapshot)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800">
                    {new Date(snapshot.createdAt).toLocaleString()} <span className="text-indigo-600">Restore</span>
                </button>
            ))}
        </div>
    );
}
