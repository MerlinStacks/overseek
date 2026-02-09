

import { Logger } from './logger';
import crypto from 'crypto';

interface EnvConfig {

    name: string;

    required: boolean;

    default?: string;
}

const ENV_CONFIG: EnvConfig[] = [
    // Critical - server won't function without these
    { name: 'DATABASE_URL', required: true },
    { name: 'JWT_SECRET', required: true },
    { name: 'REDIS_HOST', required: false, default: 'localhost' },
    { name: 'REDIS_PORT', required: false, default: '6379' },

    // Elasticsearch
    { name: 'ELASTICSEARCH_NODE', required: false, default: 'http://localhost:9200' },

    // Optional integrations
    { name: 'ENCRYPTION_KEY', required: false },
    { name: 'GOLD_API_KEY', required: false },
];


export function validateEnvironment(): void {
    const missing: string[] = [];
    const warnings: string[] = [];

    for (const config of ENV_CONFIG) {
        const value = process.env[config.name];

        if (!value) {
            if (config.required) {
                missing.push(config.name);
            } else if (config.default) {
                process.env[config.name] = config.default;
                warnings.push(`${config.name} not set, using default: ${config.default}`);
            }
        }
    }


    if (warnings.length > 0) {
        Logger.warn('[ENV] Using default values', { variables: warnings });
    }


    if (missing.length > 0) {
        Logger.error('[ENV] Missing required environment variables', { missing });
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    Logger.info('[ENV] Environment validation passed');

    // log JWT fingerprint so multi-container setups can verify they share the same secret
    // (only hashes first 8 chars — safe to log)
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
        const fingerprint = crypto.createHash('sha256').update(jwtSecret.substring(0, 8)).digest('hex').substring(0, 12);


        if (jwtSecret.length < 32 && process.env.NODE_ENV === 'production') {
            Logger.error('[ENV] JWT_SECRET is too short for production (minimum 32 characters)', {
                length: jwtSecret.length,
                fingerprint
            });
            throw new Error('JWT_SECRET must be at least 32 characters in production');
        }


        Logger.info('[ENV] JWT_SECRET fingerprint for multi-container validation', {
            fingerprint,
            length: jwtSecret.length,
            tip: 'All containers must show the same fingerprint to share sessions'
        });
    }

    // in dev mode, swap Docker hostnames to localhost to avoid ENOTFOUND
    if (process.env.NODE_ENV === 'development') {
        if (process.env.REDIS_HOST === 'redis') {
            Logger.warn('[ENV] REDIS_HOST is "redis" but running in development. Forcing to "localhost".');
            process.env.REDIS_HOST = 'localhost';
        }

        if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@postgres:')) {
            Logger.warn('[ENV] DATABASE_URL points to "postgres" container but running in development. Replacing with "localhost".');
            process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:', '@localhost:');
        }
    }
}


export function getEnv(name: string, fallback?: string): string {
    return process.env[name] || fallback || '';
}


export function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}
