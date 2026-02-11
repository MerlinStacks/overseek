/**
 * Unit tests for emailParser.ts
 * Covers parseQuotedContent across Outlook, Gmail, Apple Mail, and plain text email formats.
 */

import { describe, it, expect } from 'vitest';
import { parseQuotedContent, parseEmailContent, stripHtmlForAnalysis } from './emailParser';

describe('parseEmailContent', () => {
    it('extracts subject and body from Subject: prefixed content', () => {
        const content = 'Subject: Hello World\n\nThis is the body.';
        const result = parseEmailContent(content);
        expect(result.subject).toBe('Hello World');
        expect(result.body).toBe('This is the body.');
    });

    it('returns null subject when no Subject: prefix', () => {
        const content = 'Just a regular message';
        const result = parseEmailContent(content);
        expect(result.subject).toBeNull();
        expect(result.body).toBe('Just a regular message');
    });
});

describe('parseQuotedContent', () => {
    describe('Outlook HTML with single-quoted style attributes', () => {
        it('detects border-top divider with single quotes', () => {
            // Simulates Outlook Word-generated HTML with style='...' (single quotes)
            const body = `
                <div class="WordSection1">
                    <p class="MsoNormal"><span style='font-size:11.0pt'>Hi Customer Service,</span></p>
                    <p class="MsoNormal"><span style='font-size:11.0pt'>Is it possible to change the size?</span></p>
                    <p class="MsoNormal"><span style='font-size:11.0pt'>Regards</span></p>
                    <p class="MsoNormal"><span style='font-size:11.0pt'>Jo Suprano</span></p>
                </div>
                <div style='border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm'>
                    <p class="MsoNormal"><b>From:</b> CustomKings &lt;hello@customkings.com.au&gt;</p>
                    <p class="MsoNormal"><b>Sent:</b> Monday, 9 February 2026 11:28 AM</p>
                    <p class="MsoNormal"><b>To:</b> supranoconcrete@bigpond.com</p>
                    <p class="MsoNormal"><b>Subject:</b> Re: Joan Suprano order</p>
                    <p class="MsoNormal">Previous reply content here</p>
                </div>
            `;
            const result = parseQuotedContent(body);
            expect(result.quotedContent).not.toBeNull();
            expect(result.mainContent).toContain('Hi Customer Service');
            expect(result.mainContent).toContain('Jo Suprano');
            expect(result.quotedContent).toContain('CustomKings');
        });

        it('detects border-top divider with double quotes', () => {
            const body = `
                <div class="WordSection1">
                    <p>Hello, I have a question about my order. Can you please check the status? Thanks very much for your assistance.</p>
                </div>
                <div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm">
                    <p><b>From:</b> Support &lt;support@example.com&gt;</p>
                    <p>Previous thread here</p>
                </div>
            `;
            const result = parseQuotedContent(body);
            expect(result.quotedContent).not.toBeNull();
            expect(result.mainContent).toContain('question about my order');
            expect(result.quotedContent).toContain('Previous thread');
        });
    });

    describe('Gmail blockquote', () => {
        it('detects gmail_quote blockquote', () => {
            const body = `
                <div dir="ltr">
                    <p>Thanks for the update, I appreciate it! Let me know if you need anything else from my side regarding the order.</p>
                </div>
                <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
                    <div>On Mon, Jan 15, 2026 at 8:52 AM wrote:</div>
                    <div>Your order has been shipped.</div>
                </blockquote>
            `;
            const result = parseQuotedContent(body);
            expect(result.quotedContent).not.toBeNull();
            expect(result.mainContent).toContain('Thanks for the update');
            expect(result.quotedContent).toContain('order has been shipped');
        });
    });

    describe('Plain text email patterns', () => {
        it('detects Outlook From/Sent/To block in plain text', () => {
            const body = `Hi there,

I wanted to follow up on my previous request about changing the dimensions of my order. Could you please confirm this is possible?

Thanks,
John Smith

From: Support Team
Sent: Wednesday, 5 February 2026 3:45 PM
To: john@example.com
Subject: Re: Order Change

We received your request and are processing it.`;
            const result = parseQuotedContent(body);
            expect(result.quotedContent).not.toBeNull();
            expect(result.mainContent).toContain('follow up');
            expect(result.mainContent).toContain('John Smith');
            expect(result.quotedContent).toContain('Support Team');
        });

        it('detects "On ... wrote:" pattern in plain text', () => {
            const body = `Sounds good, thank you for the quick reply! I will wait for the tracking number to arrive in my inbox before following up.

On Mon, Jan 15, 2026 at 8:52 AM Support <support@example.com> wrote:
> Your order has been shipped.
> Thank you for your patience.`;
            const result = parseQuotedContent(body);
            expect(result.quotedContent).not.toBeNull();
            expect(result.mainContent).toContain('Sounds good');
        });
    });

    describe('No quoted content', () => {
        it('returns null quotedContent for plain messages', () => {
            const body = 'Just a simple message with no quotes at all.';
            const result = parseQuotedContent(body);
            expect(result.quotedContent).toBeNull();
            expect(result.mainContent).toBe(body);
        });
    });

    describe('HTML body with text-based match fallback', () => {
        it('does not apply text splitIndex to HTML body when lastWords mapping fails', () => {
            // HTML body where the Outlook divider doesn't use border-top style,
            // but the text body has a From/Sent/To block after stripping HTML.
            // The text index should NOT be applied to the raw HTML.
            const body = `
                <div><p>Hello, thanks for getting back to me regarding the invoice for the project we discussed last week during the meeting.</p></div>
                <div><p><b>From:</b> Someone</p><p><b>Sent:</b> Today</p><p><b>To:</b> Me</p><p>Old thread content</p></div>
            `;
            const result = parseQuotedContent(body);
            // Either correctly splits via lastWords mapping, or returns full body as main (no garbled split)
            if (result.quotedContent) {
                expect(result.mainContent).toContain('Hello');
                expect(result.mainContent).not.toContain('Old thread');
            } else {
                // If it can't split, the full body is returned as mainContent
                expect(result.mainContent).toContain('Hello');
                expect(result.mainContent).toContain('Old thread');
            }
        });
    });
});

describe('stripHtmlForAnalysis', () => {
    it('converts HTML to readable plain text', () => {
        const html = '<p>Hello</p><br/><div>World</div>';
        const text = stripHtmlForAnalysis(html);
        expect(text).toContain('Hello');
        expect(text).toContain('World');
    });

    it('decodes HTML entities', () => {
        const html = '&lt;tag&gt; &amp; &nbsp;more';
        const text = stripHtmlForAnalysis(html);
        expect(text).toContain('<tag>');
        expect(text).toContain('&');
    });
});
