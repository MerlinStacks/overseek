import { expect, it } from 'vitest';
import { serviceCodeNaturalLabel, serviceCodeOptionsFromCatalog } from './auspostServiceCatalog';
it('never infers labels from inherited keys or unknown prefixes', () => {
    expect(serviceCodeNaturalLabel(undefined, 'constructor')).toBe('Unknown service constructor');
    expect(serviceCodeNaturalLabel(undefined, '__proto__')).toBe('Unknown service __proto__');
    expect(serviceCodeNaturalLabel(undefined, '7X55')).toBe('Unknown service 7X55');
    expect(serviceCodeNaturalLabel(undefined, '3D55')).toContain('reference only');
});
it('does not invent options and fails malformed/duplicate catalogs closed', () => {
    expect(serviceCodeOptionsFromCatalog(undefined)).toEqual([]);
    expect(serviceCodeOptionsFromCatalog({ services: {} } as any)).toEqual([]);
    const catalog = { services: [{ code: '3D55', label: 'Account supplied name' }] } as any;
    expect(serviceCodeNaturalLabel(catalog, '3D55')).toBe('Account supplied name');
    expect(serviceCodeOptionsFromCatalog(catalog)).toEqual(['3D55']);
    expect(serviceCodeOptionsFromCatalog({ services: [...catalog.services, ...catalog.services] } as any)).toEqual([]);
});
