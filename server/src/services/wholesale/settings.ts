import z from 'zod';
import { prisma } from '../../utils/prisma';
import { stableHash, taxBasisSchema } from './validation';
import { markApprovedGenerationsStale } from './staleness';
import { WholesaleValidationError } from './products';

export { buildWholesaleTaxImportCandidate } from './taxImport';

const termSectionSchema = z.object({
    heading: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(5000),
}).strict();

export const defaultsSchema = z.object({
    priceTaxBasis: taxBasisSchema,
    gstRate: z.union([
        z.number().min(0).max(100).finite(),
        z.string().regex(/^\d+(?:\.\d{1,4})?$/).refine(value => Number.isFinite(Number(value)) && Number(value) <= 100),
    ]),
    termsDocument: z.object({ sections: z.array(termSectionSchema).max(12) }).strict(),
    confidentialityNotice: z.string().trim().max(10000),
    privacyNotice: z.string().trim().max(10000),
    setupChecklist: z.array(z.object({
        key: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(200),
        completed: z.boolean(),
    }).strict()).max(30),
}).strict();

const businessValue = z.union([z.string().trim().max(1000), z.number().finite(), z.boolean(), z.null()]);
export const brandingSchema = z.object({
    logoUrl: z.url().max(2048).nullable().optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    headingFont: z.string().trim().max(100).nullable().optional(),
    bodyFont: z.string().trim().max(100).nullable().optional(),
    businessDetails: z.record(z.string().max(80), businessValue).refine(value => JSON.stringify(value).length <= 5000),
}).strict();

export const SAFE_DEFAULTS = {
    priceTaxBasis: 'EXCLUSIVE' as const,
    gstRate: '10.0000',
    termsDocument: { sections: [
        { heading: 'How to order', content: 'Choose the product, options and quantity. Confirm that every unit uses identical design and personalisation. Email SKUs, quantities, vector logo, delivery address and required date to the ordering team. Receive a formal quote, valid for the period shown on the quote. Pay the required deposit, preferably by bank transfer. Review and approve the supplied artwork proof. Production begins after approval, with all balances paid before dispatch.' },
        { heading: 'Below-minimum orders and bulk discounts', content: 'Orders below a listed minimum quantity may be accepted at the applicable CustomKings rate. Every item must use the identical product variant, design and personalisation. Mixed details cannot be combined unless agreed in writing.' },
        { heading: 'Artwork proof and approval', content: 'Every bulk order receives an artwork proof before production. Once approved, no further changes can be made.' },
        { heading: 'Proof response and administration fee', content: 'A 20% fee based on total order value may apply after 14 days without response or 10 missed emails/SMS/phone contacts, whichever occurs first, or if the customer declines to proceed after proofing.' },
        { heading: 'Customer-supplied details', content: 'The customer must check all spelling, names, dates, personalisation and artwork before approving the proof.' },
        { heading: 'Artwork rights and logo preparation', content: 'The customer warrants permission to use all supplied artwork. Logo generation and vectorisation may incur an additional fee per hour; supply a vector logo to avoid this charge.' },
        { heading: 'Manufacturing tolerances', content: 'Minor colour, material, dimension, placement, engraving, print and batch variations are normal manufacturing tolerances and are not defects.' },
        { heading: 'Quotes, pricing and delivery', content: 'Quotes remain valid for the period stated. Prices include or exclude GST as shown in this catalog and apply to delivery terms shown on the quote.' },
        { heading: 'Lead times and production', content: 'Lead time runs from cleared deposit payment and approved artwork. Production requires artwork approval. Large orders may require an additional progress payment before completion.' },
        { heading: 'Cancellation after approval', content: 'If cancelled after approval or production starts, completed items may be supplied and charged at the agreed price, and non-bulk pricing may apply to quantities already completed.' },
        { heading: 'Delivery costs', content: 'Incorrect addresses, redelivery, rerouting, storage and customer-requested delivery changes are at the customer’s expense.' },
        { heading: 'Damage, defects, delays and gift packaging', content: 'Report damage, shortage or defects promptly with photos and packaging. The supplier is not responsible for supplier, material or freight delays outside reasonable control. Gift packaging and gift wrapping are not normally available on bulk orders unless agreed in writing.' },
    ] },
    confidentialityNotice: 'This catalog and its pricing are confidential, prepared for the named recipient, and must not be copied or shared without written permission.',
    privacyNotice: 'To protect confidential pricing, Overseek records viewer name, email, truncated network address, device/session details, acceptance and pages viewed. Access records are retained under the account privacy and security policy.',
    setupChecklist: [
        { key: 'branding', label: 'Import, review and save store branding', completed: false },
        { key: 'tax', label: 'Verify WooCommerce tax basis and GST rate', completed: false },
        { key: 'email', label: 'Configure the connected outbound email account', completed: false },
        { key: 'terms', label: 'Review, edit and approve wholesale terms', completed: false },
        { key: 'products', label: 'Configure eligible product pricing and catalog details', completed: false },
    ],
    approvedById: null,
    approvedAt: null,
};

export const SAFE_BRANDING = {
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
    headingFont: null,
    bodyFont: null,
    businessDetails: {},
};

function serializeDefaults(record: any) {
    if (!record) {
        const termsHash = stableHash(SAFE_DEFAULTS.termsDocument);
        return { ...SAFE_DEFAULTS, id: null, version: termsHash.slice(0, 12), termsHash, approvedById: null, approvedAt: null };
    }
    return { ...record, gstRate: record.gstRate.toString() };
}

export function isDefaultsApprovable(defaults: any) {
    const sections = Array.isArray(defaults?.termsDocument?.sections) ? defaults.termsDocument.sections : [];
    return sections.length >= 1 && sections.length <= 12
        && sections.every((section: any) => String(section?.heading || '').trim() && String(section?.content || '').trim())
        && !!String(defaults?.confidentialityNotice || '').trim()
        && !!String(defaults?.privacyNotice || '').trim();
}

export function legalDefaultsChanged(existing: any, input: Pick<z.infer<typeof defaultsSchema>, 'termsDocument' | 'confidentialityNotice' | 'privacyNotice'>) {
    return !existing
        || existing.termsHash !== stableHash(input.termsDocument)
        || existing.confidentialityNotice !== input.confidentialityNotice
        || existing.privacyNotice !== input.privacyNotice;
}

export class WholesaleSettingsService {
    static async getDefaults(accountId: string) {
        return serializeDefaults(await (prisma as any).wholesaleCatalogDefaults.findUnique({ where: { accountId } }));
    }

    static async saveDefaults(accountId: string, userId: string, input: z.infer<typeof defaultsSchema>) {
        const termsHash = stableHash(input.termsDocument);
        const normalizedInput = { ...input, gstRate: Number(input.gstRate).toFixed(4) };
        const result = await (prisma as any).$transaction(async (tx: any) => {
            const existing = await tx.wholesaleCatalogDefaults.findUnique({ where: { accountId } });
            const legalChanged = legalDefaultsChanged(existing, input);
            const data = {
                ...input,
                gstRate: normalizedInput.gstRate,
                version: stableHash(normalizedInput).slice(0, 12),
                termsHash,
                ...(legalChanged ? { approvedById: null, approvedAt: null } : {}),
            };
            const saved = await tx.wholesaleCatalogDefaults.upsert({
                where: { accountId }, create: { accountId, ...data }, update: data,
            });
            await markApprovedGenerationsStale(accountId, { code: 'DEFAULTS_CHANGED', resourceType: 'WHOLESALE_DEFAULTS', resourceId: saved.id }, undefined, tx);
            return saved;
        });
        return serializeDefaults(result);
    }

    static async approveDefaults(accountId: string, userId: string) {
        const defaults = await (prisma as any).wholesaleCatalogDefaults.findUnique({ where: { accountId } });
        if (!defaults) throw new WholesaleValidationError('Wholesale defaults must be configured before approval');
        if (!isDefaultsApprovable(defaults)) {
            throw new WholesaleValidationError('Approval requires 1 to 12 terms sections and nonempty confidentiality and privacy notices');
        }
        return serializeDefaults(await (prisma as any).wholesaleCatalogDefaults.update({
            where: { accountId }, data: { approvedById: userId, approvedAt: new Date() },
        }));
    }

    static async getBranding(accountId: string) {
        const result = await (prisma as any).wholesaleBrandProfile.findUnique({ where: { accountId } });
        return result ? { ...result, importSources: undefined } : { ...SAFE_BRANDING, id: null };
    }

    static async saveBranding(accountId: string, input: z.infer<typeof brandingSchema>) {
        return (prisma as any).$transaction(async (tx: any) => {
            const reviewedAt = new Date();
            const saved = await tx.wholesaleBrandProfile.upsert({
                where: { accountId },
                create: { accountId, ...input, importSources: [], reviewedAt },
                update: { ...input, reviewedAt },
            });
            await markApprovedGenerationsStale(accountId, { code: 'BRANDING_CHANGED', resourceType: 'WHOLESALE_BRANDING', resourceId: saved.id }, undefined, tx);
            return saved;
        });
    }
}
