import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToneSelection, PlatformSelection } from './AdCopySelections';
import { GeneratedCopyDisplay } from './GeneratedCopyDisplay';
afterEach(cleanup);
describe('ad copy controls', () => {
    it('exposes selected choices and never submits a surrounding form', () => {
        const tone = vi.fn(), platform = vi.fn(), submit = vi.fn(event => event.preventDefault());
        render(<form onSubmit={submit}><ToneSelection tonePresets={[{ id: 'tone', name: 'Friendly', description: 'Tone' }]} selectedTone="tone" onSelect={tone} /><PlatformSelection platforms={[{ id: 'google', name: 'Google' }]} selectedPlatform="google" onSelect={platform} /></form>);
        expect(screen.getByRole('group', { name: 'Tone & Style' })).toBeInTheDocument();
        const button = screen.getByRole('button', { name: 'Friendly Tone' }); expect(button).toHaveAttribute('aria-pressed', 'true'); fireEvent.click(button);
        fireEvent.click(screen.getByRole('button', { name: 'Google' })); expect(tone).toHaveBeenCalledWith('tone'); expect(platform).toHaveBeenCalledWith('google'); expect(submit).not.toHaveBeenCalled();
    });
    it('makes copy actions discoverable without hover and labels their source', () => {
        const copy = vi.fn(), all = vi.fn();
        render(<GeneratedCopyDisplay generatedCopy={{ headlines: ['Headline'], descriptions: ['Description'], primaryTexts: ['Primary'], source: 'ai' }} copiedItems={new Set(['h-0'])} onCopy={copy} onCopyAll={all} />);
        for (const name of ['Copied headline 1', 'Copy description 1', 'Copy primary text 1']) {
            const button = screen.getByRole('button', { name }); expect(button).not.toHaveClass('opacity-0'); fireEvent.click(button); expect(button).toHaveAttribute('type', 'button');
        }
        expect(copy).toHaveBeenCalledWith('Headline', 'h-0'); expect(copy).toHaveBeenCalledWith('Description', 'd-0'); expect(copy).toHaveBeenCalledWith('Primary', 'p-0');
        fireEvent.click(screen.getByRole('button', { name: 'Copy All' })); expect(all).toHaveBeenCalledOnce();
    });
});
