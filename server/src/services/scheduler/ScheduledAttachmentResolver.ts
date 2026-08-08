import { promises as fs } from 'fs';
import path from 'path';
import { getUploadsDir } from '../../utils/uploadPaths';

const MAX_SCHEDULED_ATTACHMENTS = 10;

export type ScheduledAttachmentReference = {
    storageKey: string;
    filename: string;
    contentType: string;
};

export type ResolvedScheduledAttachment = ScheduledAttachmentReference & {
    path: string;
};

export class InvalidScheduledAttachmentError extends Error {
    constructor(message = 'Invalid scheduled attachment') {
        super(message);
        this.name = 'InvalidScheduledAttachmentError';
    }
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function parseReference(value: unknown): ScheduledAttachmentReference {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new InvalidScheduledAttachmentError();
    }

    const input = value as Record<string, unknown>;
    if ('path' in input) {
        throw new InvalidScheduledAttachmentError('Attachment paths are not accepted; use a storageKey');
    }

    const { storageKey, filename, contentType } = input;
    if (typeof storageKey !== 'string' || !storageKey || storageKey.length > 255
        || storageKey === '.' || storageKey === '..' || path.isAbsolute(storageKey)
        || storageKey.includes('/') || storageKey.includes('\\')) {
        throw new InvalidScheduledAttachmentError('Invalid attachment storageKey');
    }
    if (typeof filename !== 'string' || !filename.trim() || filename.length > 255) {
        throw new InvalidScheduledAttachmentError('Invalid attachment filename');
    }
    if (typeof contentType !== 'string' || !contentType.trim() || contentType.length > 255) {
        throw new InvalidScheduledAttachmentError('Invalid attachment contentType');
    }

    return { storageKey, filename, contentType };
}

export async function resolveScheduledAttachments(
    values: unknown,
    accountId: string,
): Promise<{ references: ScheduledAttachmentReference[]; attachments: ResolvedScheduledAttachment[] }> {
    if (!Array.isArray(values)) {
        throw new InvalidScheduledAttachmentError('Attachments must be an array');
    }
    if (values.length > MAX_SCHEDULED_ATTACHMENTS) {
        throw new InvalidScheduledAttachmentError(`Maximum ${MAX_SCHEDULED_ATTACHMENTS} attachments allowed`);
    }
    if (path.basename(accountId) !== accountId || accountId === '.' || accountId === '..') {
        throw new InvalidScheduledAttachmentError();
    }

    const references = values.map(parseReference);
    if (references.length === 0) return { references, attachments: [] };

    try {
        const attachmentRoot = await fs.realpath(path.join(getUploadsDir(), 'attachments'));
        const expectedAccountDir = path.join(attachmentRoot, accountId);
        const accountDir = await fs.realpath(expectedAccountDir);
        if (accountDir !== expectedAccountDir || !isWithin(attachmentRoot, accountDir)) {
            throw new InvalidScheduledAttachmentError();
        }

        const attachments = await Promise.all(references.map(async reference => {
            const candidate = path.resolve(accountDir, reference.storageKey);
            const canonicalPath = await fs.realpath(candidate);
            if (!isWithin(accountDir, canonicalPath)) {
                throw new InvalidScheduledAttachmentError();
            }

            const stat = await fs.stat(canonicalPath);
            if (!stat.isFile()) throw new InvalidScheduledAttachmentError();
            return { ...reference, path: canonicalPath };
        }));

        return { references, attachments };
    } catch (error) {
        if (error instanceof InvalidScheduledAttachmentError) throw error;
        throw new InvalidScheduledAttachmentError('Attachment does not exist or is not account-owned');
    }
}
