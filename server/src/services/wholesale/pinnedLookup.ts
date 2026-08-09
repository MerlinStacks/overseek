/**
 * Keep outbound requests pinned to the address that passed SSRF validation.
 * Modern Node may request all lookup results for automatic family selection,
 * while older versions expect the legacy address/family callback shape.
 */
export function createPinnedLookup(address: string, family: number) {
    return (_hostname: string, options: unknown, callback?: (...args: any[]) => void) => {
        const done = typeof options === 'function' ? options as (...args: any[]) => void : callback;
        if (!done) throw new Error('DNS lookup callback is required');

        if (options && typeof options === 'object' && 'all' in options && (options as { all?: boolean }).all) {
            done(null, [{ address, family }]);
            return;
        }

        done(null, address, family);
    };
}
