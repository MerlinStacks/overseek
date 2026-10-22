import { prisma } from '../utils/prisma';
/** Published policy authority is uncached: failed Redis cleanup must not resurrect withdrawn instructions. */
export async function readPublishedPolicies(accountId: string) {
    if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 200) throw new Error('Policy account scope required');
    const rows = await prisma.policy.findMany({ where: { accountId, isPublished: true }, select: { title: true, content: true, type: true }, orderBy: [{ type: 'asc' }, { title: 'asc' }, { id: 'asc' }], take: 201 });
    if (rows.length > 200 || rows.some(row => typeof row.title !== 'string' || typeof row.content !== 'string' || !['POLICY', 'SOP', 'TRAINING'].includes(row.type)) || rows.reduce((total, row) => total + row.title.length + row.content.length, 0) > 200000) throw new Error('Published policy context exceeds safe bounds; review configuration');
    return rows;
}
