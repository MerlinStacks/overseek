import path from 'path';

const GENERATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function privateUploadsRoot(): string {
    return path.resolve(process.env.PRIVATE_UPLOADS_DIR || path.join(__dirname, '..', '..', '..', 'storage', 'private'));
}

export function generationPdfPath(generationId: string, temporary = false, root = privateUploadsRoot()): string {
    if (!GENERATED_ID.test(generationId)) throw new Error('Invalid generated file identifier');
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, 'wholesale-catalogs', generationId, temporary ? 'master.tmp.pdf' : 'master.pdf');
    if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('Private file path escapes storage root');
    }
    return target;
}

export function assertPrivateGenerationPath(filePath: string, root = privateUploadsRoot()): string {
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(filePath);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Private file path escapes storage root');
    return target;
}

export function shareArtifactPaths(shareId: string, temporary = false, root = privateUploadsRoot()) {
    if (!GENERATED_ID.test(shareId)) throw new Error('Invalid generated file identifier');
    const resolvedRoot = path.resolve(root);
    const directory = path.resolve(resolvedRoot, 'wholesale-catalog-shares', `${shareId}${temporary ? '.tmp' : ''}`);
    if (!directory.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Private file path escapes storage root');
    return { directory, pdf: path.join(directory, 'catalog.pdf'), pages: path.join(directory, 'pages'), thumbnails: path.join(directory, 'thumbnails') };
}

export function assertPrivateSharePath(filePath: string, shareId: string, root = privateUploadsRoot()): string {
    const base = shareArtifactPaths(shareId, false, root).directory;
    const target = path.resolve(filePath);
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('Private share path escapes storage root');
    return target;
}

function revisionDirectory(kind: 'wholesale-catalogs' | 'wholesale-catalog-shares', id: string, revision: number, temporary: boolean, root: string) {
    if (!GENERATED_ID.test(id) || !Number.isInteger(revision) || revision < 1) throw new Error('Invalid validity artifact identifier');
    const resolvedRoot = path.resolve(root);
    const directory = path.resolve(resolvedRoot, kind, id, `validity-r${revision}${temporary ? '.tmp' : ''}`);
    if (!directory.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Private file path escapes storage root');
    return directory;
}

export function generationValidityArtifactPaths(generationId: string, revision: number, temporary = false, root = privateUploadsRoot()) {
    const directory = revisionDirectory('wholesale-catalogs', generationId, revision, temporary, root);
    return { directory, pdf: path.join(directory, 'master.pdf') };
}

export function shareValidityArtifactPaths(shareId: string, revision: number, temporary = false, root = privateUploadsRoot()) {
    const directory = revisionDirectory('wholesale-catalog-shares', shareId, revision, temporary, root);
    return { directory, pdf: path.join(directory, 'catalog.pdf'), pages: path.join(directory, 'pages'), thumbnails: path.join(directory, 'thumbnails') };
}
