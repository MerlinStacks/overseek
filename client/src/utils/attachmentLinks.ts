/**
 * Older inbox messages store raw filenames in one markdown link per line.
 * Encode the filename before parsing markdown so parentheses remain part of
 * the download path rather than being treated as the end of the link.
 */
export function normalizeAttachmentLinks(content: string): string {
    return content.replace(
        /^\[([^\]\r\n]+)\]\((\/uploads\/attachments\/)([^\r\n]+)\)(?=\r?$)/gm,
        (_match, label: string, prefix: string, filename: string) => {
            let decoded = filename;
            try {
                decoded = decodeURIComponent(filename);
            } catch {
                // Legacy filenames may contain a literal percent sign.
            }
            const encoded = encodeURIComponent(decoded).replace(/[!'()*]/g,
                character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
            return `[${label}](${prefix}${encoded})`;
        }
    );
}
