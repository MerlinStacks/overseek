import type { WooProduct } from '@prisma/client';
import { scoringHasImage, scoringHasPrice, scoringPlainText, scoringRecord, scoringText } from '../utils/productScoring';

export interface SeoAnalysisResult {
    score: number;
    tests: {
        test: string;
        passed: boolean;
        message: string;
    }[];
}

export class SeoScoringService {

    static calculateScore(product: Partial<WooProduct>, focusKeyword?: string): SeoAnalysisResult {
        const tests: { test: string; passed: boolean; message: string }[] = [];
        let score = 0;
        let totalWeight = 0;

        const raw = scoringRecord(product.rawData);
        const name = scoringText(product.name);
        const description = scoringPlainText(raw.description);
        const shortDescription = scoringPlainText(raw.short_description);
        const permalink = scoringText(product.permalink);
        const keyword = scoringText(focusKeyword).replace(/\s+/g, ' ');
        const price = product.price;

        // Helper to add test
        const addTest = (testName: string, passed: boolean, message: string, weight: number = 10) => {
            tests.push({ test: testName, passed, message: passed ? `${testName} passed.` : message });
            totalWeight += weight;
            if (passed) score += weight;
        };

        // 1. Basic Content Checks
        addTest('Product Title', name.length > 5, 'Title is too short', 10);
        addTest('Product Description', description.length > 50 || shortDescription.length > 50, 'Description is too short', 10);
        addTest('Images', scoringHasImage(raw.images), 'No images found', 15);
        addTest('Price', scoringHasPrice(price), 'Price is missing or invalid', 5);

        // 2. Keyword Checks (if keyword provided)
        if (keyword) {
            const keywordLower = keyword.toLowerCase();

            addTest('Keyword in Title', name.toLowerCase().includes(keywordLower), `Title does not contain focus keyword "${keyword}"`, 20);

            const descLower = `${description} ${shortDescription}`.toLowerCase();
            addTest('Keyword in Description', descLower.includes(keywordLower), `Description does not contain focus keyword`, 15);

            addTest('Keyword in URL', permalink.toLowerCase().includes(keywordLower.replace(/ /g, '-')), 'URL does not contain keyword', 10);
        } else {
            // Penalize slightly for no keyword, or just skip?
            // Let's add a "warning" test that always fails if no keyword
            addTest('Focus Keyword Set', false, 'No focus keyword set for this product', 0);
            // We adjust totalWeight so max score isn't 100 if no keyword? 
            // Better to just treat it as a missed opportunity.
            totalWeight += 45; // The weight of the missing keyword tests
        }

        // Normalize Score to 100
        const finalScore = totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;

        return {
            score: finalScore,
            tests
        };
    }
}
