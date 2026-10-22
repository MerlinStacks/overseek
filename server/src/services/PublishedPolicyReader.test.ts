import { expect, it, vi } from 'vitest';
const findMany = vi.hoisted(() => vi.fn());
vi.mock('../utils/prisma', () => ({ prisma: { policy: { findMany } } }));
import { readPublishedPolicies } from './PublishedPolicyReader';
it('loads current published account policies without trusting a stale cache', async () => { findMany.mockResolvedValueOnce([{ title: 'Current', content: 'Text', type: 'POLICY' }]).mockResolvedValueOnce([]); expect(await readPublishedPolicies('a')).toHaveLength(1); expect(await readPublishedPolicies('a')).toEqual([]); expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', isPublished: true }, take: 201 })); });
it('fails closed instead of silently omitting policies beyond the context limit', async () => { findMany.mockResolvedValue(Array.from({ length: 201 }, () => ({ title: 'Policy', content: '', type: 'POLICY' }))); await expect(readPublishedPolicies('a')).rejects.toThrow(/bounds/); });
