/**
 * PlatformEmailService.ts
 * 
 * Handles platform-level email operations using globally configured SMTP credentials.
 * Used for system emails like password resets, MFA codes, and admin notifications.
 * Separate from tenant-scoped EmailService which handles user automation emails.
 */

import nodemailer, { Transporter } from 'nodemailer';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

interface SmtpConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    fromEmail: string;
    fromName: string;
    secure: boolean;
}

/**
 * Service for sending platform-level system emails.
 */
export class PlatformEmailService {

    /**
     * Fetches SMTP configuration from the PlatformCredentials vault.
     * Returns null if not configured.
     */
    async getSmtpConfig(): Promise<SmtpConfig | null> {
        try {
            const record = await prisma.platformCredentials.findUnique({
                where: { platform: 'PLATFORM_SMTP' }
            });

            if (!record || !record.credentials) {
                return null;
            }

            const creds = record.credentials as Record<string, string>;

            return {
                host: creds.host || '',
                port: parseInt(creds.port) || 587,
                username: creds.username || '',
                password: creds.password || '',
                fromEmail: creds.fromEmail || '',
                fromName: creds.fromName || process.env.APP_NAME || 'Commerce Platform',
                secure: creds.secure === 'true'
            };
        } catch (error) {
            Logger.error('Failed to fetch platform SMTP config', { error });
            return null;
        }
    }

    /**
     * Creates a nodemailer transporter with the given SMTP config.
     */
    private createTransporter(config: SmtpConfig): Transporter {
        return nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.username,
                pass: config.password
            }
        });
    }

    /**
     * Tests SMTP connection with provided credentials.
     * Does not require saved credentials — used for pre-save verification.
     */
    async testConnection(config: {
        host: string;
        port: number;
        username: string;
        password: string;
        secure?: boolean;
    }): Promise<{ success: boolean; error?: string }> {
        try {
            const transporter = nodemailer.createTransport({
                host: config.host,
                port: config.port,
                secure: config.secure ?? false,
                auth: {
                    user: config.username,
                    pass: config.password
                }
            });

            await transporter.verify();
            return { success: true };
        } catch (error: any) {
            Logger.error('SMTP test connection failed', { error: error.message });
            return {
                success: false,
                error: error.message || 'Connection failed'
            };
        }
    }

    /**
     * Sends a platform-level email using the configured SMTP settings.
     * Used for password resets, MFA codes, system notifications, etc.
     */
    async sendPlatformEmail(
        to: string,
        subject: string,
        html: string,
        options?: { textContent?: string }
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        const config = await this.getSmtpConfig();

        if (!config) {
            Logger.error('Platform SMTP not configured');
            return {
                success: false,
                error: 'Platform SMTP not configured. Please configure in Super Admin settings.'
            };
        }

        if (!config.host || !config.username || !config.password) {
            Logger.error('Platform SMTP configuration incomplete');
            return {
                success: false,
                error: 'Platform SMTP configuration incomplete'
            };
        }

        try {
            const transporter = this.createTransporter(config);

            const info = await transporter.sendMail({
                from: `"${config.fromName}" <${config.fromEmail}>`,
                to,
                subject,
                html,
                text: options?.textContent
            });

            Logger.info('Platform email sent', { messageId: info.messageId, to });

            return {
                success: true,
                messageId: info.messageId
            };
        } catch (error: any) {
            Logger.error('Failed to send platform email', { error: error.message, to });
            return {
                success: false,
                error: error.message || 'Failed to send email'
            };
        }
    }
}

// Singleton instance for convenience
export const platformEmailService = new PlatformEmailService();
