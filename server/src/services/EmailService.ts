/**
 * Email Service
 * 
 * Handles SMTP sending and IMAP receiving using the unified EmailAccount model.
 */

import { EmailAccount } from '@prisma/client';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from './events';
import { Logger } from '../utils/logger';
import { decrypt } from '../utils/encryption';
import crypto from 'crypto';


export class EmailService {

    // -------------------
    // Sending (SMTP)
    // -------------------

    /**
     * Create nodemailer transporter for SMTP sending.
     */
    async createTransporter(account: EmailAccount) {
        if (!account.smtpEnabled || !account.smtpHost || !account.smtpPort || !account.smtpPassword) {
            throw new Error('SMTP not configured for this account');
        }

        // Port 465 uses implicit TLS, port 587 uses STARTTLS
        const useImplicitTLS = account.smtpPort === 465;

        const decryptedPassword = decrypt(account.smtpPassword);

        return nodemailer.createTransport({
            host: account.smtpHost,
            port: account.smtpPort,
            secure: useImplicitTLS,
            requireTLS: !useImplicitTLS && account.smtpSecure,
            auth: {
                user: account.smtpUsername || account.email,
                pass: decryptedPassword,
            },
            tls: {
                rejectUnauthorized: false,
                servername: account.smtpHost
            }
        });
    }

    /**
     * Send email via SMTP.
     */
    async sendEmail(
        accountId: string,
        emailAccountId: string,
        to: string,
        subject: string,
        html: string,
        attachments?: any[],
        options?: { source?: string; sourceId?: string; inReplyTo?: string; references?: string }
    ) {
        const emailAccount = await prisma.emailAccount.findFirst({
            where: { id: emailAccountId, accountId }
        });

        if (!emailAccount) {
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

        if (!emailAccount.smtpEnabled) {
            throw new Error("SMTP not enabled for this account");
        }

        try {
            const transporter = await this.createTransporter(emailAccount);

            // Generate tracking ID for read receipts
            const trackingId = crypto.randomUUID();
            const trackingPixelUrl = `${process.env.API_URL || 'http://localhost:3000'}/api/email/track/${trackingId}.png`;

            // Inject tracking pixel
            const htmlWithTracking = html.includes('</body>')
                ? html.replace('</body>', `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" /></body>`)
                : `${html}<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`;

            const mailOptions: any = {
                from: `"${emailAccount.name}" <${emailAccount.email}>`,
                to,
                subject,
                html: htmlWithTracking,
                attachments
            };

            if (options?.inReplyTo) {
                mailOptions.inReplyTo = options.inReplyTo;
            }
            if (options?.references) {
                mailOptions.references = options.references;
            }

            const info = await transporter.sendMail(mailOptions);

            await prisma.emailLog.create({
                data: {
                    accountId,
                    emailAccountId,
                    to,
                    subject,
                    status: 'SUCCESS',
                    messageId: info.messageId,
                    trackingId,
                    source: options?.source,
                    sourceId: options?.sourceId
                }
            });

            Logger.info(`Sent email with tracking`, { messageId: info.messageId, to, trackingId });
            return info;
        } catch (error: any) {
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
            throw error;
        }
    }

    /**
     * Verify SMTP or IMAP connection.
     */
    async verifyConnection(account: { host: string; port: number; username: string; password: string; type: string; isSecure: boolean }): Promise<boolean> {
        if (account.type === 'SMTP') {
            try {
                const useImplicitTLS = account.port === 465;
                const transporter = nodemailer.createTransport({
                    host: account.host,
                    port: account.port,
                    secure: useImplicitTLS,
                    requireTLS: !useImplicitTLS && account.isSecure,
                    auth: {
                        user: account.username,
                        pass: account.password,
                    },
                    tls: {
                        rejectUnauthorized: false,
                        servername: account.host
                    }
                });
                await transporter.verify();
                return true;
            } catch (error) {
                Logger.error('SMTP Verify Error', { error });
                throw error;
            }
        } else if (account.type === 'IMAP') {
            try {
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

    /**
     * Check for new emails via IMAP.
     */
    async checkEmails(emailAccountId: string) {
        const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
        if (!account) {
            Logger.warn('[checkEmails] Email account not found', { emailAccountId });
            return;
        }
        if (!account.imapEnabled) {
            Logger.warn('[checkEmails] IMAP not enabled, skipping', { emailAccountId });
            return;
        }
        if (!account.imapHost || !account.imapPort || !account.imapPassword) {
            Logger.warn('[checkEmails] IMAP not fully configured', { emailAccountId });
            return;
        }

        // Port 993 uses implicit TLS, port 143 uses STARTTLS
        const useImplicitTLS = account.imapPort === 993;

        let decryptedPassword: string;
        try {
            decryptedPassword = decrypt(account.imapPassword);
        } catch (e: any) {
            Logger.error('[checkEmails] Failed to decrypt IMAP password', {
                emailAccountId,
                error: e?.message || String(e)
            });
            return;
        }

        const client = new ImapFlow({
            host: account.imapHost,
            port: account.imapPort,
            secure: useImplicitTLS,
            auth: {
                user: account.imapUsername || account.email,
                pass: decryptedPassword
            },
            logger: false,
            tls: {
                rejectUnauthorized: false,
            } as any
        });

        try {
            Logger.info('[checkEmails] Connecting to IMAP server', { host: account.imapHost, port: account.imapPort });
            await client.connect();

            const lock = await client.getMailboxLock('INBOX');
            Logger.info('[checkEmails] Connected and locked INBOX');

            let messageCount = 0;

            try {
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

                        const parsed: ParsedMail = await simpleParser(source, { skipImageLinks: true });

                        const subject = parsed.subject || '(No Subject)';
                        const fromAddress = parsed.from?.value[0];
                        const fromEmail = fromAddress?.address || '';
                        const fromName = fromAddress?.name || '';
                        const messageId = parsed.messageId || message.envelope.messageId || `local-${Date.now()}`;
                        const inReplyTo = parsed.inReplyTo || message.envelope.inReplyTo || undefined;

                        let references: string | undefined;
                        if (typeof parsed.references === 'string') {
                            references = parsed.references;
                        } else if (Array.isArray(parsed.references)) {
                            references = parsed.references.join(' ');
                        }

                        let html = parsed.html || false;
                        const text = parsed.text || '';

                        // Process inline images
                        if (html && parsed.attachments && parsed.attachments.length > 0) {
                            for (const attachment of parsed.attachments) {
                                if (attachment.contentId && attachment.content && attachment.contentType) {
                                    const cid = attachment.contentId.replace(/^<|>$/g, '');
                                    const base64 = attachment.content.toString('base64');
                                    const dataUri = `data:${attachment.contentType};base64,${base64}`;
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
                            body: text,
                            html: html || undefined,
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
            try {
                await client.logout();
            } catch { /* ignore */ }
        }
    }
}
