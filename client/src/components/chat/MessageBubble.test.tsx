import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageBubble } from './MessageBubble';

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { fullName: 'Agent' } }),
}));
vi.mock('./GravatarAvatar', () => ({ GravatarAvatar: () => null }));

afterEach(cleanup);

function renderMessage(content: string, senderType: 'CUSTOMER' | 'AGENT' = 'CUSTOMER') {
    return render(<MessageBubble message={{
        id: 'message-1', content, senderType,
        createdAt: '2026-09-22T10:00:00Z', isInternal: false,
    }} />);
}

describe('MessageBubble attachments', () => {
    it.each(['svg', 'eps', 'ai', 'custom'])('shows incoming %s files as downloads', (extension) => {
        const filename = `artwork.${extension}`;
        const url = `/uploads/attachments/123-${filename}`;
        const { container } = renderMessage(`Please check this artwork.\n\n[Attachment: ${filename}](${url})`);

        const link = screen.getByRole('link', { name: `Attachment: ${filename}` });
        expect(link).toHaveAttribute('href', new URL(url, window.location.origin).href);
        expect(link).toHaveAttribute('download');
        expect(container.querySelector(`img[src="${url}"]`)).toBeNull();
        expect(screen.getByText('Please check this artwork.')).toBeInTheDocument();
    });

    it('keeps all outgoing attachments visible after stripping the attachments section', () => {
        renderMessage('Here are the files.\n\n**Attachments:**\n' +
            ['proof.pdf', 'artwork.svg', 'print.eps'].map(name => `[${name}](/uploads/attachments/${name})`).join('\n'), 'AGENT');

        for (const name of ['proof.pdf', 'artwork.svg', 'print.eps']) {
            expect(screen.getByRole('link', { name })).toHaveAttribute('href', new URL(`/uploads/attachments/${name}`, window.location.origin).href);
        }
        expect(screen.getByText('Here are the files.')).toBeInTheDocument();
        expect(screen.queryByText('**Attachments:**')).not.toBeInTheDocument();
    });

    it.each(['SVG', 'EPS'])('recognizes external %s HTML links with query strings', (extension) => {
        const url = `https://example.com/artwork.${extension}?download=1`;
        const { container } = renderMessage(`<p>Artwork: <a href="${url}">Download artwork</a></p>`);
        expect(container.querySelector('a[download]')).toHaveAttribute('href', url);
    });

    it('deduplicates repeated attachment URLs and does not turn ordinary links into files', () => {
        const { container } = renderMessage('[artwork.svg](/uploads/attachments/artwork.svg)\n' +
            '[artwork.svg](/uploads/attachments/artwork.svg)\n[Website](https://example.com)');
        expect(container.querySelectorAll('a[download]')).toHaveLength(1);
    });

    it('recognizes external markdown artwork links by filename', () => {
        renderMessage('[artwork.eps](https://example.com/download?id=123)');
        expect(screen.getByRole('link', { name: 'artwork.eps' })).toHaveAttribute('href', 'https://example.com/download?id=123');
    });
});
