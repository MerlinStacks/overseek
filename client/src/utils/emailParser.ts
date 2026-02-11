/**
 * Email Parser Utilities
 * Functions for parsing, cleaning, and extracting information from email content.
 * Extracted from MessageBubble.tsx for reusability.
 */
import { escapeRegex } from './string';

export interface QuotedContentInfo {
    mainContent: string;
    quotedContent: string | null;
    quotedPreview: string | null;
    quotedLineCount: number;
    quotedAttachmentCount: number;
}

/**
 * Parses email content to extract subject line and body.
 */
export function parseEmailContent(content: string): { subject: string | null; body: string } {
    if (content.startsWith('Subject:')) {
        const lines = content.split('\n');
        const subjectLine = lines[0].replace('Subject:', '').trim();
        const body = lines.slice(2).join('\n').trim();
        return { subject: subjectLine, body };
    }
    return { subject: null, body: content };
}

/**
 * Cleans up raw email metadata and MIME header fragments from content.
 * Email replies often contain leaked header fragments like:
 * - "v="Content-Type" content="text/html; charset=Windows-1252">"
 * - "-html40">" (partial HTML doctype/meta tag fragments)
 * - CSS style fragments: "t-size: 12pt; color: rgb(0, 0, 0);">"
 * - Raw MIME boundaries and headers
 * 
 * IMPORTANT: Patterns must be targeted to avoid stripping actual content.
 * Use ^ anchors for line-start patterns or require specific orphaned formats.
 */
export function cleanEmailMetadata(content: string): string {
    return content
        // Remove CSS style rule fragments leaked from Outlook/email clients
        // Matches patterns like: "> P {margin-top:0;margin-bottom:0;}" or "P {font-...}"
        .replace(/^>?\s*[A-Z]+\s*\{[^}]*\}\s*$/gim, '')
        .replace(/>\s*[A-Z]+\s*\{[^}]*\}/gi, '')
        // Remove CSS style attribute fragments ONLY at line start (orphaned from stripped tags)
        // Matches lines starting with: t-size: 12pt; color: rgb(0, 0, 0);">
        .replace(/^[a-z-]*size:\s*\d+pt;[^>\n]*">\s*/gim, '')
        .replace(/^[a-z-]*color:\s*rgb\([^)]+\);?[^>\n]*">\s*/gim, '')
        // Remove lines that are just orphaned style attributes ending with ">
        // Must start with partial CSS and end with "> to be considered orphaned
        .replace(/^[a-z-]+:\s*[^;]{1,50};\s*">\s*/gim, '')
        // Remove partial HTML tag fragments like "-html40"> at line start
        .replace(/^-?html\d*["']?\s*>\s*/gim, '')
        // Remove standalone closing angle brackets with charset (at line start)
        .replace(/^[^<\n]{0,60}charset[^>]*>\s*/gim, '')
        // Remove broken HTML meta tag fragments (attribute leakage from stripped tags)
        .replace(/[a-z-]+=["'][^"']*["']\s*[a-z-]*=["'][^"']*charset[^"']*["'][^>]*>/gi, '')
        // Remove standalone Content-Type declarations (at line start)
        .replace(/^Content-Type[:\s]+[^\n<]+$/gim, '')
        // Remove MIME boundary markers
        .replace(/--[a-zA-Z0-9_-]+--?/g, '')
        // Remove charset declarations at line start
        .replace(/^charset\s*=\s*["']?[^"'\s>]+["']?\s*/gim, '')
        // Remove X-headers from email (X-Mailer, X-Priority, etc.)
        .replace(/^X-[A-Za-z-]+:.*$/gim, '')
        // Remove MIME-Version headers
        .replace(/^MIME-Version:.*$/gim, '')
        // Clean up lines that are ONLY attribute fragments (nothing else on the line)
        .replace(/^[a-z-]+=["'][^"']*["']>?\s*$/gim, '')
        // Remove orphaned closing angle brackets at start of lines
        .replace(/^["']?\s*>\s*$/gm, '')
        // Remove email quote markers on their own lines: < <, <<, >>, > >
        .replace(/^[<>]\s*[<>]\s*$/gm, '')
        .trim();
}

/**
 * Strips HTML tags and returns plain text for analysis.
 */
export function stripHtmlForAnalysis(html: string): string {
    // First clean email metadata then strip HTML
    return cleanEmailMetadata(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines
        .trim();
}

/**
 * Extracts a preview snippet from quoted content (first meaningful line or two).
 */
export function extractQuotedPreview(quotedContent: string): string {
    const text = stripHtmlForAnalysis(quotedContent);
    const lines = text.split('\n').filter(line => {
        const trimmed = line.trim();
        // Skip empty lines, quote markers, and metadata headers
        if (!trimmed) return false;
        if (trimmed.startsWith('>')) return false;
        if (/^(On|From|Sent|To|Subject|Date):/i.test(trimmed)) return false;
        if (/wrote:$/i.test(trimmed)) return false;
        if (/^-{3,}/.test(trimmed) || /^_{3,}/.test(trimmed)) return false;
        return true;
    });

    // Get first meaningful line, truncated if needed
    const preview = lines[0] || '';
    return preview.length > 80 ? preview.slice(0, 77) + '...' : preview;
}

/**
 * Counts meaningful lines in quoted content.
 */
export function countQuotedLines(quotedContent: string): number {
    const text = stripHtmlForAnalysis(quotedContent);
    return text.split('\n').filter(line => line.trim().length > 0).length;
}

/**
 * Counts attachments referenced in quoted content.
 */
export function countQuotedAttachments(quotedContent: string): number {
    const imgMatches = quotedContent.match(/<img[^>]+>/gi) || [];
    const attachmentMatches = quotedContent.match(/<\d+.*?\.pdf>|<\d+.*?\.docx?>|<\d+.*?\.xlsx?>/gi) || [];
    return imgMatches.length + attachmentMatches.length;
}

/**
 * Detects and separates quoted email content from the main message.
 * Handles various email clients: Gmail, Outlook, Apple Mail, etc.
 */
export function parseQuotedContent(body: string): QuotedContentInfo {
    // First, try to find HTML-based quote markers (Gmail blockquote, etc.)
    const htmlQuotePatterns = [
        // Gmail-style blockquote
        /<blockquote[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>/i,
        // Generic blockquote with cite
        /<blockquote[^>]*type="cite"[^>]*>/i,
        // Outlook-style divider (handles both single and double-quoted style attributes)
        /<div[^>]*style=["'][^"']*border-top[^"']*["'][^>]*>/i,
        // Apple Mail quote wrapper
        /<div[^>]*class="[^"]*AppleOriginalContents[^"]*"[^>]*>/i,
    ];

    const buildResult = (main: string, quoted: string | null): QuotedContentInfo => ({
        mainContent: main,
        quotedContent: quoted,
        quotedPreview: quoted ? extractQuotedPreview(quoted) : null,
        quotedLineCount: quoted ? countQuotedLines(quoted) : 0,
        quotedAttachmentCount: quoted ? countQuotedAttachments(quoted) : 0,
    });

    for (const pattern of htmlQuotePatterns) {
        const match = body.match(pattern);
        // Require at least 200 chars before the quote marker to avoid hiding short customer replies
        if (match && match.index !== undefined && match.index > 200) {
            return buildResult(
                body.slice(0, match.index).trim(),
                body.slice(match.index).trim()
            );
        }
    }

    // Strip HTML for text-based pattern matching
    const textBody = stripHtmlForAnalysis(body);

    // Patterns that typically start quoted content
    // IMPORTANT: These patterns must be precise to avoid hiding actual customer replies.
    // Email structure is often: [Customer Reply] -> [Quoted Thread with Headers]
    // We must only detect the quoted thread portion, not the customer's actual message.
    const quoteStartPatterns = [
        // iOS/Apple Mail: "On Jan 15, 2026, at 8:52 am, Name <email> wrote:"
        /On .+,\s*(at\s+)?\d{1,2}[:.]\d{2}\s*(am|pm)?,?\s*.+\s*wrote:/im,
        // Standard: "On Mon, Jan 15, 2026 at 8:52 AM Name <email> wrote:"
        /On .+ wrote:$/m,
        // Outlook style headers block - MUST have From + Sent + To together
        // This prevents matching a single "From:" line in the customer's message
        /From:\s*.+\n\s*Sent:\s*.+\n\s*To:/im,
        // Original Message dividers
        /-{2,}\s*Original Message\s*-{2,}/im,
        /-{2,}\s*Forwarded message\s*-{2,}/im,
        // Separator lines
        /^_{5,}$/m,
        /^-{5,}$/m,
        // CAUTION/Warning banners (often precede forwarded content)
        /CAUTION:\s*This email originated from outside/i,
    ];

    let splitIndex = -1;
    let matchedInTextBody = false;

    for (const pattern of quoteStartPatterns) {
        const match = textBody.match(pattern);
        // Require at least 100 chars before the quote marker to avoid hiding short customer replies
        // This ensures messages like "I accept. Thanks!" followed by quoted headers are preserved
        if (match && match.index !== undefined && match.index > 100) {
            if (splitIndex === -1 || match.index < splitIndex) {
                splitIndex = match.index;
                matchedInTextBody = true;
            }
        }
    }

    // Also check for consecutive ">" quoted lines
    const lines = textBody.split('\n');
    let consecutiveQuotedLines = 0;
    let firstQuoteIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('>')) {
            consecutiveQuotedLines++;
            if (firstQuoteIndex === -1) firstQuoteIndex = i;
        } else {
            if (consecutiveQuotedLines >= 2 && firstQuoteIndex !== -1) {
                const charIndex = lines.slice(0, firstQuoteIndex).join('\n').length;
                if (splitIndex === -1 || charIndex < splitIndex) {
                    splitIndex = charIndex;
                    matchedInTextBody = true;
                }
            }
            consecutiveQuotedLines = 0;
            firstQuoteIndex = -1;
        }
    }

    if (splitIndex > 0) {
        const isHtml = /<[a-z][\s\S]*>/i.test(body);

        if (matchedInTextBody && isHtml) {
            // Body is HTML — map the text-based splitIndex back to an HTML position
            // using the last few words before the split as an anchor.
            const textBeforeQuote = textBody.slice(0, splitIndex).trim();
            // Escape each word individually, then join with \s+ for flexible whitespace matching
            const lastWords = textBeforeQuote.split(/\s+/).slice(-5).map(escapeRegex).join('\\s+');
            if (lastWords.length > 10) {
                try {
                    const htmlSearchPattern = new RegExp(lastWords, 'i');
                    const htmlMatch = body.match(htmlSearchPattern);
                    if (htmlMatch && htmlMatch.index !== undefined) {
                        const htmlSplitIndex = htmlMatch.index + htmlMatch[0].length;
                        const afterMatch = body.slice(htmlSplitIndex);
                        const nextBreak = afterMatch.match(/^[^<]*(<|$)/);
                        const adjustedSplit = htmlSplitIndex + (nextBreak ? nextBreak[0].length - 1 : 0);
                        return buildResult(
                            body.slice(0, adjustedSplit).trim(),
                            body.slice(adjustedSplit).trim()
                        );
                    }
                } catch {
                    // If regex construction fails, fall through
                }
            }
            // Could not map text index to HTML — return unsplit to avoid garbled output
            return buildResult(body, null);
        }

        // Plain text body — splitIndex maps directly
        return buildResult(
            body.slice(0, splitIndex).trim(),
            body.slice(splitIndex).trim()
        );
    }

    return buildResult(body, null);
}
