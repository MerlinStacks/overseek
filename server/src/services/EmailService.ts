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
import fs from 'fs';
import path from 'path';

const attachmentsDir = path.join(__dirname, '../../uploads/attachments');
if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
}

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
            },
            // Timeout configuration to prevent infinite hangs
            connectionTimeout: 10000,  // 10 seconds to establish connection
            greetingTimeout: 10000,    // 10 seconds for greeting
            socketTimeout: 30000       // 30 seconds for socket operations
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

        // Debug log to verify what settings we're using
        Logger.info('[checkEmails] IMAP config', {
            email: account.email,
            imapHost: account.imapHost,
            imapPort: account.imapPort,
            imapUsername: account.imapUsername || account.email,
            hasPassword: !!account.imapPassword,
            passwordLength: account.imapPassword?.length
        });

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

        const MAX_MESSAGES_PER_POLL = 10; // Limit to prevent long-running connections

        const client = new ImapFlow({
            host: account.imapHost,
            port: account.imapPort,
            secure: useImplicitTLS,
            auth: {
                user: account.imapUsername || account.email,
                pass: decryptedPassword
            },
            logger: false,
            emitLogs: false,
            connectionTimeout: 15000, // 15 second connection timeout (reduced)
            greetingTimeout: 10000,   // 10 second greeting timeout (reduced)
            socketTimeout: 30000,     // 30 second socket timeout (reduced from 60s)
            tls: {
                rejectUnauthorized: false,
            } as any
        });

        // Handle connection errors
        client.on('error', (err: Error) => {
            Logger.error('[checkEmails] IMAP client error event', { email: account.email, error: err.message });
        });

        // Retry logic for connection with exponential backoff
        const MAX_RETRIES = 2;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
                    Logger.info(`[checkEmails] Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms`, { email: account.email });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                Logger.info('[checkEmails] Connecting to IMAP server', {
                    host: account.imapHost,
                    port: account.imapPort,
                    email: account.email,
                    secure: useImplicitTLS,
                    attempt: attempt + 1
                });
                await client.connect();

                // Verify connection is actually open
                if (!client.usable) {
                    throw new Error('IMAP connection not usable after connect');
                }
                Logger.info('[checkEmails] Connection established successfully');
                lastError = null;
                break; // Success, exit retry loop
            } catch (connectError: any) {
                lastError = connectError;
                Logger.warn(`[checkEmails] Connection attempt ${attempt + 1} failed`, {
                    email: account.email,
                    error: connectError?.message || String(connectError)
                });

                // Clean up failed connection before retry
                try { await client.logout(); } catch { /* ignore */ }
            }
        }

        if (lastError) {
            Logger.error('[checkEmails] All connection attempts failed', {
                email: account.email,
                error: lastError.message,
                attempts: MAX_RETRIES + 1
            });
            return;
        }

        try {
            const lock = await client.getMailboxLock('INBOX');
            Logger.info('[checkEmails] Connected and locked INBOX');

            let messageCount = 0;
            const processedUids: number[] = []; // Collect UIDs to mark as seen AFTER loop

            try {
                for await (const message of client.fetch({ seen: false }, {
                    envelope: true,
                    bodyStructure: true,
                    source: true
                })) {
                    // Limit messages per poll to avoid long-running connections
                    if (messageCount >= MAX_MESSAGES_PER_POLL) {
                        Logger.info(`[checkEmails] Reached batch limit of ${MAX_MESSAGES_PER_POLL}, will continue in next poll`);
                        break;
                    }

                    messageCount++;
                    try {
                        const source = message.source;
                        if (!source) {
                            Logger.warn('[checkEmails] Message has no source', { uid: message.uid });
                            continue;
                        }

                        // Store UID for marking as seen AFTER the loop
                        // NOTE: imapflow docs warn that calling messageFlagsAdd inside fetch loop causes DEADLOCK
                        processedUids.push(message.uid);

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
                        const processedAttachments: Array<{ filename: string; url: string; type: string }> = [];

                        // Process attachments
                        if (parsed.attachments && parsed.attachments.length > 0) {
                            for (const attachment of parsed.attachments) {
                                let isInline = false;

                                // Handle inline images
                                if (html && attachment.contentId && attachment.content && attachment.contentType) {
                                    const cid = attachment.contentId.replace(/^<|>$/g, '');
                                    // Only treat as inline if it's actually referenced in the HTML
                                    if (html.includes(`cid:${cid}`)) {
                                        const base64 = attachment.content.toString('base64');
                                        const dataUri = `data:${attachment.contentType};base64,${base64}`;
                                        const regex = new RegExp(`cid:${cid}`, 'g');
                                        html = html.replace(regex, dataUri);
                                        isInline = true;
                                    }
                                }

                                // Handle regular attachments (or unreferenced inline ones)
                                if (!isInline && attachment.filename && attachment.content) {
                                    try {
                                        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                                        const filename = uniqueSuffix + '-' + attachment.filename;
                                        const filePath = path.join(attachmentsDir, filename);

                                        fs.writeFileSync(filePath, attachment.content);

                                        processedAttachments.push({
                                            filename: attachment.filename,
                                            url: `/uploads/attachments/${filename}`,
                                            type: attachment.contentType || 'application/octet-stream'
                                        });
                                    } catch (err) {
                                        Logger.error('[checkEmails] Failed to save attachment', { filename: attachment.filename, error: err });
                                    }
                                }
                            }
                        }

                        Logger.info(`[checkEmails] Processing email`, { fromEmail, subject, hasHtml: !!html, attachments: processedAttachments.length });

                        EventBus.emit(EVENTS.EMAIL.RECEIVED, {
                            emailAccountId,
                            fromEmail,
                            fromName,
                            subject,
                            body: text,
                            html: html || undefined,
                            messageId,
                            inReplyTo,
                            references,
                            attachments: processedAttachments
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

                // Mark all processed messages as seen AFTER the fetch loop completes
                // This avoids the deadlock issue documented in imapflow
                if (processedUids.length > 0) {
                    try {
                        // Use UID range for efficiency (e.g., "1,2,5,10" or "1:10")
                        const uidRange = processedUids.join(',');
                        await client.messageFlagsAdd(uidRange, ['\\Seen'], { uid: true });
                        Logger.info('[checkEmails] Successfully marked all messages as seen', {
                            count: processedUids.length,
                            uids: processedUids
                        });
                    } catch (flagError: any) {
                        Logger.error('[checkEmails] Failed to mark messages as seen', {
                            uids: processedUids,
                            error: flagError?.message || String(flagError),
                            stack: flagError?.stack
                        });
                    }
                }
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
