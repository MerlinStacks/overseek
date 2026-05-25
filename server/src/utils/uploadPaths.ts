import path from 'path';

const DEFAULT_UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

export function getUploadsDir(): string {
    const configuredDir = process.env.UPLOADS_DIR?.trim();
    if (configuredDir) {
        return path.resolve(configuredDir);
    }

    return DEFAULT_UPLOAD_DIR;
}
