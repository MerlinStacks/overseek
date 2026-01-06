import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    try {
        console.log('Connecting to DB...')
        // Check connection by counting
        const count = await prisma.wooProduct.count()
        console.log('Total Products:', count)

        // List all columns for WooProduct
        const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'WooProduct';
    `
        console.log('Columns in WooProduct:', columns)
    }
    } catch (e) {
    console.error('CRITICAL ERROR:', e)
} finally {
    await prisma.$disconnect()
}
}

main()
