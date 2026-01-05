
import { PrismaClient, EmailAccount } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as imaps from 'imap-simple';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from './events';


export class EmailService {

    // -------------------
    // Sending (SMTP)
    // -------------------

    async createTransporter(account: EmailAccount) {
        return nodemailer.createTransport({
            host: account.host,
            port: account.port,
            secure: account.isSecure, // true for 465, false for other ports
            auth: {
                user: account.username,
                pass: account.password,
            },
        });
    }

    async sendEmail(accountId: string, emailAccountId: string, to: string, subject: string, html: string, attachments?: any[]) {
        const emailAccount = await prisma.emailAccount.findFirst({
            where: { id: emailAccountId, accountId }
        });

        if (!emailAccount) throw new Error("Email account not found");

        const transporter = await this.createTransporter(emailAccount);

        const info = await transporter.sendMail({
            from: `"${emailAccount.name}" <${emailAccount.email}>`,
            to,
            subject,
            html,
            attachments
        });

        console.log(`[EmailService] Sent email: ${info.messageId}`);
        return info;
    }

    async verifyConnection(account: EmailAccount): Promise<boolean> {
        if (account.type === 'SMTP') {
            try {
                const transporter = await this.createTransporter(account);
                await transporter.verify();
                return true;
            } catch (error) {
                console.error("[EmailService] SMTP Verify Error:", error);
                throw error;
            }
        } else if (account.type === 'IMAP') {
            try {
                const config = {
                    imap: {
                        user: account.username,
                        password: account.password,
                        host: account.host,
                        port: account.port,
                        tls: account.isSecure,
                        authTimeout: 3000
                    }
                };
                const connection = await imaps.connect(config);
                await connection.end();
                return true;
            } catch (error) {
                console.error("[EmailService] IMAP Verify Error:", error);
                throw error;
            }
        }
        return false;
    }

    // -------------------
    // Receiving (IMAP)
    // -------------------

    async checkEmails(emailAccountId: string) {
        // Basic implementation to fetch unseen emails
        const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
        if (!account || account.type !== 'IMAP') return;

        const config = {
            imap: {
                user: account.username,
                password: account.password,
                host: account.host,
                port: account.port,
                tls: account.isSecure,
                authTimeout: 3000
            }
        };

        try {
            const connection = await imaps.connect(config);
            await connection.openBox('INBOX');

            // Fetch unseen emails
            const searchCriteria = ['UNSEEN'];
            const fetchOptions = {
                bodies: ['HEADER', 'TEXT'],
                markSeen: true
            };

            const messages = await connection.search(searchCriteria, fetchOptions);

            for (const message of messages) {
                const parts = (imaps as any).getParts(message.attributes.struct);

                const subject = message.parts.find(p => p.which === 'HEADER')?.body.subject?.[0] || '(No Subject)';
                const fromLine = message.parts.find(p => p.which === 'HEADER')?.body.from?.[0] || '';
                const messageId = message.parts.find(p => p.which === 'HEADER')?.body['message-id']?.[0] || `local-${Date.now()}`;

                // Parse "Name <email@domain.com>"
                // Simple regex or nodemailer/addressparser? simple split for now
                let fromEmail = fromLine;
                let fromName = '';
                if (fromLine.includes('<')) {
                    const match = fromLine.match(/(.*)<(.*)>/);
                    if (match) {
                        fromName = match[1].trim().replace(/^"|"$/g, '');
                        fromEmail = match[2].trim();
                    }
                }

                // Get Body (Text or HTML)
                // imap-simple bodies fetch: ['HEADER', 'TEXT'] gave us the raw parts. 
                // We need to parse multipart. This is complex without a parser like 'mailparser'.
                // For MVP, assuming text/plain exists or we take the first part logic.
                // Actually 'TEXT' fetch option in imap-simple fetches the body content.
                const bodyPart = message.parts.find(p => p.which === 'TEXT');
                const body = bodyPart ? bodyPart.body : '[Content cannot be displayed]';

                console.log(`[EmailService] Received email from ${fromEmail}: ${subject}`);

                EventBus.emit(EVENTS.EMAIL.RECEIVED, {
                    emailAccountId,
                    fromEmail,
                    fromName,
                    subject,
                    body,
                    messageId
                });
            }

            connection.end();
        } catch (error) {
            console.error(`[EmailService] Error checking emails for ${account.email}:`, error);
        }
    }
}
