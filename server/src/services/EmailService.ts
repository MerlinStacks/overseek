
import { PrismaClient, EmailAccount } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as imaps from 'imap-simple';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from './events';
import { Logger } from '../utils/logger';
import { decrypt } from '../utils/encryption';


export class EmailService {

    // -------------------
    // Sending (SMTP)
    // -------------------

    async createTransporter(account: EmailAccount) {
        // Port 465 uses implicit TLS, port 587 uses STARTTLS
        const useImplicitTLS = account.port === 465;

        return nodemailer.createTransport({
            host: account.host,
            port: account.port,
            secure: useImplicitTLS, // true for 465 only
            requireTLS: !useImplicitTLS && account.isSecure, // Force STARTTLS for 587 when secure is wanted
            auth: {
                user: account.username,
                pass: account.password,
            },
            tls: {
                // Allow connections to servers with mismatched certificates
                // (common with shared hosting like cPanel)
                rejectUnauthorized: false,
                servername: account.host
            }
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

        Logger.info(`Sent email`, { messageId: info.messageId, to });
        return info;
    }

    async verifyConnection(account: EmailAccount): Promise<boolean> {
        if (account.type === 'SMTP') {
            try {
                const transporter = await this.createTransporter(account);
                await transporter.verify();
                return true;
            } catch (error) {
                Logger.error('SMTP Verify Error', { error });
                throw error;
            }
        } else if (account.type === 'IMAP') {
            try {
                // Port 993 uses implicit TLS (connection is encrypted from start)
                // Port 143 uses STARTTLS (connection starts plain, then upgrades)
                const useImplicitTLS = account.port === 993;

                const config = {
                    imap: {
                        user: account.username,
                        password: account.password,
                        host: account.host,
                        port: account.port,
                        tls: useImplicitTLS, // Only true for port 993
                        autotls: useImplicitTLS ? 'never' : 'required', // STARTTLS for other ports
                        authTimeout: 10000,
                        tlsOptions: {
                            rejectUnauthorized: false, // Allow self-signed certs
                            servername: account.host // Required for SNI
                        }
                    }
                };
                const connection = await imaps.connect(config);
                await connection.end();
                return true;
            } catch (error) {
                Logger.error('IMAP Verify Error', { error });
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
        if (!account) {
            Logger.warn('[checkEmails] Email account not found', { emailAccountId });
            return;
        }
        if (account.type !== 'IMAP') {
            Logger.warn('[checkEmails] Account is not IMAP type, skipping', { emailAccountId, type: account.type });
            return;
        }

        // Port 993 uses implicit TLS, port 143 uses STARTTLS
        const useImplicitTLS = account.port === 993;

        // Decrypt the stored password
        let decryptedPassword: string;
        try {
            decryptedPassword = decrypt(account.password);
        } catch (e) {
            Logger.error('[checkEmails] Failed to decrypt email password', { emailAccountId, error: e });
            return;
        }

        const config = {
            imap: {
                user: account.username,
                password: decryptedPassword,
                host: account.host,
                port: account.port,
                tls: useImplicitTLS,
                autotls: useImplicitTLS ? 'never' : 'required',
                authTimeout: 10000,
                tlsOptions: {
                    rejectUnauthorized: false,
                    servername: account.host
                }
            }
        };

        try {
            Logger.info('[checkEmails] Connecting to IMAP server', { host: account.host, port: account.port });
            const connection = await imaps.connect(config);
            await connection.openBox('INBOX');
            Logger.info('[checkEmails] Connected and opened INBOX');

            // Fetch unseen emails
            const searchCriteria = ['UNSEEN'];
            const fetchOptions = {
                bodies: ['HEADER', 'TEXT'],
                markSeen: true
            };

            const messages = await connection.search(searchCriteria, fetchOptions);
            Logger.info(`[checkEmails] Found ${messages.length} unseen email(s)`, { email: account.email });

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

                Logger.info(`[checkEmails] Emitting EMAIL.RECEIVED event`, { fromEmail, subject });

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
            Logger.info('[checkEmails] Disconnected from IMAP server');
        } catch (error) {
            Logger.error(`[checkEmails] Error checking emails`, { email: account.email, error });
        }
    }
}
