import fs from 'fs';
import PDFDocument from 'pdfkit';
import { fetchImageSecurely } from './secureImage';
import { snapshotProducts, WholesaleSnapshot } from './snapshot';

const PAGE = { size: 'A4' as const, layout: 'landscape' as const, margin: 36 };
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const CONTENT_LEFT = 36;
const CONTENT_WIDTH = 770;
const PRODUCT_TOP = 66;
const PRODUCT_BOTTOM = 526;
const GRID_COLUMNS = 4;
const GRID_ROWS = 2;
const GRID_GAP = 8;
const GRID_CARD_WIDTH = (CONTENT_WIDTH - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
const GRID_CARD_HEIGHT = (PRODUCT_BOTTOM - PRODUCT_TOP - GRID_GAP) / GRID_ROWS;
const TERMS_COLUMN_GAP = 12;
const TERMS_COLUMN_WIDTH = (CONTENT_WIDTH - TERMS_COLUMN_GAP * 2) / 3;

export const GRID_PAGE_CAPACITY = GRID_COLUMNS * GRID_ROWS;

const PROCESS_ASSETS = [
    { key: 'ENGRAVE', label: 'Engraving', color: '#1f2937', shape: 'circle' },
    { key: 'SUBLIMATE', label: 'Sublimation', color: '#db2777', shape: 'square' },
    { key: 'UV', label: 'UV print', color: '#7c3aed', shape: 'diamond' },
    { key: 'DTF', label: 'DTF transfer', color: '#ea580c', shape: 'triangle' },
    { key: 'EMBROIDERY', label: 'Embroidery', color: '#047857', shape: 'hexagon' },
] as const;

type ProcessKey = typeof PROCESS_ASSETS[number]['key'];
type TermsSection = { heading: string; content: string };
type MeasuredTermsSection = TermsSection & { height: number };

export class WholesaleRenderValidationError extends Error {}

function structuredTerms(snapshot: WholesaleSnapshot): TermsSection[] {
    const catalogTerms = Array.isArray(snapshot.catalog.termsSections) ? snapshot.catalog.termsSections : [];
    return catalogTerms.map((term: any) => ({
        heading: String(term?.heading || '').trim(), content: String(term?.content || '').trim(),
    }));
}

export function validateSnapshotForRender(snapshot: WholesaleSnapshot) {
    if (!snapshot || snapshot.snapshotVersion !== 1) throw new WholesaleRenderValidationError('Unsupported wholesale snapshot');
    const products = snapshotProducts(snapshot);
    if (!products.length || products.length > 500) throw new WholesaleRenderValidationError('Snapshot must contain 1 to 500 products');
    if (products.some(product => !product.imageUrl)) throw new WholesaleRenderValidationError('Every product requires a main image');
    const terms = structuredTerms(snapshot);
    if (!terms.length || terms.length > 12 || terms.some(term => !term.heading || !term.content)) {
        throw new WholesaleRenderValidationError('Snapshot requires 1 to 12 structured terms');
    }
    return { products, terms };
}

export function paginateGridProducts<T>(products: T[], capacity = GRID_PAGE_CAPACITY): T[][] {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Grid capacity must be a positive integer');
    const pages: T[][] = [];
    for (let index = 0; index < products.length; index += capacity) pages.push(products.slice(index, index + capacity));
    return pages;
}

export function productNeedsDedicatedPage(product: any, measuredContentHeight = 0, availableHeight = GRID_CARD_HEIGHT - 14) {
    return (Array.isArray(product?.variantGroups) && product.variantGroups.length > 0) || measuredContentHeight > availableHeight;
}

export function processOverflowLabels(processes: unknown[]) {
    const selected = new Set((Array.isArray(processes) ? processes : []).map(String));
    const ordered = PROCESS_ASSETS.filter(process => selected.has(process.key));
    const visible = ordered.slice(0, 3).map(process => process.key);
    const hidden = ordered.slice(3).map(process => process.key);
    return {
        visible,
        hidden,
        hiddenLabel: hidden.length ? `More processes: ${ordered.slice(3).map(process => process.label).join(', ')}` : '',
    };
}

export function distributeTermsAcrossColumns(sectionHeights: number[], availableHeight: number, columnCount = 3): number[][] | null {
    if (!Number.isInteger(columnCount) || columnCount < 1 || availableHeight < 0) return null;
    if (sectionHeights.some(height => !Number.isFinite(height) || height < 0 || height > availableHeight)) return null;
    let best: { columns: number[][]; score: number[] } | null = null;

    const visit = (start: number, remaining: number, columns: number[][]) => {
        if (remaining === 1) {
            const final = sectionHeights.slice(start);
            if (final.reduce((sum, height) => sum + height, 0) > availableHeight) return;
            const candidate = [...columns, final];
            const totals = candidate.map(column => column.reduce((sum, height) => sum + height, 0));
            const score = [Math.max(...totals), Math.max(...totals) - Math.min(...totals)];
            if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
                best = { columns: candidate, score };
            }
            return;
        }
        for (let end = start; end <= sectionHeights.length; end++) {
            const column = sectionHeights.slice(start, end);
            if (column.reduce((sum, height) => sum + height, 0) > availableHeight) break;
            visit(end, remaining - 1, [...columns, column]);
        }
    };

    visit(0, columnCount, []);
    return best ? best.columns : null;
}

function colour(value: unknown, fallback: string) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function printable(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(printable).filter(Boolean).join(', ');
    if (typeof value === 'object') return Object.values(value).map(printable).filter(Boolean).join(' | ');
    return String(value);
}

function humanLabel(key: string) {
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, value => value.toUpperCase());
}

function readableFields(value: unknown, preferred: Record<string, string>, excluded: string[] = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return printable(value);
    return Object.entries(value)
        .filter(([key, item]) => !excluded.includes(key) && printable(item))
        .map(([key, item]) => `${preferred[key] || humanLabel(key)}: ${printable(item)}`)
        .join(' | ');
}

function paymentText(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return printable(value);
    const object = value as Record<string, unknown>;
    const title = printable(object.heading) || 'Payment';
    const content = printable(object.content);
    const details = readableFields(object, {
        depositPercentage: 'Deposit', minimumDeposit: 'Minimum deposit', minimum: 'Minimum deposit',
        highValueThreshold: 'High-value order threshold', orderingInstructions: 'How to order',
    }, ['heading', 'content']);
    return [title, content, details].filter(Boolean).join(' · ');
}

export function priceNoticeText(snapshot: WholesaleSnapshot) {
    return printable(snapshot.catalog.supplementaryPriceNotice);
}

export function logoFailureWarning(url: string) {
    return /\.svg(?:$|[?#])/i.test(url) ? 'BRANDING_LOGO_SVG_UNSUPPORTED_REVIEW_REQUIRED' : 'BRANDING_LOGO_PLACEHOLDER';
}

export function availableVariantGroups(groups: any[], availableUrls: Set<string>) {
    const available: any[] = [];
    const omittedLabels: string[] = [];
    for (const group of groups || []) {
        if (availableUrls.has(group.imageUrl)) available.push(group);
        else omittedLabels.push(...(group.labels || []));
    }
    return { available, omittedLabels };
}

function dateLabel(iso: string, timezone: string) {
    return new Intl.DateTimeFormat('en-AU', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

function currencySymbol(currency: string) {
    return ({ AUD: '$', CAD: '$', HKD: '$', NZD: '$', SGD: '$', USD: '$', GBP: '£', EUR: '€', JPY: '¥', CNY: '¥', INR: '₹', KRW: '₩' } as Record<string, string>)[currency] || '¤';
}

function businessIdentity(snapshot: WholesaleSnapshot) {
    const details = snapshot.branding.businessDetails && typeof snapshot.branding.businessDetails === 'object'
        ? snapshot.branding.businessDetails as Record<string, unknown> : {};
    const name = printable(details.businessName || details.legalName || details.name) || snapshot.account.name;
    const site = printable(details.website || details.site || details.url);
    return { name, site };
}

function legalFooterText(snapshot: WholesaleSnapshot) {
    const business = readableFields(snapshot.branding.businessDetails, {
        businessName: 'Business', legalName: 'Legal name', name: 'Business', website: 'Website', site: 'Website',
        url: 'Website', abn: 'ABN', address: 'Address', phone: 'Phone', email: 'Email',
    });
    const legal = readableFields(snapshot.catalog.footerDetails, {
        confidentialityNotice: 'Confidentiality', privacyNotice: 'Privacy', legalNotice: 'Legal notice',
        businessName: 'Business', website: 'Website', site: 'Website', abn: 'ABN',
    });
    return [business, legal].filter(Boolean).join(' · ');
}

function tierLine(tier: any) {
    const price = tier.isPoa ? 'Contact us' : printable(tier.displayUnitPrice);
    return `${printable(tier.rangeLabel)}  ${price}${tier.displaySaving ? `  ·  ${tier.displaySaving}` : ''}`;
}

function drawProcessIcon(doc: PDFKit.PDFDocument, key: ProcessKey, x: number, y: number, size = 9) {
    const asset = PROCESS_ASSETS.find(process => process.key === key)!;
    doc.save().fillColor(asset.color);
    if (asset.shape === 'circle') doc.circle(x + size / 2, y + size / 2, size / 2).fill();
    if (asset.shape === 'square') doc.rect(x, y, size, size).fill();
    if (asset.shape === 'diamond') doc.moveTo(x + size / 2, y).lineTo(x + size, y + size / 2).lineTo(x + size / 2, y + size).lineTo(x, y + size / 2).closePath().fill();
    if (asset.shape === 'triangle') doc.moveTo(x + size / 2, y).lineTo(x + size, y + size).lineTo(x, y + size).closePath().fill();
    if (asset.shape === 'hexagon') doc.moveTo(x + size * 0.25, y).lineTo(x + size * 0.75, y).lineTo(x + size, y + size / 2)
        .lineTo(x + size * 0.75, y + size).lineTo(x + size * 0.25, y + size).lineTo(x, y + size / 2).closePath().fill();
    doc.restore();
}

function drawProcesses(doc: PDFKit.PDFDocument, processes: unknown[], x: number, y: number, width: number) {
    const overflow = processOverflowLabels(processes);
    overflow.visible.forEach((key, index) => drawProcessIcon(doc, key as ProcessKey, x + index * 15, y, 9));
    if (overflow.hidden.length) doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7).text(`+${overflow.hidden.length}`, x + overflow.visible.length * 15, y + 1, { width: 24 });
    if (overflow.hiddenLabel) {
        doc.fillColor('#475569').font('Helvetica').fontSize(8).text(overflow.hiddenLabel, x, y + 12, { width, lineGap: 0 });
        return doc.heightOfString(overflow.hiddenLabel, { width, lineGap: 0 }) + 12;
    }
    return overflow.visible.length ? 10 : 0;
}

function measureCardContent(doc: PDFKit.PDFDocument, product: any) {
    const width = GRID_CARD_WIDTH - 14;
    let height = 75;
    doc.font('Helvetica-Bold').fontSize(8);
    height += doc.heightOfString(String(product.name), { width, lineGap: 0 }) + 2;
    doc.font('Helvetica').fontSize(8);
    height += doc.heightOfString(`SKU ${String(product.sku).toUpperCase()}${product.displayRrp ? `  ·  RRP ${product.displayRrp}` : ''}`, { width }) + 4;
    height += 13;
    for (const tier of product.tiers || []) height += doc.heightOfString(tierLine(tier), { width, lineGap: 0 }) + 1;
    const notes = printable(product.notes);
    if (notes) height += doc.heightOfString(`Notes: ${notes}`, { width, lineGap: 0 }) + 3;
    const overflow = processOverflowLabels(product.personalisationTypes);
    if (overflow.visible.length) height += 10;
    if (overflow.hiddenLabel) height += doc.heightOfString(overflow.hiddenLabel, { width, lineGap: 0 }) + 2;
    return height;
}

function drawGridCard(doc: PDFKit.PDFDocument, product: any, image: Buffer, snapshot: WholesaleSnapshot, x: number, y: number) {
    const primary = colour(snapshot.branding.primaryColor, '#1f2937');
    const accent = colour(snapshot.branding.accentColor, '#d97706');
    const width = GRID_CARD_WIDTH;
    const innerWidth = width - 14;
    doc.roundedRect(x, y, width, GRID_CARD_HEIGHT, 4).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
    doc.rect(x, y, width, 3).fill(accent);
    doc.image(image, x + 7, y + 9, { fit: [innerWidth, 62], align: 'center', valign: 'center' });
    let cursor = y + 77;
    doc.fillColor(primary).font(snapshot.branding.headingFont || 'Helvetica').fontSize(8).text(String(product.name), x + 7, cursor, { width: innerWidth, lineGap: 0 });
    cursor = doc.y + 2;
    doc.fillColor('#475569').font(snapshot.branding.bodyFont || 'Helvetica').fontSize(8).text(
        `SKU ${String(product.sku).toUpperCase()}${product.displayRrp ? `  ·  RRP ${product.displayRrp}` : ''}`,
        x + 7, cursor, { width: innerWidth },
    );
    cursor = doc.y + 4;
    const moq = product.tiers?.[0]?.minimumQuantity;
    const badge = moq ? `MOQ ${moq}` : 'MOQ CONTACT US';
    const badgeWidth = Math.min(innerWidth, doc.widthOfString(badge) + 12);
    doc.roundedRect(x + 7, cursor, badgeWidth, 11, 3).fill(primary);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7).text(badge, x + 13, cursor + 2, { width: badgeWidth - 12 });
    cursor += 15;
    doc.fillColor('#111827').font('Helvetica').fontSize(8);
    for (const tier of product.tiers || []) {
        doc.text(tierLine(tier), x + 7, cursor, { width: innerWidth, lineGap: 0 });
        cursor = doc.y + 1;
    }
    const notes = printable(product.notes);
    if (notes) {
        doc.fillColor('#334155').font('Helvetica').fontSize(8).text(`Notes: ${notes}`, x + 7, cursor + 2, { width: innerWidth, lineGap: 0 });
        cursor = doc.y + 3;
    }
    drawProcesses(doc, product.personalisationTypes, x + 7, cursor, innerWidth);
}

function drawProductDetails(doc: PDFKit.PDFDocument, product: any, image: Buffer, snapshot: WholesaleSnapshot) {
    const primary = colour(snapshot.branding.primaryColor, '#1f2937');
    const accent = colour(snapshot.branding.accentColor, '#d97706');
    doc.roundedRect(44, PRODUCT_TOP, 150, 154, 4).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc.image(image, 50, PRODUCT_TOP + 6, { fit: [138, 142], align: 'center', valign: 'center' });
    const tx = 210;
    const tw = 588;
    let y = PRODUCT_TOP;
    doc.fillColor(primary).font(snapshot.branding.headingFont || 'Helvetica').fontSize(8).text(String(product.name), tx, y, { width: tw });
    y = doc.y + 3;
    doc.fillColor('#475569').font(snapshot.branding.bodyFont || 'Helvetica').fontSize(8).text(`SKU ${String(product.sku).toUpperCase()}${product.displayRrp ? `  ·  RRP ${product.displayRrp}` : ''}`, tx, y, { width: tw });
    y = doc.y + 5;
    const moq = product.tiers?.[0]?.minimumQuantity;
    const badge = moq ? `MOQ ${moq}` : 'MOQ CONTACT US';
    const badgeWidth = doc.widthOfString(badge) + 14;
    doc.roundedRect(tx, y, badgeWidth, 13, 3).fill(accent);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(badge, tx + 7, y + 2, { width: badgeWidth - 14 });
    y += 18;
    doc.fillColor('#111827').font('Helvetica').fontSize(8);
    for (const tier of product.tiers || []) {
        doc.text(tierLine(tier), tx, y, { width: tw, lineGap: 0 });
        y = doc.y + 2;
    }
    doc.fillColor('#475569').text(product.gstStatement, tx, y + 2, { width: tw });
    y = doc.y + 4;
    const notes = printable(product.notes);
    if (notes) {
        doc.fillColor('#111827').text(`Notes: ${notes}`, tx, y, { width: tw, lineGap: 1 });
        y = doc.y + 4;
    }
    y += drawProcesses(doc, product.personalisationTypes, tx, y, tw);
    const bottom = Math.max(PRODUCT_TOP + 160, y + 4);
    if (bottom > PRODUCT_BOTTOM) throw new WholesaleRenderValidationError(`Product details overflow a page for product ${product.id}`);
    return bottom;
}

function calculateTermsLayout(doc: PDFKit.PDFDocument, snapshot: WholesaleSnapshot) {
    const { terms } = validateSnapshotForRender(snapshot);
    const payment = paymentText(snapshot.catalog.paymentCallout);
    const legal = legalFooterText(snapshot);
    doc.font('Helvetica').fontSize(7);
    const legalHeight = legal ? doc.heightOfString(legal, { width: 650, lineGap: 1 }) : 0;
    if (legalHeight > 72) throw new WholesaleRenderValidationError('Terms legal footer overflows the final page');
    const footerTop = 570 - Math.max(legalHeight, 9);
    let columnsTop = 72;
    let paymentHeight = 0;
    if (payment) {
        doc.font('Helvetica-Bold').fontSize(8);
        paymentHeight = doc.heightOfString(payment, { width: 742, lineGap: 1 }) + 16;
        columnsTop += paymentHeight + 10;
    }
    const measured: MeasuredTermsSection[] = terms.map(term => {
        doc.font('Helvetica-Bold').fontSize(8);
        const headingHeight = doc.heightOfString(term.heading, { width: TERMS_COLUMN_WIDTH });
        doc.font('Helvetica').fontSize(8);
        const contentHeight = doc.heightOfString(term.content, { width: TERMS_COLUMN_WIDTH, lineGap: 1 });
        return { ...term, height: headingHeight + contentHeight + 9 };
    });
    const availableHeight = footerTop - columnsTop - 10;
    const distribution = distributeTermsAcrossColumns(measured.map(term => term.height), availableHeight, 3);
    if (!distribution) throw new WholesaleRenderValidationError('Terms overflow the final page at the minimum 8pt font size');
    let offset = 0;
    const columns = distribution.map(heights => {
        const sections = measured.slice(offset, offset + heights.length);
        offset += heights.length;
        return sections;
    });
    return { terms, payment, paymentHeight, legal, legalHeight, columnsTop, footerTop, columns };
}

export function validateTermsFit(doc: PDFKit.PDFDocument, snapshot: WholesaleSnapshot, fontSize = 8) {
    if (fontSize !== 8) throw new WholesaleRenderValidationError('Terms must render at exactly 8pt');
    return calculateTermsLayout(doc, snapshot).terms;
}

export async function renderWholesaleCatalog(
    snapshot: WholesaleSnapshot,
    outputPath: string,
    options: {
        deadline: number;
        checkCancelled: () => Promise<void>;
        onProgress?: (stage: string, percent: number) => Promise<void>;
        personalization?: { company: string; contact?: string | null; confidentialityText: string };
    },
) {
    const { products } = validateSnapshotForRender(snapshot);
    const warnings: string[] = [];
    const images = new Map<string, Buffer>();
    const omittedVariantLabels = new Map<string, string[]>();
    let logo: Buffer | null = null;
    if (snapshot.branding.logoUrl) {
        try { logo = await fetchImageSecurely(snapshot.branding.logoUrl, 0, options.deadline); }
        catch { warnings.push(logoFailureWarning(snapshot.branding.logoUrl)); }
    }
    for (let index = 0; index < products.length; index++) {
        await options.checkCancelled();
        if (Date.now() >= options.deadline) throw new Error('Generation exceeded the 30 minute timeout');
        images.set(products[index].imageUrl, await fetchImageSecurely(products[index].imageUrl, 0, options.deadline));
        for (const variant of products[index].variantGroups || []) {
            if (!images.has(variant.imageUrl)) {
                try { images.set(variant.imageUrl, await fetchImageSecurely(variant.imageUrl, 0, options.deadline)); }
                catch {
                    warnings.push(`VARIATION_IMAGE_OMITTED:${products[index].id}`);
                    const labels = omittedVariantLabels.get(products[index].id) || [];
                    labels.push(...variant.labels);
                    omittedVariantLabels.set(products[index].id, labels);
                }
            }
        }
        await options.onProgress?.('FETCHING_IMAGES', 5 + Math.floor((index + 1) / products.length * 30));
    }

    await fs.promises.mkdir(require('path').dirname(outputPath), { recursive: true });
    const deterministicDate = new Date(snapshot.effectiveDate);
    const doc = new PDFDocument({
        ...PAGE,
        autoFirstPage: true,
        bufferPages: true,
        info: {
            Title: snapshot.catalog.publicTitle,
            Subject: 'Wholesale product catalog',
            Author: businessIdentity(snapshot).name,
            Keywords: PROCESS_ASSETS.map(process => `${process.key}: ${process.label}`).join(', '),
            Producer: 'Overseek Wholesale Catalog Renderer v1',
            CreationDate: deterministicDate,
            ModDate: deterministicDate,
        },
    });
    const headingFont = snapshot.branding.headingFont || 'Helvetica';
    const bodyFont = snapshot.branding.bodyFont || 'Helvetica';
    const termsLayout = calculateTermsLayout(doc, snapshot);
    const stream = fs.createWriteStream(outputPath, { flags: 'wx' });
    doc.pipe(stream);
    const primary = colour(snapshot.branding.primaryColor, '#1f2937');
    const accent = colour(snapshot.branding.accentColor, '#d97706');
    const productPages = new Set<number>();

    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(primary);
    doc.rect(0, 0, 12, PAGE_HEIGHT).fill(accent);
    if (logo) {
        try { doc.image(logo, 650, 42, { fit: [140, 70], align: 'right' }); }
        catch { warnings.push('BRANDING_LOGO_PLACEHOLDER'); }
    }
    doc.fillColor(accent).font(headingFont).fontSize(15).text('WHOLESALE CATALOG', 48, 48);
    doc.fillColor('#ffffff').fontSize(34).text(snapshot.catalog.publicTitle, 48, 150, { width: 690 });
    if (snapshot.catalog.subtitle) doc.font('Helvetica').fontSize(16).text(snapshot.catalog.subtitle, 48, doc.y + 12, { width: 690 });
    if (snapshot.catalog.coverText) doc.fontSize(10).text(snapshot.catalog.coverText, 48, doc.y + 24, { width: 600 });
    doc.font('Helvetica-Bold').fontSize(10).text(`EFFECTIVE ${dateLabel(snapshot.effectiveDate, snapshot.account.timezone)}   |   VALID UNTIL ${dateLabel(snapshot.validUntil, snapshot.account.timezone)}`, 48, 510);
    if (options.personalization) {
        const preparedFor = options.personalization.contact ? `${options.personalization.company}\n${options.personalization.contact}` : options.personalization.company;
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text(`PREPARED FOR\n${preparedFor}`, 48, 390, { width: 600 });
    }

    const currentPageIndex = () => doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
    const addProductPage = (category: string, continued = false, productName?: string) => {
        doc.addPage(PAGE);
        productPages.add(currentPageIndex());
        doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill('#ffffff');
        doc.rect(0, 0, 8, PAGE_HEIGHT).fill(accent);
        const heading = productName
            ? `${category} · ${productName}${continued ? ' · CONTINUED' : ''}`
            : `${category}${continued ? ' · CONTINUED' : ''}`;
        doc.fillColor(primary).font(headingFont).fontSize(13).text(heading, CONTENT_LEFT, 27, { width: 530 });
        if (options.personalization) {
            doc.fillColor(primary).font('Helvetica-Bold').fontSize(7).text(`PREPARED FOR ${options.personalization.company}`, 570, 29, { width: 236, align: 'right' });
        }
        doc.moveTo(CONTENT_LEFT, 51).lineTo(806, 51).strokeColor(accent).lineWidth(1.5).stroke();
    };

    let rendered = 0;
    for (const category of snapshot.categories) {
        let categoryPageCount = 0;
        let pendingGrid: any[] = [];
        const markRendered = async (count: number) => {
            rendered += count;
            await options.onProgress?.('RENDERING_PRODUCTS', 35 + Math.floor(rendered / products.length * 55));
        };
        const flushGrid = async () => {
            for (const pageProducts of paginateGridProducts(pendingGrid)) {
                addProductPage(category.label, categoryPageCount > 0);
                categoryPageCount++;
                pageProducts.forEach((product, index) => {
                    const column = index % GRID_COLUMNS;
                    const row = Math.floor(index / GRID_COLUMNS);
                    drawGridCard(doc, product, images.get(product.imageUrl)!, snapshot,
                        CONTENT_LEFT + column * (GRID_CARD_WIDTH + GRID_GAP), PRODUCT_TOP + row * (GRID_CARD_HEIGHT + GRID_GAP));
                });
                await markRendered(pageProducts.length);
            }
            pendingGrid = [];
        };

        for (const product of category.products) {
            await options.checkCancelled();
            const measuredHeight = measureCardContent(doc, product);
            if (!productNeedsDedicatedPage(product, measuredHeight)) {
                pendingGrid.push(product);
                continue;
            }
            await flushGrid();
            addProductPage(category.label, categoryPageCount > 0, String(product.name));
            categoryPageCount++;
            let y = drawProductDetails(doc, product, images.get(product.imageUrl)!, snapshot);
            const variants = availableVariantGroups(product.variantGroups || [], new Set(images.keys())).available;
            if (variants.length) {
                y += 5;
                doc.fillColor(primary).font('Helvetica-Bold').fontSize(8).text('IN-STOCK OPTIONS', 44, y, { width: 754 });
                y = doc.y + 5;
            }
            for (let index = 0; index < variants.length; index += 3) {
                const row = variants.slice(index, index + 3);
                doc.font(bodyFont).fontSize(7);
                const labelHeights = row.map((variant: any) => doc.heightOfString(variant.labels.join('\n'), { width: 230, lineGap: 1 }));
                const rowHeight = 91 + Math.max(...labelHeights);
                if (rowHeight > PRODUCT_BOTTOM - PRODUCT_TOP) throw new WholesaleRenderValidationError(`Variant labels overflow a page for product ${product.id}`);
                if (y + rowHeight > PRODUCT_BOTTOM) {
                    addProductPage(category.label, true, String(product.name));
                    categoryPageCount++;
                    y = PRODUCT_TOP;
                }
                row.forEach((variant: any, column: number) => {
                    const x = 44 + column * 251;
                    doc.roundedRect(x, y, 241, rowHeight, 4).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
                    doc.image(images.get(variant.imageUrl)!, x + 7, y + 7, { fit: [227, 72], align: 'center', valign: 'center' });
                    doc.fillColor('#111827').font(bodyFont).fontSize(7).text(variant.labels.join('\n'), x + 7, y + 84, { width: 227, lineGap: 1 });
                });
                y += rowHeight + 7;
            }
            const omitted = omittedVariantLabels.get(product.id) || [];
            if (omitted.length) {
                const label = `Options without thumbnails: ${omitted.join('; ')}`;
                doc.fillColor('#475569').font(bodyFont).fontSize(7).text(label, 44, y + 2, { width: 754, lineGap: 1 });
                y = doc.y + 4;
                if (y > PRODUCT_BOTTOM) throw new WholesaleRenderValidationError(`Omitted variant labels overflow a page for product ${product.id}`);
            }
            await markRendered(1);
        }
        await flushGrid();
    }

    doc.addPage(PAGE);
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill('#ffffff');
    doc.rect(0, 0, 8, PAGE_HEIGHT).fill(accent);
    if (logo) {
        try { doc.image(logo, 674, 20, { fit: [126, 35], align: 'right' }); }
        catch { /* The cover warning already records an invalid logo buffer. */ }
    }
    doc.fillColor(primary).font(headingFont).fontSize(20).text('TERMS & CONDITIONS', CONTENT_LEFT, 28, { width: 600 });
    doc.moveTo(CONTENT_LEFT, 59).lineTo(806, 59).strokeColor(accent).lineWidth(2).stroke();
    if (termsLayout.payment) {
        doc.roundedRect(CONTENT_LEFT, 72, CONTENT_WIDTH, termsLayout.paymentHeight, 4).fill(accent);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(termsLayout.payment, 50, 80, { width: 742, lineGap: 1 });
    }
    const supplementaryNotice = priceNoticeText(snapshot);
    if (supplementaryNotice) {
        doc.fillColor(primary).font(bodyFont).fontSize(7).text(supplementaryNotice, CONTENT_LEFT, 64, { width: CONTENT_WIDTH, align: 'right' });
    }
    termsLayout.columns.forEach((column, columnIndex) => {
        const x = CONTENT_LEFT + columnIndex * (TERMS_COLUMN_WIDTH + TERMS_COLUMN_GAP);
        let y = termsLayout.columnsTop;
        column.forEach(term => {
            doc.fillColor(primary).font(headingFont).fontSize(8).text(term.heading, x, y, { width: TERMS_COLUMN_WIDTH });
            y = doc.y + 2;
            doc.fillColor('#111827').font(bodyFont).fontSize(8).text(term.content, x, y, { width: TERMS_COLUMN_WIDTH, lineGap: 1 });
            y = doc.y + 7;
        });
    });
    doc.moveTo(CONTENT_LEFT, termsLayout.footerTop - 4).lineTo(806, termsLayout.footerTop - 4).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    if (termsLayout.legal) doc.fillColor('#475569').font('Helvetica').fontSize(7).text(termsLayout.legal, CONTENT_LEFT, termsLayout.footerTop, { width: 650, lineGap: 1 });

    const range = doc.bufferedPageRange();
    const identity = businessIdentity(snapshot);
    const effective = dateLabel(snapshot.effectiveDate, snapshot.account.timezone);
    const validUntil = dateLabel(snapshot.validUntil, snapshot.account.timezone);
    const tax = `${snapshot.account.currency} (${currencySymbol(snapshot.account.currency)}) · ${snapshot.catalog.gstStatement}`;
    for (let index = 0; index < range.count; index++) {
        doc.switchToPage(index);
        if (productPages.has(index)) {
            let legendX = CONTENT_LEFT;
            PROCESS_ASSETS.forEach(process => {
                drawProcessIcon(doc, process.key, legendX, 541, 8);
                doc.fillColor('#334155').font('Helvetica').fontSize(6.5).text(process.label, legendX + 11, 541, { width: 75 });
                legendX += 99;
            });
            const business = [identity.name, identity.site].filter(Boolean).join(' · ');
            doc.fillColor('#475569').font('Helvetica').fontSize(7).text(
                `${business}  |  Effective ${effective} · Valid until ${validUntil}  |  ${tax}`,
                CONTENT_LEFT, 562, { width: 700 },
            );
            doc.text(`Page ${index + 1}/${range.count}`, 736, 562, { width: 70, align: 'right' });
        } else if (index > 0) {
            doc.fillColor('#475569').font('Helvetica').fontSize(7).text(
                `${identity.name}${identity.site ? ` · ${identity.site}` : ''}  |  Effective ${effective} · Valid until ${validUntil}`,
                CONTENT_LEFT, 576, { width: 690 },
            );
            doc.text(`Page ${index + 1}/${range.count}`, 736, 576, { width: 70, align: 'right' });
        }
        if (options.personalization) {
            doc.save().fillOpacity(0.12).fillColor(index === 0 ? '#ffffff' : primary)
                .font('Helvetica-Bold').fontSize(29).rotate(-32, { origin: [421, 298] })
                .text(`${options.personalization.confidentialityText} | ${options.personalization.company}`, 60, 275, { width: 720, align: 'center' }).restore();
        }
    }
    doc.end();
    await new Promise<void>((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });
    return { pageCount: range.count, warnings };
}
