/**
 * Generate VAPID Keys for Web Push Notifications
 * 
 * Usage: npx ts-node src/scripts/generate-vapid-keys.ts
 * 
 * This script generates new VAPID key pairs and stores them in the PlatformCredentials table.
 * VAPID keys are required for sending Web Push notifications.
 */

import webpush from 'web-push';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generateVapidKeys() {
    console.log('🔐 Generating VAPID keys for Web Push notifications...\n');

    // Check if keys already exist
    const existing = await prisma.platformCredentials.findUnique({
        where: { platform: 'WEB_PUSH_VAPID' }
    });

    if (existing) {
        console.log('⚠️  VAPID keys already exist in database.');
        console.log('   Public Key:', (existing.credentials as { publicKey: string }).publicKey?.substring(0, 30) + '...');
        console.log('\n   To regenerate, delete the existing WEB_PUSH_VAPID entry first.');
        await prisma.$disconnect();
        return;
    }

    // Generate new VAPID key pair
    const vapidKeys = webpush.generateVAPIDKeys();

    console.log('✅ Generated new VAPID key pair:\n');
    console.log('   Public Key:', vapidKeys.publicKey.substring(0, 30) + '...');
    console.log('   Private Key:', vapidKeys.privateKey.substring(0, 10) + '... [hidden]');

    // Store in database
    await prisma.platformCredentials.create({
        data: {
            platform: 'WEB_PUSH_VAPID',
            credentials: {
                publicKey: vapidKeys.publicKey,
                privateKey: vapidKeys.privateKey
            },
            notes: `Generated on ${new Date().toISOString()}`
        }
    });

    console.log('\n✅ VAPID keys stored in PlatformCredentials table.');
    console.log('\n📱 Push notifications are now ready to use!');
    console.log('   Users need to enable notifications in their browser settings.');

    await prisma.$disconnect();
}

generateVapidKeys().catch((error) => {
    console.error('❌ Failed to generate VAPID keys:', error);
    prisma.$disconnect();
    process.exit(1);
});
