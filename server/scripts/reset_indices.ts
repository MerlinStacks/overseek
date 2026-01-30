import { esClient } from '../src/utils/elastic';

async function resetIndices() {
    const indices = ['products', 'customers', 'orders', 'reviews', 'ad_spend'];
    
    for (const index of indices) {
        try {
            const exists = await esClient.indices.exists({ index });
            if (exists) {
                await esClient.indices.delete({ index });
                console.log(`Deleted index: ${index}`);
            } else {
                console.log(`Index not found: ${index}`);
            }
        } catch (error) {
            console.error(`Failed to delete index ${index}:`, error);
        }
    }
    
    console.log('Indices reset complete. Restart the server to recreate them with new mappings.');
    process.exit(0);
}

resetIndices();
