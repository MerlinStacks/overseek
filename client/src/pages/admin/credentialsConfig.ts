/**
 * Platform credential field configurations.
 *
 * Why extracted: keeps the 75-line static data declaration out of the
 * page component so it can focus on behaviour/presentation.
 */

import { Mail, Globe, Facebook, Bell } from 'lucide-react';
import type { ElementType } from 'react';

export interface FieldConfig {
    key: string;
    label: string;
    placeholder: string;
    /** Brief help text shown below the field */
    helpText?: string;
    /** Whether this field is required for the integration to work */
    required?: boolean;
    /** Whether to treat this as a sensitive field (masked by default) */
    sensitive?: boolean;
}

export interface PlatformConfig {
    id: string;
    name: string;
    description: string;
    icon: ElementType;
    /** Brand colour class for the icon badge */
    iconColor: string;
    fields: FieldConfig[];
    testable?: boolean;
    /** OAuth callback path for platforms that need it */
    callbackPath?: string;
    /** Webhook URL path for platforms that need it */
    webhookPath?: string;
    /** Link to the provider's developer console */
    docsUrl?: string;
    /** Short label for the docs link */
    docsLabel?: string;
}

export type PlatformId = 'PLATFORM_SMTP' | 'GOOGLE_ADS' | 'META_ADS' | 'META_MESSAGING' | 'WEB_PUSH_VAPID';

export const PLATFORMS: PlatformConfig[] = [
    {
        id: 'PLATFORM_SMTP',
        name: 'Email (SMTP)',
        description: 'Send system emails — password resets, MFA codes, and notifications.',
        icon: Mail,
        iconColor: 'bg-sky-500',
        fields: [
            { key: 'host', label: 'SMTP Host', placeholder: 'smtp.example.com', required: true },
            { key: 'port', label: 'Port', placeholder: '587', required: true, helpText: 'Use 587 for STARTTLS or 465 for implicit TLS.' },
            { key: 'username', label: 'Username', placeholder: 'your-email@example.com', required: true },
            { key: 'password', label: 'Password', placeholder: '••••••••', required: true, sensitive: true },
            { key: 'fromEmail', label: 'From Email', placeholder: 'noreply@example.com', helpText: 'The sender address shown to recipients.' },
            { key: 'fromName', label: 'From Name', placeholder: 'OverSeek' },
            { key: 'secure', label: 'Use TLS/SSL', placeholder: 'true', helpText: 'Set to "true" for port 465 (implicit TLS).' }
        ],
        testable: true
    },
    {
        id: 'GOOGLE_ADS',
        name: 'Google Ads',
        description: 'Let users connect their Google Ads accounts via OAuth.',
        icon: Globe,
        iconColor: 'bg-red-500',
        docsUrl: 'https://console.cloud.google.com/apis/credentials',
        docsLabel: 'Google Cloud Console',
        fields: [
            { key: 'clientId', label: 'Client ID', placeholder: 'xxx.apps.googleusercontent.com', required: true, helpText: 'From your Google Cloud OAuth 2.0 credential.' },
            { key: 'clientSecret', label: 'Client Secret', placeholder: 'GOCSPX-xxx', required: true, sensitive: true },
            { key: 'developerToken', label: 'Developer Token', placeholder: '22-character alphanumeric token', required: true, helpText: 'Found in Google Ads → Tools & Settings → API Center. Required for all Ads API calls.' },
            { key: 'loginCustomerId', label: 'Manager Account ID (MCC)', placeholder: '123-456-7890', helpText: 'Only needed if you manage ads through an MCC (Manager) account. Format: 123-456-7890.' }
        ],
        callbackPath: '/api/oauth/google/callback'
    },
    {
        id: 'META_ADS',
        name: 'Meta Ads',
        description: 'Let users connect Facebook & Instagram Ads via OAuth.',
        icon: Facebook,
        iconColor: 'bg-blue-600',
        docsUrl: 'https://developers.facebook.com/apps',
        docsLabel: 'Meta Developer Console',
        fields: [
            { key: 'appId', label: 'App ID', placeholder: '123456789', required: true },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...', required: true, sensitive: true }
        ],
        callbackPath: '/api/oauth/meta/ads/callback'
    },
    {
        id: 'META_MESSAGING',
        name: 'Meta Messaging',
        description: 'Facebook Messenger & Instagram DM integration.',
        icon: Facebook,
        iconColor: 'bg-indigo-500',
        docsUrl: 'https://developers.facebook.com/apps',
        docsLabel: 'Meta Developer Console',
        fields: [
            { key: 'appId', label: 'App ID', placeholder: '123456789', required: true },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...', required: true, sensitive: true },
            { key: 'webhookVerifyToken', label: 'Webhook Verify Token', placeholder: 'your_secret_token', required: true, helpText: "Must match the Verify Token in your Facebook App's webhook settings." }
        ],
        callbackPath: '/api/oauth/meta/messaging/callback',
        webhookPath: '/api/meta-webhook'
    },
    {
        id: 'WEB_PUSH_VAPID',
        name: 'Push Notifications',
        description: 'VAPID keys for browser push notifications.',
        icon: Bell,
        iconColor: 'bg-violet-500',
        fields: [
            { key: 'publicKey', label: 'Public Key', placeholder: 'Base64-encoded public key', required: true },
            { key: 'privateKey', label: 'Private Key', placeholder: 'Base64-encoded private key', required: true, sensitive: true }
        ]
    }
];
