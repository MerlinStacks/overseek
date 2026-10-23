import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendEmailConfig } from './SendEmailConfig';

vi.mock('../common/RichTextEditor', () => ({ RichTextEditor: ({ onChange }: { onChange: (value: string) => void }) => <button onClick={() => onChange('<p>Rich edit</p>')}>Edit rich text</button> }));
vi.mock('./MarketingEmailDesigner', () => ({ MarketingEmailDesigner: () => <div>Visual editor</div> }));
vi.mock('./flow/InlineEmailPreview', () => ({ InlineEmailPreview: () => <div>Inline preview</div> }));
vi.mock('./flow/EmailPreviewModal', () => ({ EmailPreviewModal: ({ onPreviewed, onClose }: { onPreviewed: () => void; onClose: () => void }) => <div><button onClick={onPreviewed}>Preview finished loading</button><button onClick={onClose}>Close preview</button></div> }));

afterEach(() => vi.restoreAllMocks());

describe('flow email configuration', () => {
    it('groups message details and template controls on the left with a dedicated preview column', () => {
        render(<SendEmailConfig config={{ subject: 'Order confirmation', htmlContent: '<p>Thanks</p>' }} onUpdate={vi.fn()} />);
        const details = screen.getByRole('region', { name: 'Message details' });
        const content = screen.getByRole('region', { name: 'Email content' });
        expect(details.parentElement).toHaveClass('lg:grid-cols-2');
        const preview = screen.getByRole('region', { name: 'Email preview and test' });
        expect(preview).toHaveClass('lg:flex', 'lg:self-stretch');
        expect(preview).not.toHaveClass('lg:sticky');
        expect(content.parentElement).toBe(details);
        expect(preview.parentElement).toBe(details.parentElement);
        expect(within(preview).getByText('Inline preview')).toBeInTheDocument();
        expect(within(details).getByDisplayValue('Order confirmation')).toBeInTheDocument();
        expect(within(details).getByLabelText('Delivery Category')).toBeInTheDocument();
        expect(within(content).getByRole('button', { name: 'Edit Design' })).toBeInTheDocument();
        expect(within(content).getByRole('button', { name: 'Preview and Test' })).toBeEnabled();
    });

    it('renders setup checks in the header slot and keeps their state current', () => {
        const header = document.createElement('div');
        document.body.appendChild(header);
        const { rerender, unmount } = render(<SendEmailConfig config={{}} onUpdate={vi.fn()} setupContainer={header} />);
        expect(within(header).getByRole('group', { name: 'Email step setup' })).toBeInTheDocument();
        expect(within(header).getByLabelText('Subject: incomplete')).toBeInTheDocument();
        rerender(<SendEmailConfig config={{ subject: 'Updated' }} onUpdate={vi.fn()} setupContainer={header} />);
        expect(within(header).getByLabelText('Subject: complete')).toBeInTheDocument();
        unmount();
        expect(header).toBeEmptyDOMElement();
        header.remove();
    });

    it('keeps advanced settings collapsed without losing configured values', () => {
        const update = vi.fn();
        render(<SendEmailConfig config={{ campaignSource: 'newsletter', overrideFrom: true, fromEmail: 'sender@example.com' }} onUpdate={update} />);
        const advanced = screen.getByText('Tracking and sender settings').closest('details');
        expect(advanced).not.toHaveAttribute('open');
        advanced?.setAttribute('open', '');
        expect(screen.getByDisplayValue('newsletter')).toBeVisible();
        expect(screen.getByDisplayValue('sender@example.com')).toBeVisible();
        fireEvent.change(screen.getByDisplayValue('newsletter'), { target: { value: 'orders' } });
        expect(update).toHaveBeenCalledWith('campaignSource', 'orders');
    });

    it('switches to the visual builder without asking to restore stale content', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const update = vi.fn();
        render(<SendEmailConfig config={{ templateType: 'html', htmlContent: '<p>Current HTML</p>', designJson: { old: true } }} onUpdate={update} />);
        fireEvent.click(screen.getByRole('radio', { name: /Visual Builder/ }));
        expect(window.confirm).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith('templateType', 'visual');
    });

    it.each(['html', 'richtext'] as const)('invalidates the saved visual design after a %s edit', (templateType) => {
        const update = vi.fn();
        render(<SendEmailConfig config={{ templateType, htmlContent: '<p>Old</p>', designJson: { old: true } }} onUpdate={vi.fn()} onUpdateMany={update} />);
        if (templateType === 'html') fireEvent.change(screen.getByPlaceholderText(/Your email HTML here/), { target: { value: '<p>HTML edit</p>' } });
        else fireEvent.click(screen.getByText('Edit rich text'));
        expect(update).toHaveBeenCalledWith({ htmlContent: templateType === 'html' ? '<p>HTML edit</p>' : '<p>Rich edit</p>', designJson: null });
    });

    it('does not count a blocked preview as completed', () => {
        render(<SendEmailConfig config={{ htmlContent: '<p>Content</p>' }} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByText('Preview and Test'));
        expect(screen.getByText('Preview/test').parentElement).not.toHaveClass('text-emerald-700');
    });

    it('counts only loaded previews, and invalidates completion after editing', () => {
        const config = { subject: 'Subject', htmlContent: '<a href="{{unsubscribe_url}}">Unsubscribe</a>' };
        const { rerender } = render(<SendEmailConfig config={config} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByText('Preview and Test'));
        expect(screen.getByText('Preview/test').parentElement).not.toHaveClass('text-emerald-700');
        fireEvent.click(screen.getByText('Preview finished loading'));
        expect(screen.getByText('Preview/test').parentElement).toHaveClass('text-emerald-700');
        fireEvent.click(screen.getByText('Close preview'));
        rerender(<SendEmailConfig config={{ ...config, subject: 'Changed' }} onUpdate={vi.fn()} />);
        expect(screen.getByText('Preview/test').parentElement).not.toHaveClass('text-emerald-700');
    });
});
