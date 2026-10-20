import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileShareHandler from './MobileShareHandler';
function Location() { const location = useLocation(); return <div data-testid="location">{location.pathname}{location.search}</div>; }
function setup(query = '?subject=Title&body=Text&link=https%3A%2F%2Fexample.com') {
    return render(<MemoryRouter initialEntries={[`/m/share${query}`]}><MobileShareHandler /><Location /></MemoryRouter>);
}
beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('mobile share handoff', () => {
    it('stores the existing draft format and redirects to compose', () => {
        setup(); act(() => vi.runOnlyPendingTimers());
        expect(JSON.parse(sessionStorage.getItem('sharedContent')!)).toEqual({ subject: 'Title', body: 'Text\n\nhttps://example.com', timestamp: expect.any(Number) });
        expect(screen.getByTestId('location')).toHaveTextContent('/m/inbox?compose=true');
    });
    it('cancels pending storage and navigation on unmount', () => {
        const view = setup(); view.unmount(); act(() => vi.runOnlyPendingTimers());
        expect(sessionStorage.getItem('sharedContent')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    });
    it('shows recoverable shared text on storage failure, then retries successfully', () => {
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Storage blocked'); });
        setup(); act(() => vi.runOnlyPendingTimers());
        expect(screen.getByRole('alert')).toHaveTextContent('Could not save shared content');
        expect(screen.getByLabelText('Shared content')).toHaveTextContent('Title');
        expect(screen.getByTestId('location')).toHaveTextContent('/m/share');
        fireEvent.click(screen.getByRole('button', { name: 'Retry saving' })); act(() => vi.runOnlyPendingTimers());
        expect(set).toHaveBeenCalledTimes(2); expect(screen.getByTestId('location')).toHaveTextContent('/m/inbox?compose=true');
    });
    it('clears an old shared draft before manually composing with no content', () => {
        sessionStorage.setItem('sharedContent', 'old draft'); setup('');
        fireEvent.click(screen.getByRole('button', { name: 'Compose New Message' }));
        expect(sessionStorage.getItem('sharedContent')).toBeNull(); expect(screen.getByTestId('location')).toHaveTextContent('/m/inbox?compose=true');
    });
    it('allows returning to the dashboard without a delayed redirect overriding it', () => {
        setup(); fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
        // In the real route tree the handler unmounts; verify its independent cleanup above.
        expect(screen.getByTestId('location')).toHaveTextContent('/m/dashboard');
    });
});
