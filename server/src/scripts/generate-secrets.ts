import crypto from 'crypto';

const generateSecret = (length: number = 64) => {
    return crypto.randomBytes(length).toString('hex');
};

console.log(`--- ${process.env.APP_NAME || 'Commerce Platform'} Secret Generator ---`);
console.log('Use these values in your .env file:\n');
console.log(`JWT_SECRET=${generateSecret(32)}`);
console.log(`WEBHOOK_SECRET_FALLBACK=${generateSecret(32)}`);
console.log('\n--- End ---');
