import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { compileEmailDesignV2, createDefaultEmailDesignV2 } from '../../lib/emailDesignerV2';
import { MarketingEmailDesigner } from './MarketingEmailDesigner';

const mock = vi.hoisted(() => ({ editor: vi.fn() }));
vi.mock('./EmailDesignEditorV2', () => ({ EmailDesignEditorV2: (props: unknown) => { mock.editor(props); return <div>Visual designer</div>; } }));

describe('safe visual editor entry', () => {
    it('imports HTML-only content instead of starting a blank design', async () => {
        render(<MarketingEmailDesigner initialHtml="<p>Keep this HTML</p>" onSave={vi.fn()} onCancel={vi.fn()} />);
        await screen.findByText('Visual designer');
        const design = mock.editor.mock.lastCall![0].initialDesign;
        expect(compileEmailDesignV2(design)).toContain('Keep this HTML');
        expect(compileEmailDesignV2(design)).not.toContain('Big news');
    });

    it('imports HTML when the stored design format is unsupported', async () => {
        render(<MarketingEmailDesigner initialDesign={{ obsolete: true }} initialHtml="<p>Existing HTML</p>" onSave={vi.fn()} onCancel={vi.fn()} />);
        await screen.findByText('Visual designer');
        expect(compileEmailDesignV2(mock.editor.mock.lastCall![0].initialDesign)).toContain('Existing HTML');
    });

    it('opens a matching saved design without a replacement prompt', async () => {
        const design = createDefaultEmailDesignV2();
        render(<MarketingEmailDesigner initialDesign={design} initialHtml={compileEmailDesignV2(design)} onSave={vi.fn()} onCancel={vi.fn()} />);
        await screen.findByText('Visual designer');
        expect(screen.queryByText('Replace with new visual design')).not.toBeInTheDocument();
        expect(mock.editor.mock.lastCall![0].initialDesign).toBe(design);
    });

    it('uses replacement HTML rather than a stale visual design', async () => {
        render(<MarketingEmailDesigner initialDesign={createDefaultEmailDesignV2()} initialHtml="<p>Replacement content</p>" onSave={vi.fn()} onCancel={vi.fn()} />);
        await screen.findByText('Visual designer');
        const html = compileEmailDesignV2(mock.editor.mock.lastCall![0].initialDesign);
        expect(html).toContain('Replacement content');
        expect(html).not.toContain('Big news');
    });
});
