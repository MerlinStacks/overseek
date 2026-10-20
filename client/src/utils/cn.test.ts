import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
    it('combines conditional classes and ignores empty inputs', () => {
        expect(cn('flex', undefined, null, false, { hidden: false, 'items-center': true }, ['gap-2']))
            .toBe('flex items-center gap-2');
    });

    it('lets later conflicting Tailwind classes override earlier ones', () => {
        expect(cn('p-2 text-red-500', 'p-4 text-blue-500')).toBe('p-4 text-blue-500');
    });

    it('preserves independent responsive and dark mode variants', () => {
        expect(cn('p-2 md:p-4 dark:text-white', 'p-3')).toBe('md:p-4 dark:text-white p-3');
    });
});
