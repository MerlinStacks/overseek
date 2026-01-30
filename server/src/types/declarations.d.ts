/**
 * Global type declarations for modules without proper types.
 */

// Ensure this file is treated as a module
export { };

declare module '@socket.io/redis-adapter' {
    import { Redis } from 'ioredis';
    export function createAdapter(pubClient: Redis, subClient: Redis): any;
}
