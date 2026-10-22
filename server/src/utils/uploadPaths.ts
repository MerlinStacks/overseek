import path from 'path';

const DEFAULT_UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

export function getUploadsDir(): string {
    return configuredRoot('UPLOADS_DIR', DEFAULT_UPLOAD_DIR);
}

function configuredRoot(key: string, fallback: string): string {
    const value = process.env[key];
    if (value === undefined) return fallback;
    if (!value.trim() || !path.isAbsolute(value.trim())) throw new Error(`${key} must be an explicit absolute storage path`);
    return path.resolve(value.trim());
}

/** Legacy root remains private for existing invoice/attachment recovery. Never
 * mount it statically. New intentionally published artifacts use this root. */
export function getPublicUploadsDir(): string {
    const root = configuredRoot('PUBLIC_UPLOADS_DIR', path.join(getUploadsDir(), 'public'));
    const privateRoot = getUploadsDir();
    if (root === privateRoot || privateRoot.startsWith(`${root}${path.sep}`)) throw new Error('Public uploads must not contain the private upload root');
    return root;
}
