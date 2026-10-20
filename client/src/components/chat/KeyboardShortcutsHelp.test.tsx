import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';
afterEach(cleanup);
describe('keyboard shortcuts guidance', () => {
    it('explains when shortcuts are paused and preserves the list', () => {
        render(<KeyboardShortcutsHelp isOpen onClose={vi.fn()} />);
        expect(screen.getByRole('dialog')).toHaveTextContent('Shortcuts are paused while typing'); expect(screen.getByText('Next conversation')).toBeInTheDocument();
    });
});
