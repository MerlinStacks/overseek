declare module 'web-push' {
    export interface PushSubscription {
        endpoint: string;
        keys: {
            p256dh: string;
            auth: string;
        };
    }

    export interface VapidDetails {
        subject: string;
        publicKey: string;
        privateKey: string;
    }

    export interface SendResult {
        statusCode: number;
        body: string;
        headers: Record<string, string>;
    }

    export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
    export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    export function sendNotification(subscription: PushSubscription, payload?: string | Buffer): Promise<SendResult>;
}
