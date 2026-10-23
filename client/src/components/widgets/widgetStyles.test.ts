import { describe, expect, it } from 'vitest';
import { widgetCardClass, widgetGlassCardClass, widgetHeaderIconBadgeClass } from './widgetStyles';

describe('dashboard widget presentation', () => {
    it('uses one opaque, bordered surface for standard and legacy glass callers', () => {
        expect(widgetGlassCardClass).toBe(widgetCardClass);
        expect(widgetCardClass).toContain('bg-white dark:bg-slate-800');
        expect(widgetCardClass).toContain('border-slate-200 dark:border-slate-700');
        expect(widgetCardClass).not.toMatch(/backdrop|gradient|hover:shadow|bg-white\//);
    });

    it('brands decorative header chrome without changing chart series', () => {
        expect(widgetHeaderIconBadgeClass).toContain('bg-[var(--brand-subtle)]');
        expect(widgetHeaderIconBadgeClass).toContain('text-[var(--brand-text)]');
        expect(widgetHeaderIconBadgeClass).not.toMatch(/gradient|shadow/);
    });
});
