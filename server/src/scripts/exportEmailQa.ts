/** Offline only: no credentials, database queries or network transports. */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import nodemailer from 'nodemailer';
import { compileEmailDesignV2, createDefaultEmailDesignV2 } from '@overseek/core';
import { prepareEmail } from '../services/EmailPreparation';
import { EMAIL_PREVIEW_SCENARIOS, applyEmailPreviewScenario } from '../services/EmailPreviewScenarios';
import { resolveMergeTags, applyPreviewText } from '../services/MergeTagResolver';

async function main() {
    const output = path.resolve(process.argv[2] || 'email-qa-output');
    await mkdir(output, { recursive: true });
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    const manifest: object[] = [];
    try {
        for (const scenario of EMAIL_PREVIEW_SCENARIOS) {
            const design = createDefaultEmailDesignV2({ title: `Email QA · ${scenario}`, previewText: 'Synthetic inbox validation, not a customer message' });
            design.document.sections[1].columns[0].blocks = [
                { id: 'greeting', type: 'text', props: { html: '<h2>Hello {{customer.firstName}}</h2><p>Unicode café 👋 and a long wrapping headline for mailbox QA.</p>' } },
                { id: 'summary', type: 'orderSummary', props: {} },
                { id: 'cart', type: 'cartItems', props: {} },
                { id: 'cta', type: 'button', props: { label: 'View sample store', href: '{{store_url}}/products?a=1&b=2' } },
            ];
            const context = applyEmailPreviewScenario({
                storeUrl: 'https://example.invalid', customer: { firstName: 'Alex', lastName: 'Sample', email: 'qa@example.invalid' },
                order: { number: 'QA-1', total: '40.00', currency: 'AUD', lineItems: [{ name: 'Sample product', quantity: 2, total: '40.00', price: '20.00' }] },
                cart: { items: [{ name: 'Sample product', quantity: 2, price: '20.00', total: '40.00' }], total: '40.00', currency: 'AUD' },
            }, scenario);
            const html = applyPreviewText(resolveMergeTags(compileEmailDesignV2(design), context), design.document.meta.previewText || '');
            const prepared = prepareEmail({ html, subject: design.document.meta.title, trackingId: `offline-${scenario}`, apiUrl: 'https://example.invalid', category: 'MARKETING' });
            const message = await transport.sendMail({ from: 'QA Store <store@example.invalid>', to: 'QA Inbox <qa@example.invalid>', subject: prepared.subject, html: prepared.html, text: prepared.text, headers: prepared.headers });
            for (const [extension, data] of [['eml', message.message as Buffer], ['html', prepared.html], ['txt', prepared.text], ['json', JSON.stringify(prepared, null, 2)]] as const) {
                await writeFile(path.join(output, `${scenario}.${extension}`), data);
            }
            manifest.push({ scenario, hash: prepared.hash, rendererVersion: prepared.rendererVersion, assets: prepared.assets, files: [`${scenario}.eml`, `${scenario}.html`, `${scenario}.txt`, `${scenario}.json`], inboxChecks: { gmail: 'NOT_RUN', outlook: 'NOT_RUN', appleMail: 'NOT_RUN' } });
        }
        await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), synthetic: true, sent: false, fixtures: manifest }, null, 2));
        console.log(`Offline email QA pack exported to ${output}; no messages sent.`);
    } finally { transport.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
