import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderMetaSection } from './OrderMetaSection';
import { fixMojibake } from '../../utils/format';

afterEach(cleanup);

describe('OrderMetaSection', () => {
    it('keeps product options compact and collapses field groups independently', () => {
        render(<OrderMetaSection onImageClick={vi.fn()} metaData={[
            { key: 'pa_size', value: 'Large' },
            { key: 'custom_message', value: 'For Mum' },
            { key: 'upload', value: 'https://uploads.example.test/photo.png' },
        ]} />);
        expect(screen.getByText('Large')).toHaveClass('text-red-700');
        const custom = screen.getByRole('button', { name: /Custom Fields/ });
        const uploads = screen.getByRole('button', { name: /Uploaded Files/ });
        expect(custom).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(custom);
        expect(screen.getByText('For Mum')).not.toBeVisible();
        expect(screen.getByText('Large')).toBeVisible();
        expect(uploads).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: /Load external image/ })).toBeVisible();
        fireEvent.click(uploads);
        expect(screen.getByRole('region', { name: 'Order item details' }).querySelector('img')).toBeNull();
        fireEvent.click(custom);
        expect(screen.getByText('For Mum')).toBeVisible();
    });

    it('does not print long raw upload URLs and only makes safe field URLs clickable', () => {
        const upload = `https://uploads.example.test/${'long-file-name-'.repeat(30)}.png`;
        const link = `https://example.test/${'details/'.repeat(30)}`;
        render(<OrderMetaSection onImageClick={vi.fn()} metaData={[
            { key: 'upload', value: upload }, { key: 'link', value: link },
            { key: 'unsafe', value: 'javascript:alert(1)' },
        ]} />);
        expect(screen.queryByText(upload)).toBeNull();
        const anchor = screen.getByRole('link');
        expect(anchor).toHaveAttribute('href', link);
        expect(anchor.textContent!.length).toBeLessThan(65);
        expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByRole('region', { name: 'Order item details' })).toHaveClass('min-w-0');
    });

    it('omits upload guidance from orders with only custom fields', () => {
        render(<OrderMetaSection onImageClick={vi.fn()} metaData={[{ key: 'message', value: 'Hello' }]} />);
        expect(screen.queryByText(/External images load/)).toBeNull();
    });

    it('renders meta values with preserved line breaks and emoji text', () => {
        const onImageClick = vi.fn();

        render(
            <OrderMetaSection
                onImageClick={onImageClick}
                metaData={[
                    {
                        key: 'custom_message',
                        value: 'Line 1\nLine 2 🫶🏼',
                        display_key: 'Custom Message',
                        display_value: 'Line 1\nLine 2 🫶🏼',
                    },
                ]}
            />
        );

        const valueNode = screen.getByText(/Line 1\s*Line 2 🫶🏼/);
        expect(valueNode).toBeInTheDocument();
        expect(valueNode).toHaveClass('whitespace-pre-line');
    });
});

describe('fixMojibake', () => {
    it('keeps already valid Unicode text intact', () => {
        expect(fixMojibake('Line 1\nLine 2 🫶🏼 café 你好')).toBe('Line 1\nLine 2 🫶🏼 café 你好');
        expect(fixMojibake('Already fine 🫶🏼')).toBe('Already fine 🫶🏼');
    });
});
