import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// GoldAPI.io configuration
// In a real scenario, we might want this in the DB per account if they bring their own key,
// but for now we'll assume a system-wide free key or similar.
const GOLD_API_URL = 'https://www.goldapi.io/api';
// Using a placeholder token or env variable. In prod, use process.env.GOLD_API_KEY
const API_TOKEN = process.env.GOLD_API_KEY || '';

export class GoldPriceService {
    /**
     * Fetches the current gold price for a given currency from GoldAPI.io
     */
    static async fetchLivePrice(currency = 'USD'): Promise<number | null> {
        if (!API_TOKEN) {
            // Fallback to public endpoint
            Logger.info('GoldPriceService: No API Token, using public endpoint');
            try {
                // This endpoint returns Ounce price in configured currency (default USD)
                const response = await fetch(`https://data-asg.goldprice.org/dbXRates/${currency}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                if (data && data.items && data.items.length > 0) {
                    const item = data.items[0];
                    // The API returns keys like xauPrice (which is in the requested currency)
                    if (item.xauPrice) {
                        const pricePerOunce = item.xauPrice;
                        const pricePerGram = pricePerOunce / 31.1034768;
                        return pricePerGram;
                    }
                }
                return null;
            } catch (error) {
                Logger.error('GoldPriceService: Error fetching public price', { error: (error as Error).message });
                return null;
            }
        }

        // Use Authorized API
        try {
            const symbol = `XAU`;
            const response = await fetch(`${GOLD_API_URL}/${symbol}/${currency}`, {
                headers: {
                    'x-access-token': API_TOKEN,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            // Response example: { "price": 2745.30, "currency": "USD", ... }
            if (data && data.price) {
                // Gold price is usually per Ounce (Troy Ounce ~ 31.1035g)
                // We want per GRAM for the calculator
                const pricePerOunce = parseFloat(data.price);
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
            select: { currency: true, goldPriceMargin: true }
        });

        if (!account) return;

        const livePricePerGram24ct = await this.fetchLivePrice(account.currency);
        if (livePricePerGram24ct !== null) {
            const margin = Number(account.goldPriceMargin) || 10; // Default 10%
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
                    goldPrice9ctWhite: price9ct
                }
            });
        }
    }
}
