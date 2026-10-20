import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const recovery = vi.hoisted(() => ({ isChunkLoadError: vi.fn(), handleChunkLoadError: vi.fn() }));
vi.mock('../../utils/deploymentRecovery', () => recovery);
import { ErrorBoundary } from './ErrorBoundary';
function Broken(): never { throw new Error('Render failed'); }
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('error boundary recovery', () => {
    it.each([null, false, ''])('honors an explicitly empty fallback: %j', fallback => {
        const { container } = render(<ErrorBoundary fallback={fallback}><Broken /></ErrorBoundary>); expect(container).toBeEmptyDOMElement();
    });
    it('contains a throwing reporting callback and still attempts chunk recovery', () => {
        recovery.isChunkLoadError.mockReturnValue(true);
        render(<ErrorBoundary onError={() => { throw new Error('Reporting failed'); }}><Broken /></ErrorBoundary>);
        expect(screen.getByRole('alert')).toHaveTextContent('Render failed'); expect(recovery.handleChunkLoadError).toHaveBeenCalled();
    });
    it('retains recovery controls if deployment recovery throws', () => {
        recovery.isChunkLoadError.mockReturnValue(true); recovery.handleChunkLoadError.mockImplementation(() => { throw new Error('Storage blocked'); });
        render(<ErrorBoundary><Broken /></ErrorBoundary>); expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument();
    });
    it('bounds failing resets and does not submit a surrounding form', () => {
        const submit = vi.fn(event => event.preventDefault());
        render(<form onSubmit={submit}><ErrorBoundary maxSoftResets={1} onReset={() => { throw new Error('Reset failed'); }}><Broken /></ErrorBoundary></form>);
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Retry attempts: 1/1'); expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull(); expect(submit).not.toHaveBeenCalled();
    });
    it('retries rendering after a successful reset callback', () => {
        let broken = true;
        function Content() { if (broken) throw new Error('Before reset'); return <p>Recovered</p>; }
        render(<ErrorBoundary onReset={() => { broken = false; }}><Content /></ErrorBoundary>);
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' })); expect(screen.getByText('Recovered')).toBeInTheDocument();
    });
});
