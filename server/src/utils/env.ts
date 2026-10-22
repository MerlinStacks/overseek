import { Logger } from './logger';
import { z } from 'zod';
const nonblank = z.string().min(1).refine(value => value === value.trim() && ![...value].some(char => char.charCodeAt(0) < 32));
const defaults = { REDIS_HOST: 'localhost', REDIS_PORT: '6379', ELASTICSEARCH_NODE: 'http://localhost:9200' };
/** Pure parser. Never rewrites a supplied destination or includes secret values in errors. */
export function parseEnvironment(input: NodeJS.ProcessEnv): Record<string, string> {
    const env: NodeJS.ProcessEnv = { ...defaults, ...input }; const invalid: string[] = [];
    const check = (key: string, test: (value: string) => boolean) => { const value = env[key]; if (typeof value !== 'string' || !nonblank.safeParse(value).success || !test(value)) invalid.push(key); };
    const url = (value: string, protocols: string[]) => { try { const parsed = new URL(value); return protocols.includes(parsed.protocol) && !!parsed.hostname && !parsed.hash; } catch { return false; } };
    if (env.NODE_ENV !== undefined) check('NODE_ENV', value => ['development', 'test', 'production'].includes(value));
    check('DATABASE_URL', value => url(value, ['postgresql:', 'postgres:']));
    check('JWT_SECRET', value => env.NODE_ENV !== 'production' || value.length >= 32);
    check('REDIS_HOST', value => /^[a-zA-Z0-9._:[\]-]+$/.test(value));
    check('REDIS_PORT', value => /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535);
    check('ELASTICSEARCH_NODE', value => url(value, ['http:', 'https:']));
    // Encryption uses ENCRYPTION_KEY || JWT_SECRET; do not silently change deployed key material.
    if (env.ENCRYPTION_KEY !== undefined) check('ENCRYPTION_KEY', value => env.NODE_ENV !== 'production' || value.length >= 32);
    if (invalid.length) throw new Error(`Invalid environment variables: ${invalid.join(', ')}`);
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
export function validateEnvironment(): void {
    const parsed = parseEnvironment(process.env);
    for (const key of Object.keys(defaults)) if (process.env[key] === undefined) process.env[key] = parsed[key];
    Logger.info('[ENV] Environment validation passed');
}
export function getEnv(name: string, fallback?: string): string { return process.env[name] ?? fallback ?? ''; }
export function isProduction(): boolean { return process.env.NODE_ENV === 'production'; }
