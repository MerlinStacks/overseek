const ACCOUNT_SECRET_FIELDS = [
    'wooConsumerKey',
    'wooConsumerSecret',
    'webhookSecret',
    'openRouterApiKey',
] as const;

export function sanitizeAccountResponse<T extends Record<string, any>>(account: T): Omit<T, typeof ACCOUNT_SECRET_FIELDS[number]> & {
    wooCredentialsConfigured: boolean;
    webhookSecretConfigured: boolean;
    openRouterApiKeyConfigured: boolean;
} {
    const safeAccount = { ...account };
    const wooCredentialsConfigured = Boolean(safeAccount.wooConsumerKey && safeAccount.wooConsumerSecret);
    const webhookSecretConfigured = Boolean(safeAccount.webhookSecret);
    const openRouterApiKeyConfigured = Boolean(safeAccount.openRouterApiKey);

    for (const field of ACCOUNT_SECRET_FIELDS) {
        delete safeAccount[field];
    }

    return {
        ...safeAccount,
        wooCredentialsConfigured,
        webhookSecretConfigured,
        openRouterApiKeyConfigured,
    };
}
