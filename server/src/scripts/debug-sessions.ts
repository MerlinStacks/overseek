
import 'dotenv/config';
import { prisma } from '../utils/prisma';

async function main() {
    console.log('--- Debugging Analytics Sessions ---');
    console.log(`Current Server Time: ${new Date().toISOString()}`);

    // 1. Check for most recent sessions
    const recentSessions = await prisma.analyticsSession.findMany({
        orderBy: { lastActiveAt: 'desc' },
        take: 5,
        select: {
            id: true,
            visitorId: true,
            lastActiveAt: true,
            userAgent: true,
            currentPath: true
        }
    });

    console.log('\nTop 5 Most Recent Sessions:');
    if (recentSessions.length === 0) {
        console.log('No sessions found.');
    } else {
        recentSessions.forEach(s => {
            const timeDiff = (Date.now() - new Date(s.lastActiveAt).getTime()) / 1000;
            console.log(`[${s.id}] Visitor: ${s.visitorId}`);
            console.log(`   Last Active: ${s.lastActiveAt.toISOString()} (${timeDiff.toFixed(1)}s ago)`);
            console.log(`   Path: ${s.currentPath}`);
            console.log(`   UA: ${s.userAgent ? s.userAgent.substring(0, 50) + '...' : 'N/A'}`);
            console.log('---');
        });
    }

    // 2. Check for "Live" sessions (active in last 5 mins)
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const liveCount = await prisma.analyticsSession.count({
        where: {
            lastActiveAt: { gte: fiveMinsAgo }
        }
    });

    console.log(`\nLive Sessions (last 5 mins): ${liveCount}`);

    // 3. Test Insert (Optional - uncomment to test write)
    /*
    console.log('\nAttempting Test Session Insert...');
    try {
        const testSession = await prisma.analyticsSession.create({
            data: {
                accountId: 'test-account-id', // REPLACE WITH REAL ID IF NEEDED
                visitorId: 'debug-visitor-' + Date.now(),
                lastActiveAt: new Date(),
                currentPath: '/debug-test',
                userAgent: 'DebugScript/1.0'
            }
        });
        console.log(`Test session created: ${testSession.id}`);
    } catch (e) {
        console.error('Failed to create test session:', e);
    }
    */
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
