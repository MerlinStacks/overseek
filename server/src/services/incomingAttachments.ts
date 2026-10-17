import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ParsedMail } from 'mailparser';
import { getAttachmentUrl } from '../utils/attachmentUrl';
import { getUploadsDir } from '../utils/uploadPaths';

/** Preserve MIME parts: names, sizes and inline dispositions do not prove a file is a signature. */
export function storeIncomingAttachments(mail: Pick<ParsedMail, 'html' | 'attachments'>) {
    let html = mail.html || false;
    const attachments: Array<{ filename: string; url: string; type: string }> = [];
    const directory = path.join(getUploadsDir(), 'attachments');
    fs.mkdirSync(directory, { recursive: true });

    for (const [index, attachment] of (mail.attachments || []).entries()) {
        if (!attachment.content) continue;
        const type = attachment.contentType || 'application/octet-stream';
        const extension = type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
        const filename = attachment.filename || `attachment-${index + 1}.${extension}`;
        // MIME filenames are untrusted and can contain Windows or Unix path separators.
        const safeName = filename.replace(/[\\/\x00-\x1f\x7f]/g, '_');
        const storageName = `${randomUUID()}-${safeName}`;
        fs.writeFileSync(path.join(directory, storageName), attachment.content);
        const url = getAttachmentUrl(storageName);
        const cid = attachment.contentId?.replace(/^<|>$/g, '');
        let referenced = false;
        if (html && cid) {
            // Match the complete URI, not a CID prefix (image1 must not replace image10).
            html = html.replace(/cid:([^\s"'<>]+)/gi, (uri, value: string) => {
                let decoded = value;
                try { decoded = decodeURIComponent(value); } catch { /* Literal percent in CID. */ }
                if (decoded.replace(/^<|>$/g, '') !== cid) return uri;
                referenced = true;
                return url;
            });
        }
        // Referenced inline images remain in the body; all other parts get download links.
        if (!referenced) attachments.push({ filename, url, type });
    }
    return { html, attachments };
}
