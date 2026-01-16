
import { esClient } from '../utils/elastic';


async function checkMapping() {
    try {
        console.log('ELASTICSEARCH_URL:', process.env.ELASTICSEARCH_URL);
        const response: any = await esClient.indices.getMapping({ index: 'orders' });

        console.log('Response Keys:', Object.keys(response));

        // v8 might return body directly?
        const body = response.body || response;

        if (body.orders) {
            const props = body.orders.mappings.properties;
            console.log('line_items type:', props.line_items ? props.line_items.type : 'undefined');


            if (props.line_items && props.line_items.type === 'nested') {
                console.log('CONFIRMED: line_items is nested');
                const lineItemsProps = props.line_items as { properties?: { name?: { fields?: { keyword?: unknown } } } };
                const nameProps = lineItemsProps.properties?.name;
                if (nameProps?.fields?.keyword) {
                    console.log('CONFIRMED: line_items.name.keyword Exists!');
                } else {
                    console.log('ISSUE: line_items.name.keyword is MISSING');
                }
            } else {
                console.log('ISSUE: line_items is NOT nested');
            }

        } else {
            console.log('Could not find orders in response body');
            console.log(JSON.stringify(body).substring(0, 200));
        }

    } catch (error: any) {
        console.error('Error fetching mapping:', error.message);
    }
}

checkMapping();

