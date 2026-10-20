import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PresenceAvatars } from './PresenceAvatars';
afterEach(cleanup);
describe('presence avatars', () => {
    it('deduplicates tabs and exposes names including self to assistive technology', () => {
        render(<PresenceAvatars currentUserId="1" users={[{ userId: '1', name: 'Alice', connectedAt: 1 }, { userId: '1', name: 'Alice', connectedAt: 2 }, { userId: '2', name: ' ', connectedAt: 1 }]} />);
        expect(screen.getAllByRole('img')).toHaveLength(2);
        expect(screen.getByRole('img', { name: 'Alice (You)' })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('img', { name: 'Unknown editor' })).toHaveTextContent('U');
        expect(screen.getByText('2 editors')).toBeInTheDocument();
    });
    it('keeps the same avatar DOM on reconnection and renders nothing when empty', () => {
        const view = render(<PresenceAvatars users={[{ userId: '1', name: 'Alice', connectedAt: 1 }]} />);
        const avatar = screen.getByRole('img');
        view.rerender(<PresenceAvatars users={[{ userId: '1', name: 'Alice', connectedAt: 2 }]} />);
        expect(screen.getByRole('img')).toBe(avatar);
        view.rerender(<PresenceAvatars users={[]} />);
        expect(screen.queryByRole('group')).toBeNull();
    });
});
