
import { db } from './db/index.js';
import { users, stores, roles, userRoles } from './db/schema.js';
import { hashPassword } from './auth/utils.js';
import { eq } from 'drizzle-orm';

async function seed() {
    console.log('🌱 Seeding database...');

    // 1. Create Default Store
    let storeId: number;
    const existingStore = await db.select().from(stores).limit(1);
    if (existingStore.length > 0) {
        storeId = existingStore[0].id;
        console.log('Store already exists, skipping creation.');
    } else {
        const [newStore] = await db.insert(stores).values({
            url: 'http://localhost:3000',
            settings: { name: 'My Store', status: 'active', domain: 'localhost' }
        }).returning();
        storeId = newStore.id;
        console.log('Created Default Store:', newStore.id);
    }

    // 2. Create Roles
    const rolesList = ['admin', 'manager', 'editor'];
    for (const r of rolesList) {
        const check = await db.select().from(roles).where(eq(roles.name, r));
        if (check.length === 0) {
            await db.insert(roles).values({ name: r });
            console.log(`Created Role: ${r}`);
        }
    }

    // 3. Create Admin User
    const adminEmail = 'admin@example.com';
    const existingUser = await db.select().from(users).where(eq(users.email, adminEmail));

    if (existingUser.length === 0) {
        const passwordHash = await hashPassword('password123'); // Default password
        const [newUser] = await db.insert(users).values({
            email: adminEmail,
            passwordHash: passwordHash,
            fullName: 'Admin User',
            defaultStoreId: storeId
        }).returning();
        console.log('Created Admin User:', newUser.email);

        // Assign Admin Role
        const adminRole = await db.select().from(roles).where(eq(roles.name, 'admin')).limit(1);
        if (adminRole.length > 0) {
            await db.insert(userRoles).values({
                userId: newUser.id,
                roleId: adminRole[0].id
            });
            console.log('Assigned Admin Role');
        }

    } else {
        console.log('Admin user already exists.');
    }

    console.log('✅ Seeding complete.');
    process.exit(0);
}

seed().catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
});
