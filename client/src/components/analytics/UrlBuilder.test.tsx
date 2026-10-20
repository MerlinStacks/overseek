import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UrlBuilder } from './UrlBuilder';
afterEach(cleanup);
function fill(url = 'https://example.com/path?existing=1#section') {
    for (const [label, value] of [['Website URL', url], ['Campaign Source', ' newsletter '], ['Campaign Medium', 'email'], ['Campaign Name', 'summer & sale']]) {
        fireEvent.change(screen.getByLabelText(`${label} *`), { target: { value } });
    }
}
describe('campaign URL builder', () => {
    it('requires the marked fields and reports errors inline', () => {
        render(<UrlBuilder />);
        fireEvent.click(screen.getByRole('button', { name: 'Generate URL' }));
        expect(screen.getByRole('alert')).toHaveTextContent('required');
        expect(screen.queryByRole('status')).toBeNull();
    });
    it.each(['javascript:alert(1)', 'ftp://example.com', 'bad URL', 'https://user:pass@example.com'])('rejects %s', url => {
        render(<UrlBuilder />); fill(url);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('alert')).toHaveTextContent('HTTP or HTTPS');
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('encodes campaign fields and preserves unrelated query parameters and fragments', () => {
        render(<UrlBuilder />); fill();
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('status')).toHaveTextContent('https://example.com/path?existing=1&utm_source=newsletter&utm_medium=email&utm_campaign=summer+%26+sale#section');
        fireEvent.change(screen.getByLabelText('Campaign Name *'), { target: { value: 'new' } });
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('replaces existing UTM fields rather than duplicating them', () => {
        render(<UrlBuilder />); fill('https://example.com/?utm_source=old&utm_source=duplicate');
        fireEvent.submit(screen.getByRole('button').closest('form')!);
        expect(screen.getByRole('status')).not.toHaveTextContent('old');
        expect(screen.getByRole('status')).not.toHaveTextContent('duplicate');
    });
});
