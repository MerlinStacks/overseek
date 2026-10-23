import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailSection } from '../../../lib/emailDesignerV2';
import { EmailLayersPanel } from './EmailLayersPanel';

const sections: EmailSection[] = [{ id: 'section', name: 'Hero', visibility: 'desktop', columns: [
    { id: 'left', width: 50, blocks: [{ id: 'title', type: 'text', visibility: 'mobile', props: { html: '<h1>Your story is waiting.</h1>' } }] },
    { id: 'right', width: 50, blocks: [{ id: 'logo', type: 'image', props: { src: 'https://shop.test/logo.png', alt: 'Store logo' } }] },
] }];
const actions = { onReorderSection: vi.fn(), onRelocateBlock: vi.fn(), onStepBlock: vi.fn(), onCloneSection: vi.fn(), onDeleteSection: vi.fn(), onCloneBlock: vi.fn(), onDeleteBlock: vi.fn() };
beforeEach(() => vi.clearAllMocks());
function transfer() {
    const data = new Map<string, string>();
    return { get types() { return [...data.keys()]; }, setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) || '', effectAllowed: 'none', dropEffect: 'none' };
}
function dropAt(element: HTMLElement, dataTransfer: ReturnType<typeof transfer>, clientY = 0) {
    const event = createEvent.drop(element, { dataTransfer });
    Object.defineProperty(event, 'clientY', { value: clientY });
    fireEvent(element, event);
}

describe('email layers panel', () => {
    it('lists sections, columns and block summaries, including hidden content', () => {
        render(<EmailLayersPanel {...actions} sections={sections} selectedSectionId="section" selectedBlockId={null} onSelect={vi.fn()} />);
        expect(screen.getByRole('navigation', { name: 'Email layers' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select section Hero' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Column 1')).toBeInTheDocument();
        expect(screen.getByText('Column 2')).toBeInTheDocument();
        expect(screen.getByText('desktop only')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select Text: Your story is waiting.' })).toBeInTheDocument();
        expect(screen.getByText('Text · mobile only')).toBeInTheDocument();
    });

    it('selects the containing section and block together and reflects the selection', () => {
        const onSelect = vi.fn();
        const { rerender } = render(<EmailLayersPanel {...actions} sections={sections} selectedSectionId="section" selectedBlockId={null} onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button', { name: 'Select Image: Store logo' }));
        expect(onSelect).toHaveBeenCalledWith('section', 'logo');
        rerender(<EmailLayersPanel {...actions} sections={sections} selectedSectionId="section" selectedBlockId="logo" onSelect={onSelect} />);
        expect(screen.getByRole('button', { name: 'Select Image: Store logo' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Select section Hero' })).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByRole('button', { name: 'Select section Hero' }));
        expect(onSelect).toHaveBeenLastCalledWith('section');
    });

    it('provides an empty state', () => {
        render(<EmailLayersPanel {...actions} sections={[]} selectedSectionId="" selectedBlockId={null} onSelect={vi.fn()} />);
        expect(screen.getByText('Add a structure to start your email.')).toBeInTheDocument();
    });
    it('wires clone and delete icons without accidentally selecting the layer', () => {
        const onSelect = vi.fn();
        render(<EmailLayersPanel {...actions} sections={sections} selectedSectionId="section" selectedBlockId={null} onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clone section Hero' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete section Hero' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clone Text: Your story is waiting.' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Image: Store logo' }));
        expect(actions.onCloneSection).toHaveBeenCalledWith('section');
        expect(actions.onDeleteSection).toHaveBeenCalledWith('section');
        expect(actions.onCloneBlock).toHaveBeenCalledWith('title');
        expect(actions.onDeleteBlock).toHaveBeenCalledWith('logo');
        expect(onSelect).not.toHaveBeenCalled();
    });
    it('supports keyboard reordering from handles without bubbling to the canvas shortcut', () => {
        const bubble = vi.fn();
        render(<div onKeyDown={bubble}><EmailLayersPanel {...actions} sections={sections} selectedSectionId="section" selectedBlockId="title" onSelect={vi.fn()} /></div>);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Drag Text: Your story is waiting.' }), { altKey: true, key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByRole('button', { name: 'Drag section Hero' }), { altKey: true, key: 'ArrowUp' });
        expect(actions.onStepBlock).toHaveBeenCalledWith('title', 1);
        expect(actions.onReorderSection).toHaveBeenCalledWith('section', 0);
        expect(bubble).not.toHaveBeenCalled();
    });
    it('drags a block into another column or an empty section', () => {
        const empty: EmailSection = { id: 'empty', name: 'Empty', columns: [{ id: 'empty-column', width: 100, blocks: [] }] };
        render(<EmailLayersPanel {...actions} sections={[...sections, empty]} selectedSectionId="section" selectedBlockId={null} onSelect={vi.fn()} />);
        const dataTransfer = transfer();
        fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Text: Your story is waiting.' }), { dataTransfer });
        dropAt(screen.getByLabelText('Column 2 in Hero'), dataTransfer);
        expect(actions.onRelocateBlock).toHaveBeenLastCalledWith('title', 'section', 'right', 1);
        fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Text: Your story is waiting.' }), { dataTransfer });
        dropAt(screen.getByLabelText('Column 1 in Empty'), dataTransfer);
        expect(actions.onRelocateBlock).toHaveBeenLastCalledWith('title', 'empty', 'empty-column', 0);
        expect(dataTransfer.getData('application/x-overseek-existing-block')).toBe('title');
    });
    it('supports before/after block drops and whole-section reordering', () => {
        render(<EmailLayersPanel {...actions} sections={sections} selectedSectionId="section" selectedBlockId={null} onSelect={vi.fn()} />);
        const dataTransfer = transfer();
        fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Text: Your story is waiting.' }), { dataTransfer });
        dropAt(screen.getByLabelText('Block layer Image: Store logo'), dataTransfer, 1);
        expect(actions.onRelocateBlock).toHaveBeenLastCalledWith('title', 'section', 'right', 1);
        fireEvent.dragStart(screen.getByRole('button', { name: 'Drag section Hero' }), { dataTransfer });
        dropAt(screen.getByLabelText('Block layer Image: Store logo'), dataTransfer, 0);
        expect(actions.onReorderSection).toHaveBeenLastCalledWith('section', 0);
        expect(actions.onRelocateBlock).toHaveBeenCalledTimes(1);
    });
    it('accepts a canvas block drag and ignores unrelated drag data', () => {
        render(<EmailLayersPanel {...actions} sections={sections} selectedSectionId="section" selectedBlockId={null} onSelect={vi.fn()} />);
        const dataTransfer = transfer();
        dataTransfer.setData('text/plain', 'other');
        dropAt(screen.getByLabelText('Column 2 in Hero'), dataTransfer);
        expect(actions.onRelocateBlock).not.toHaveBeenCalled();
        dataTransfer.setData('application/x-overseek-existing-block', 'title');
        dropAt(screen.getByLabelText('Column 2 in Hero'), dataTransfer);
        expect(actions.onRelocateBlock).toHaveBeenCalledWith('title', 'section', 'right', 1);
    });
});
