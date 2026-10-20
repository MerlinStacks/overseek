import type { WooProduct } from '@prisma/client';
import { scoringHasPrice, scoringPlainText, scoringRecord, scoringText } from '../utils/productScoring';

export interface MerchantCenterIssue {
    severity: 'error' | 'warning'; // map to red/yellow
    message: string;
    attribute?: string;
}

export interface MerchantCenterResult {
    score: number;
    issues: MerchantCenterIssue[];
}

export class MerchantCenterService {

    static validateCompliance(product: Partial<WooProduct>): MerchantCenterResult {
        const issues: MerchantCenterIssue[] = [];
        let score = 100;

        const raw = scoringRecord(product.rawData);
        const name = scoringText(product.name);

        // 1. ID / SKU
        if (!scoringText(product.sku) && !product.wooId) {
            issues.push({ severity: 'error', message: 'Product is missing a unique identifier (SKU or ID).', attribute: 'id' });
            score -= 20;
        }

        // 2. Title
        if (!name) {
            issues.push({ severity: 'error', message: 'Title is required.', attribute: 'title' });
            score -= 20;
        } else if (name.length > 150) {
            issues.push({ severity: 'warning', message: 'Title is too long (> 150 chars).', attribute: 'title' });
            score -= 5;
        }

        // 3. Description
        const description = scoringPlainText(raw.description) || scoringPlainText(raw.short_description);
        if (!description) {
            issues.push({ severity: 'error', message: 'Description is required.', attribute: 'description' });
            score -= 15;
        }

        // 4. Image Link
        const images = Array.isArray(raw.images) ? raw.images : [];
        if (!scoringText(scoringRecord(images[0]).src)) {
            issues.push({ severity: 'error', message: 'Main image is required.', attribute: 'image_link' });
            score -= 20;
        }

        // 5. Price
        if (!scoringHasPrice(product.price)) {
            issues.push({ severity: 'error', message: 'Price is required.', attribute: 'price' });
            score -= 10;
        }

        // 6. GTIN / MPN (Identifier Exists)
        // Woo doesn't have standard GTIN fields by default, usually plugins add them.
        // We'll check for common meta keys or attributes if possible, or just warn.
        // For now, we'll check if 'sku' acts as MPN and warn if strictly no GTIN-like data found in meta_data
        const meta = Array.isArray(raw.meta_data) ? raw.meta_data : [];
        const hasGtin = meta.some(entry => {
            const item = scoringRecord(entry);
            const key = scoringText(item.key).toLowerCase();
            const value = item.value;
            return (key.includes('gtin') || key.includes('barcode') || key.includes('ean')) &&
                (scoringText(value) !== '' || (typeof value === 'number' && Number.isFinite(value) && value > 0));
        });

        if (!hasGtin) {
            // Not a hard error if "identifier_exists" is set to no, but generally we want it.
            issues.push({ severity: 'warning', message: 'GTIN/Barcode not found. Strongly recommended for performance.', attribute: 'gtin' });
            score -= 10;
        }

        // 7. Availability
        if (!scoringText(product.stockStatus)) {
            issues.push({ severity: 'error', message: 'Availability (stock status) is unknown.', attribute: 'availability' });
            score -= 10;
        }

        return {
            score: Math.max(0, score),
            issues
        };
    }
}
