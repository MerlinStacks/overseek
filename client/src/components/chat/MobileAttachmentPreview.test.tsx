import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileAttachmentPreview } from './MobileAttachmentPreview';

describe('MobileAttachmentPreview', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reviews a file and waits for an explicit send, with a separate remove action', () => {
        const onSend = vi.fn();
        const onRemove = vi.fn();
        render(<MobileAttachmentPreview file={new File(['invoice'], 'invoice.pdf')} uploading={false} progress={null} sendingMessage={false} onSend={onSend} onRemove={onRemove} />);
        expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
        expect(onSend).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Send attachment' }));
        expect(onSend).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }));
        expect(onRemove).toHaveBeenCalledOnce();
    });

    it('shows indeterminate upload progress and prevents duplicate sends/removal', () => {
        render(<MobileAttachmentPreview file={new File(['invoice'], 'invoice.pdf')} uploading progress={null} sendingMessage={false} onSend={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByRole('status')).toHaveTextContent('Uploading and delivering');
        expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
        expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove attachment' })).toBeDisabled();
    });

    it('releases image preview URLs when the attachment changes and on unmount', () => {
        const createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        const props = { uploading: false, progress: null, sendingMessage: false, onSend: vi.fn(), onRemove: vi.fn() };
        const { rerender, unmount } = render(<MobileAttachmentPreview {...props} file={new File(['image'], 'first.png', { type: 'image/png' })} />);
        expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:first');
        rerender(<MobileAttachmentPreview {...props} file={new File(['image'], 'second.png', { type: 'image/png' })} />);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
        expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:second');
        unmount();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
    });
});
