import { requiredAccountId, runScript, withScriptPrisma } from './scriptUtils';

/** Inspect a deterministic account-scoped review without printing customer content or identity. */
export async function main(args = process.argv.slice(2)) {
    const accountId = requiredAccountId(args);
    await withScriptPrisma(async prisma => {
        const review = await prisma.wooReview.findFirst({
            where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, rawData: true }
        });
        if (!review) { console.log('No reviews found for this account.'); return; }
        const raw = review.rawData;
        const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
        console.log('Review ID:', review.id);
        console.log('Review Raw Data Keys:', data ? Object.keys(data) : []);
        console.log('Reviewer email present:', Boolean(data && typeof data.reviewer_email === 'string' && data.reviewer_email));
        console.log('Raw values omitted to protect reviewer data.');
    });
}

if (require.main === module) void runScript(main);
