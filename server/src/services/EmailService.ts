
import { PrismaClient, EmailAccount } from '@prisma/client';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
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

    async sendEmail(
        accountId: string,
        emailAccountId: string,
        to: string,
        subject: string,
        html: string,
        attachments?: any[],
        options?: { source?: string; sourceId?: string }
    ) {
        const emailAccount = await prisma.emailAccount.findFirst({
            where: { id: emailAccountId, accountId }
        });

        if (!emailAccount) {
            // Log failure for missing account
            await prisma.emailLog.create({
                data: {
                    accountId,
                    emailAccountId,
                    to,
                    subject,
                    status: 'FAILED',
                    errorMessage: 'Email account not found',
                    source: options?.source,
                    sourceId: options?.sourceId
                }
            });
            throw new Error("Email account not found");
        }

        try {
            const transporter = await this.createTransporter(emailAccount);

            const info = await transporter.sendMail({
                from: `"${emailAccount.name}" <${emailAccount.email}>`,
                to,
                subject,
                html,
                attachments
            });

            // Log success
            await prisma.emailLog.create({
                data: {
                    accountId,
                    emailAccountId,
                    to,
                    subject,
                    status: 'SUCCESS',
                    messageId: info.messageId,
                    source: options?.source,
                    sourceId: options?.sourceId
                }
            });

            Logger.info(`Sent email`, { messageId: info.messageId, to });
            return info;
        } catch (error: any) {
            // Log failure
            await prisma.emailLog.create({
                data: {
                    accountId,
                    emailAccountId,
                    to,
                    subject,
                    status: 'FAILED',
                    errorMessage: error.message,
                    errorCode: error.code || error.responseCode,
                    source: options?.source,
                    sourceId: options?.sourceId
                }
            });

            Logger.error(`Failed to send email`, { to, error: error.message });
            throw error; // Re-throw so callers can handle
        }
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

                const client = new ImapFlow({
                    host: account.host,
                    port: account.port,
                    secure: useImplicitTLS,
                    auth: {
                        user: account.username,
                        pass: account.password
                    },
                    logger: false,
                    tls: {
                        rejectUnauthorized: false,
                    } as any
                });

                await client.connect();
                await client.logout();
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

        const client = new ImapFlow({
            host: account.host,
            port: account.port,
            secure: useImplicitTLS,
            auth: {
                user: account.username,
                pass: decryptedPassword
            },
            logger: false,
            tls: {
                rejectUnauthorized: false,
            } as any
        });

        try {
            Logger.info('[checkEmails] Connecting to IMAP server', { host: account.host, port: account.port });
            await client.connect();

            // Get mailbox lock for safe concurrent access
            const lock = await client.getMailboxLock('INBOX');
            Logger.info('[checkEmails] Connected and locked INBOX');

            let messageCount = 0;

            try {
                // Fetch unseen messages using async iterator
                // We need 'source' to parse the full email
                for await (const message of client.fetch({ seen: false }, {
                    envelope: true,
                    bodyStructure: true,
                    source: true
                })) {
                    messageCount++;
                    try {
                        const source = message.source;
                        if (!source) {
                            Logger.warn('[checkEmails] Message has no source', { uid: message.uid });
                            continue;
                        }

                        // Parse the email using mailparser
                        const parsed: ParsedMail = await simpleParser(source, { skipImageLinks: true });

                        const subject = parsed.subject || '(No Subject)';
                        const fromAddress = parsed.from?.value[0];
                        const fromEmail = fromAddress?.address || '';
                        const fromName = fromAddress?.name || '';
                        // Use parsed messageId, fallback to envelope, fallback to generated
                        const messageId = parsed.messageId || message.envelope.messageId || `local-${Date.now()}`;
                        const inReplyTo = parsed.inReplyTo || message.envelope.inReplyTo || undefined;

                        // Handle references (can be string or array)
                        let references: string | undefined;
                        if (typeof parsed.references === 'string') {
                            references = parsed.references;
                        } else if (Array.isArray(parsed.references)) {
                            references = parsed.references.join(' ');
                        }

                        // Get HTML or Text body
                        let html = parsed.html || false;
                        const text = parsed.text || '';

                        // Process inline images (cid:) -> Base64
                        if (html && parsed.attachments && parsed.attachments.length > 0) {
                            for (const attachment of parsed.attachments) {
                                if (attachment.contentId && attachment.content && attachment.contentType) {
                                    const cid = attachment.contentId.replace(/^<|>$/g, ''); // Remove < > wrappers
                                    const base64 = attachment.content.toString('base64');
                                    const dataUri = `data:${attachment.contentType};base64,${base64}`;

                                    // Replace cid: CID with data URI globally
                                    const regex = new RegExp(`cid:${cid}`, 'g');
                                    html = html.replace(regex, dataUri);
                                }
                            }
                        }

                        Logger.info(`[checkEmails] Processing email`, { fromEmail, subject, hasHtml: !!html });

                        // Mark as seen
                        await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });

                        EventBus.emit(EVENTS.EMAIL.RECEIVED, {
                            emailAccountId,
                            fromEmail,
                            fromName,
                            subject,
                            body: text, // Fallback / plain text representation
                            html: html || undefined, // The processed HTML
                            messageId,
                            inReplyTo,
                            references
                        });

                        Logger.info(`[checkEmails] Emitted EMAIL.RECEIVED event`, { fromEmail, subject });
                    } catch (msgError: any) {
                        Logger.error('[checkEmails] Error processing individual message', {
                            messageUid: message.uid,
                            error: msgError?.message || String(msgError)
                        });
                    }
                }

                Logger.info(`[checkEmails] Found ${messageCount} unseen email(s)`, { email: account.email });
            } finally {
                // Always release the lock
                lock.release();
            }

            await client.logout();
            Logger.info('[checkEmails] Disconnected from IMAP server');
        } catch (error: any) {
            Logger.error(`[checkEmails] Error checking emails`, {
                email: account.email,
                error: error?.message || String(error),
                stack: error?.stack
            });
            // Ensure we try to close the connection on error
            try {
                await client.logout();
            } catch { /* ignore logout errors */ }
        }
    }
}
