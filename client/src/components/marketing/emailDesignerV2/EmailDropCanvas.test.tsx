import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultEmailDesignV2, type EmailSection } from '../../../lib/emailDesignerV2';
import { EmailDropCanvas } from './EmailDropCanvas';

vi.mock('./LiveBlock', () => ({ LiveBlock: ({ block }: { block: { id: string } }) => <span>{block.id}</span> }));
const section = (id: string, visibility: EmailSection['visibility']): EmailSection => ({
    id, visibility, stackMode: 'reverse', columns: ['left', 'right'].map(side => ({ id: `${id}-${side}`, width: 50, blocks: [{ id: `${id}-${side}-block`, type: 'text', props: { html: side } }] })),
});
const props = {
    theme: createDefaultEmailDesignV2().document.theme, previewWidth: 375, selectedSectionId: '', selectedBlockId: null,
    onSelectSection: vi.fn(), onSelectBlock: vi.fn(), onUpdateBlock: vi.fn(), onDuplicateBlock: vi.fn(), onDeleteBlock: vi.fn(), onDeleteSection: vi.fn(), onOpenSettings: vi.fn(), onOpenSectionSettings: vi.fn(), onDropOnSection: vi.fn(), onDropStructure: vi.fn(),
};

describe('canvas responsive preview', () => {
    it('hides device-specific content and stacks/reverses mobile columns', () => {
        const sections = [section('desktop', 'desktop'), section('mobile', 'mobile'), section('all', 'all')];
        const { rerender } = render(<EmailDropCanvas {...props} sections={sections} isMobilePreview />);
        expect(screen.queryByText('desktop-left-block')).not.toBeInTheDocument();
        expect(screen.getByText('mobile-left-block')).toBeInTheDocument();
        const column = screen.getByText('all-left-block').closest('.min-w-0')!;
        expect(column).toHaveStyle({ width: '100%' });
        expect(column.parentElement).toHaveStyle({ flexDirection: 'column-reverse' });
        rerender(<EmailDropCanvas {...props} sections={sections} isMobilePreview={false} />);
        expect(screen.queryByText('mobile-left-block')).not.toBeInTheDocument();
        expect(screen.getByText('desktop-left-block')).toBeInTheDocument();
        expect(column).toHaveStyle({ width: '50%' });
        expect(column.parentElement).toHaveStyle({ flexDirection: 'row' });
    });

    it('keeps editor controls out of zero-padding content flow', () => {
        const content = section('compact', 'all');
        content.padding = '0';
        content.columns.forEach(column => { column.padding = '0'; });
        render(<EmailDropCanvas {...props} sections={[content]} isMobilePreview={false} />);
        const column = screen.getByText('compact-left-block').closest('.min-w-0')!;
        expect(column).toHaveStyle({ padding: '0' });
        expect(column.className).not.toMatch(/min-h-|\bp-2\b|\bborder\b/);
        expect(column.closest('section')).toHaveStyle({ padding: '0' });
        screen.getAllByLabelText('Block actions').forEach(actions => expect(actions).toHaveClass('absolute'));
        screen.getAllByLabelText('Block insertion target').forEach(target => expect(target).toHaveClass('absolute'));
        screen.getAllByLabelText('Structure insertion target').forEach(target => expect(target).toHaveClass('absolute'));
    });

    it('retains a usable drop area for empty columns only', () => {
        const content = section('empty', 'all');
        content.columns[0].blocks = [];
        render(<EmailDropCanvas {...props} sections={[content]} isMobilePreview={false} />);
        expect(screen.getByText('Drop here')).toHaveClass('min-h-16');
        expect(screen.getByText('empty-right-block').closest('.min-w-0')).not.toHaveClass('min-h-16');
    });
});
