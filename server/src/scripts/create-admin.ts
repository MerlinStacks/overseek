
import { createPrismaClient } from '../utils/prisma';
import * as argon2 from 'argon2';
import crypto from 'crypto';

const prisma = createPrismaClient();

// Argon2id with OWASP recommended settings
const ARGON2_OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1
};

async function main() {
    const email = process.env.ADMIN_EMAIL || 'admin@localhost';
    // Use env variable or generate secure random password
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
    const fullName = 'System Admin';

    console.log(`Creating user: ${email}`);

    // 1. Hash Password with Argon2id
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    // 2. Create User
    try {
        const user = await prisma.user.upsert({
            where: { email },
            update: { passwordHash }, // Reset password if exists
            create: {
                email,
                passwordHash,
                fullName,
                isSuperAdmin: true
            }
        });

        console.log('User created/updated successfully!');
        console.log('---------------------------------------------------');
        console.log(`Email:    ${email}`);
        console.log(`Password: ${password}`);
        console.log('---------------------------------------------------');
        console.log('ID:', user.id);

    } catch (e) {
        console.error('Failed to create user:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
