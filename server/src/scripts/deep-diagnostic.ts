
import { createPrismaClient } from '../utils/prisma';

const prisma = createPrismaClient();

async function main() {
    try {
        console.log('--- DEEP DIAGNOSTIC FORENSICS ---');
        console.log('Connecting to:', process.env.DATABASE_URL?.replace(/:[^:]+@/, ':***@')); // Hide password

        // 1. List All Tables (Postgres specific)
        const tables: any[] = await prisma.$queryRaw`
      SELECT tablename 
      FROM pg_catalog.pg_tables 
      WHERE schemaname = 'public';
    `;

        console.log(`\nFound ${tables.length} tables in 'public' schema:`);

        // 2. Count rows in each table
        for (const t of tables) {
            const tableName = t.tablename;
            // SQL Injection warning: tableName comes from pg_catalogs, relatively safe here for dev script
            // Prisma raw query doesn't allow dynamic table names easily in tagged template, so we use executeRawUnsafe for diagnostics
            // or we just select count from specific expected tables if we want to be 100% safe.
            // Let's stick to the key ones we care about to avoid complexity:
            try {
                const countResult: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "public"."${tableName}"`);
                const count = countResult[0]?.c?.toString() || countResult[0]?.count?.toString() || '0';
                console.log(` - ${tableName}: ${count} rows`);
            } catch (err) {
                console.log(` - ${tableName}: [Error counting]`);
            }
        }

        console.log('\n--- DATA SAMPLING ---');
        // 3. User Table Dump (Raw)
        try {
            const users: any[] = await prisma.$queryRaw`SELECT * FROM "public"."User" LIMIT 5`;
            console.log(`User Table Sample (${users.length}):`);
            console.dir(users, { depth: null });
        } catch (e) {
            console.log('Could not select from "User" table (maybe lower case "user"?):', (e as any).message.split('\n')[0]);
            // Try lowercase
            try {
                const usersLower: any[] = await prisma.$queryRaw`SELECT * FROM "public"."user" LIMIT 5`;
                console.log(`user (lowercase) Table Sample (${usersLower.length}):`);
                console.dir(usersLower, { depth: null });
            } catch (e2) {
                console.log('Could not select from "user" table either.');
            }
        }

    } catch (e) {
        console.error('Forensics failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
