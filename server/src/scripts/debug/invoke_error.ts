
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'supersecretkey';


import * as fs from 'fs';

async function log(msg: string) {
    console.log(msg);
    fs.appendFileSync('invoke_log.txt', msg + '\n');
}

async function main() {
    const fakeUserId = '28cbe786-f3c8-4b98-bb20-f6f35b8be0e1';
    const token = jwt.sign({ userId: fakeUserId }, JWT_SECRET, { expiresIn: '1h' });

    await log(`Testing with Token: ${token.substring(0, 20)}...`);
    await log('Sending request to http://localhost:3000/api/accounts');

    try {
        const res = await fetch('http://localhost:3000/api/accounts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: "Test Store",
                domain: "https://test.com",
                wooUrl: "https://test.com",
                wooConsumerKey: "key",
                wooConsumerSecret: "secret"
            })
        });

        const text = await res.text();
        await log(`Status: ${res.status}`);
        await log(`Body: ${text}`);

    } catch (e: any) {
        await log(`Fetch error: ${e.message}`);
    }
}


main();
