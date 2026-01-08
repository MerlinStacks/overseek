
import 'dotenv/config';
import { createPrismaClient } from '../../utils/prisma';

const prisma = createPrismaClient();

async function main() {
    const fakeUserId = '28cbe786-f3c8-4b98-bb20-f6f35b8be0e1'; // usage of the specific ID from the log

    console.log(`Checking user ${fakeUserId}...`);
    const user = await prisma.user.findUnique({ where: { id: fakeUserId } });

    console.log('User found?', !!user);

    if (!user) {
        console.log('User not found. Simulating race condition or logic failure by attempting create anyway...');
        try {
            await prisma.account.create({
                data: {
                    name: 'Test Account',
                    domain: 'test.com',
                    wooUrl: 'https://test.com',
                    wooConsumerKey: 'key',
                    wooConsumerSecret: 'secret',
                    users: {
                        create: {
                            userId: fakeUserId,
                            role: 'OWNER'
                        }
                    }
                }
            });
        } catch (e: any) {
            console.log('Caught expected error:');
            console.log(e);
        }
    } else {
        console.log('User actually exists! This repro requires the user to NOT exist.');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
