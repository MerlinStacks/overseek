import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EmailSection } from '../../../lib/emailDesignerV2';
import { EmailLayersPanel } from './EmailLayersPanel';

const sections: EmailSection[] = [{ id: 'section', name: 'Hero', visibility: 'desktop', columns: [
    { id: 'left', width: 50, blocks: [{ id: 'title', type: 'text', visibility: 'mobile', props: { html: '<h1>Your story is waiting.</h1>' } }] },
    { id: 'right', width: 50, blocks: [{ id: 'logo', type: 'image', props: { src: 'https://shop.test/logo.png', alt: 'Store logo' } }] },
] }];

describe('email layers panel', () => {
    it('lists sections, columns and block summaries, including hidden content', () => {
        render(<EmailLayersPanel sections={sections} selectedSectionId="section" selectedBlockId={null} onSelect={vi.fn()} />);
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
        const { rerender } = render(<EmailLayersPanel sections={sections} selectedSectionId="section" selectedBlockId={null} onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button', { name: 'Select Image: Store logo' }));
        expect(onSelect).toHaveBeenCalledWith('section', 'logo');
        rerender(<EmailLayersPanel sections={sections} selectedSectionId="section" selectedBlockId="logo" onSelect={onSelect} />);
        expect(screen.getByRole('button', { name: 'Select Image: Store logo' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Select section Hero' })).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByRole('button', { name: 'Select section Hero' }));
        expect(onSelect).toHaveBeenLastCalledWith('section');
    });

    it('provides an empty state', () => {
        render(<EmailLayersPanel sections={[]} selectedSectionId="" selectedBlockId={null} onSelect={vi.fn()} />);
        expect(screen.getByText('Add a structure to start your email.')).toBeInTheDocument();
    });
});
