import { describe, it, expect, vi } from 'vitest';
import { generateDigestHTML } from '../services/reportService';

// Mock DB because reportService uses it directly
vi.mock('../db/db', () => ({
    db: {
        orders: {
            where: () => ({
                between: () => ({
                    toArray: async () => [
                        { total: 100 },
                        { total: 50.50 }
                    ]
                })
            })
        }
    }
}));

vi.mock('dompurify', () => ({
    default: {
        sanitize: (str) => str
    }
}));

describe('Report Service', () => {
    it('generates digestive HTML correctly', async () => {
        const report = {
            title: 'Test Report',
            frequency: 'Daily',
            metrics: ['sales']
        };

        const html = await generateDigestHTML(report);
        console.log('GENERATED HTML:', html);

        expect(html).toContain('Test Report');
        expect(html).toContain('daily summary');
        expect(html).toContain('$150.50'); // 100 + 50.50
    });
});
