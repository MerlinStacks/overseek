import { expect, it } from 'vitest';
import { AUSPOST_SERVICE_CATALOG, listAusPostServiceCatalog } from './AusPostServiceCatalog';
it('keeps reference revision and immutable process state independent of returned snapshots', () => {
    expect(Object.isFrozen(AUSPOST_SERVICE_CATALOG)).toBe(true);
    expect(Object.isFrozen(AUSPOST_SERVICE_CATALOG[0])).toBe(true);
    const first = listAusPostServiceCatalog(); first.services[0].label = 'Changed';
    expect(listAusPostServiceCatalog().services[0].label).toBe('Parcel Post');
    expect(first).toMatchObject({ updatedAt: '2026-05-22', source: 'static-reference', eligibility: 'not-established' });
});
