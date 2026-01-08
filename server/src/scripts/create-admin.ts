
import { createPrismaClient } from '../utils/prisma';
import { hash, genSalt } from 'bcryptjs';
import crypto from 'crypto';

const prisma = createPrismaClient();

async function main() {
    const email = process.env.ADMIN_EMAIL || 'admin@overseek.com';
    // Use env variable or generate secure random password
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
    const fullName = 'System Admin';

    console.log(`Creating user: ${email}`);

    // 1. Hash Password
    const salt = await genSalt(10);
    const passwordHash = await hash(password, salt);

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
