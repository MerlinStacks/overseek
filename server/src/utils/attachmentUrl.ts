/** Encode a stored filename as one URL segment, including markdown delimiters. */
export function getAttachmentUrl(filename: string): string {
    const encoded = encodeURIComponent(filename).replace(/[!'()*]/g,
        character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return `/uploads/attachments/${encoded}`;
}
