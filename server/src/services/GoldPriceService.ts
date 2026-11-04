import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// GoldAPI.io configuration
// In a real scenario, we might want this in the DB per account if they bring their own key,
// but for now we'll assume a system-wide free key or similar.
const GOLD_API_URL = 'https://www.goldapi.io/api';
const REQUEST_TIMEOUT_MS = 10_000;

function positivePrice(value: unknown): number {
    const price = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(price) || price <= 0) throw new Error('Gold price API returned an invalid price');
    return price;
}

async function safeJson(response: Response, context: string): Promise<any> {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        // Providers can echo credential-bearing request URLs in error pages.
        await response.body?.cancel();
        Logger.warn('GoldPriceService: Non-JSON response', { context, status: response.status, contentType });
        throw new Error('Gold price API returned non-JSON response');
    }

    return response.json();
}

function normalizeCurrency(currency: string): string {
    return /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : 'USD';
}

export class GoldPriceService {
    /**
     * Fetches the current gold price for a given currency from GoldAPI.io
     */
    static async fetchLivePrice(currency = 'USD'): Promise<number | null> {
        currency = normalizeCurrency(currency);
        const apiToken = process.env.GOLD_API_KEY?.trim();
        if (!apiToken) {
            // Fallback to public endpoint
            Logger.info('GoldPriceService: No API Token, using public endpoint');
            try {
                // This endpoint returns Ounce price in configured currency (default USD)
                const response = await fetch(`https://data-asg.goldprice.org/dbXRates/${currency}`, {
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'application/json',
                        'Referer': 'https://goldprice.org/'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await safeJson(response, 'goldprice.org');
                if (data && data.items && data.items.length > 0) {
                    const item = data.items[0];
                    // The API returns keys like xauPrice (which is in the requested currency)
                    if (item.xauPrice !== undefined) {
                        const pricePerOunce = positivePrice(item.xauPrice);
                        const pricePerGram = pricePerOunce / 31.1034768;
                        return pricePerGram;
                    }
                }
                throw new Error('Gold price API returned no price');
            } catch (primaryError) {
                Logger.warn('GoldPriceService: Primary public endpoint failed, trying fallback', { error: (primaryError as Error).message });

                // Never send the old demo credential: it is not a production data source.
                const metalsApiKey = process.env.METALS_API_KEY?.trim();
                if (!metalsApiKey) {
                    Logger.error('GoldPriceService: Public price unavailable and no authenticated provider configured', {
                        primaryError: (primaryError as Error).message,
                        configurationRequired: 'GOLD_API_KEY or METALS_API_KEY',
                    });
                    return null;
                }
                let fallbackStatus: number | undefined;
                try {
                    const query = new URLSearchParams({ api_key: metalsApiKey, currency, unit: 'g' });
                    const fallbackResponse = await fetch(`https://api.metals.dev/v1/latest?${query}`, {
                        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                        headers: { 'Accept': 'application/json' }
                    });
                    fallbackStatus = fallbackResponse.status;
                    if (!fallbackResponse.ok) {
                        // eslint-disable-next-line preserve-caught-error -- This is the fallback HTTP failure, not the primary error being handled.
                        throw new Error(`HTTP ${fallbackResponse.status}`);
                    }
                    const fallbackData = await safeJson(fallbackResponse, 'metals.dev');
                    // metals.dev returns { metals: { gold: <price_per_gram> } }
                    return positivePrice(fallbackData?.metals?.gold);
                } catch {
                    Logger.error('GoldPriceService: Error fetching public price (both endpoints failed)', {
                        primaryError: (primaryError as Error).message,
                        // A transport error can contain the credential-bearing request URL.
                        fallbackError: 'Authenticated metals provider failed',
                        fallbackStatus,
                    });
                    return null;
                }
            }
        }

        // Use Authorized API
        try {
            const symbol = `XAU`;
            const response = await fetch(`${GOLD_API_URL}/${symbol}/${currency}`, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: {
                    'x-access-token': apiToken,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await safeJson(response, 'goldapi.io');
            // Response example: { "price": 2745.30, "currency": "USD", ... }
            if (data && data.price !== undefined) {
                // Gold price is usually per Ounce (Troy Ounce ~ 31.1035g)
                // We want per GRAM for the calculator
                const pricePerOunce = positivePrice(data.price);
                const pricePerGram = pricePerOunce / 31.1034768;
                return pricePerGram;
            }
            return null;
        } catch (error) {
            Logger.error('GoldPriceService: Error fetching price', { error: (error as Error).message });
            return null;
        }
    }

    /**
     * Updates the account's gold price manually or via API
     */
    static async updateAccountPrice(accountId: string, manualPrice?: number): Promise<void> {
        // Redirect legacy call to new method (assuming manualPrice is meant for base or we ignore it?
        // Actually, let's keep it for backward compat but also trigger the new update logic if manualPrice is NOT provided (refresh))

        if (manualPrice === undefined) {
            return this.updateAccountPrices(accountId);
        } else {
            // Legacy update for single price field
            await prisma.account.update({
                where: { id: accountId },
                data: { goldPrice: manualPrice }
            });
        }
    }

    /**
     * Updates the expanded set of gold prices (18ct, 9ct, etc)
     * If manualData is provided, it saves those values.
     * If not, it fetches live 24ct price and calculates them based on margin.
     */
    static async updateAccountPrices(accountId: string, manualData?: {
        goldPrice18ct?: number;
        goldPrice9ct?: number;
        goldPrice18ctWhite?: number;
        goldPrice9ctWhite?: number;
        goldPriceMargin?: number;
    }): Promise<void> {
        if (manualData) {
            await prisma.account.update({
                where: { id: accountId },
                data: {
                    goldPrice18ct: manualData.goldPrice18ct,
                    goldPrice9ct: manualData.goldPrice9ct,
                    goldPrice18ctWhite: manualData.goldPrice18ctWhite,
                    goldPrice9ctWhite: manualData.goldPrice9ctWhite,
                    goldPriceMargin: manualData.goldPriceMargin
                }
            });
            return;
        }

        // Fetch live price and calculate
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { currency: true, goldPriceMargin: true, goldPrice: true, updatedAt: true, goldPriceUpdatedAt: true }
        });

        if (!account) return;

        const livePricePerGram24ct = await this.fetchLivePrice(account.currency);
        if (livePricePerGram24ct !== null) {
            const configuredMargin = account.goldPriceMargin == null ? NaN : Number(account.goldPriceMargin);
            const margin = Number.isFinite(configuredMargin) && configuredMargin >= 0 ? configuredMargin : 10;
            const marginMultiplier = 1 + (margin / 100);

            // 18ct = 75% gold
            const price18ct = livePricePerGram24ct * 0.75 * marginMultiplier;
            // 9ct = 37.5% gold
            const price9ct = livePricePerGram24ct * 0.375 * marginMultiplier;

            await prisma.account.update({
                where: { id: accountId },
                data: {
                    goldPrice: livePricePerGram24ct, // Update base price too
                    goldPriceCurrency: account.currency,
                    goldPrice18ct: price18ct,
                    goldPrice9ct: price9ct,
                    goldPrice18ctWhite: price18ct, // White gold same price base
                    goldPrice9ctWhite: price9ct,
                    goldPriceUpdatedAt: new Date()  // Track when gold prices were last successfully fetched
                }
            });
        } else {
            // EDGE CASE: API failed - check if cached price is stale and notify user
            // Why goldPriceUpdatedAt: account.updatedAt changes on ANY account edit
            // (name, settings, etc.), making stale gold prices look fresh. This field
            // only updates when gold prices are actually fetched successfully.
            const priceTimestamp = account.goldPriceUpdatedAt ?? account.updatedAt;
            const priceAgeMs = Date.now() - new Date(priceTimestamp).getTime();
            const priceAgeHours = priceAgeMs / (1000 * 60 * 60);
            const STALE_THRESHOLD_HOURS = 1;

            if (priceAgeHours > STALE_THRESHOLD_HOURS && Number(account.goldPrice) > 0) {
                Logger.warn('[GoldPriceService] API unavailable, using stale cached price', {
                    accountId,
                    priceAgeHours: priceAgeHours.toFixed(1),
                    cachedPrice: Number(account.goldPrice)
                });

                // Create notification for user awareness
                await prisma.notification.create({
                    data: {
                        accountId,
                        title: '⚠️ Gold Price Update Failed',
                        message: `Unable to fetch live gold prices. Using cached price from ${priceAgeHours.toFixed(0)} hours ago. Product prices may be inaccurate.`,
                        type: 'WARNING',
                        link: '/settings/gold-prices'
                    }
                }).catch(err => {
                    Logger.error('[GoldPriceService] Failed to create notification', { error: err.message });
                });
            } else if (Number(account.goldPrice) === 0 || account.goldPrice === null) {
                // No cached price at all - critical warning
                Logger.error('[GoldPriceService] API unavailable and no cached price', { accountId });

                await prisma.notification.create({
                    data: {
                        accountId,
                        title: '🚨 Gold Price Not Available',
                        message: 'Unable to fetch gold prices and no cached price exists. Products with gold pricing will display incorrect values.',
                        type: 'ERROR',
                        link: '/settings/gold-prices'
                    }
                }).catch(err => {
                    Logger.error('[GoldPriceService] Failed to create notification', { error: err.message });
                });
            }
        }
    }
}
