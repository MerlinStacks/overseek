/** Generate initial Web Push keys. Never rotate or overwrite an existing key pair. */
import webpush from 'web-push';
import { runScript, withScriptPrisma } from './scriptUtils';

export async function main() {
    await withScriptPrisma(async prisma => {
        const existing = await prisma.platformCredentials.findUnique({
            where: { platform: 'WEB_PUSH_VAPID' }, select: { id: true }
        });
        if (existing) {
            console.log('VAPID credentials already exist; no changes made. Use the supported credential-management flow for rotation.');
            return;
        }
        const keys = webpush.generateVAPIDKeys();
        // A unique platform constraint prevents concurrent runs from overwriting each other.
        await prisma.platformCredentials.create({ data: {
            platform: 'WEB_PUSH_VAPID',
            credentials: { publicKey: keys.publicKey, privateKey: keys.privateKey },
            notes: `Generated on ${new Date().toISOString()}`,
        } });
        console.log('VAPID credentials stored. Verify the remaining push configuration and browser permissions before testing delivery.');
    });
}

if (require.main === module) void runScript(main);
