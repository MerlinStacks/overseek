import { Client } from '@elastic/elasticsearch';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const esClient = new Client({
    node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    tls: { rejectUnauthorized: false } // Dev only
});
