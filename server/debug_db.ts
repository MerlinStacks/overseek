import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    try {
        console.log('Connecting to DB...')
        const count = await prisma.account.count()
        console.log('Total Accounts:', count)

        const accounts = await prisma.account.findMany({
            take: 1,
            select: {
                id: true,
                weightUnit: true,
                dimensionUnit: true
            }
        })

        if (accounts.length > 0) {
            console.log('Account[0] found:')
            console.log('  ID:', accounts[0].id)
            console.log('  weightUnit:', accounts[0].weightUnit)
            console.log('  dimensionUnit:', accounts[0].dimensionUnit)
        } else {
            console.log('No accounts found, but query succeeded.')
        }
    } catch (e) {
        console.error('Error querying accounts:', e)
        process.exit(1)
    } finally {
        await prisma.$disconnect()
    }
}

main()
