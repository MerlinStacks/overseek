import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrderMetaSection } from './OrderMetaSection';
import { fixMojibake } from '../../utils/format';

describe('OrderMetaSection', () => {
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
