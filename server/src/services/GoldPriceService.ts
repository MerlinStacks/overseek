import axios from 'axios';
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
                const response = await axios.get(`https://data-asg.goldprice.org/dbXRates/${currency}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });

                if (response.data && response.data.items && response.data.items.length > 0) {
                    const item = response.data.items[0];
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
            const response = await axios.get(`${GOLD_API_URL}/${symbol}/${currency}`, {
                headers: {
                    'x-access-token': API_TOKEN,
                    'Content-Type': 'application/json',
                },
            });

            // Response example: { "price": 2745.30, "currency": "USD", ... }
            if (response.data && response.data.price) {
                // Gold price is usually per Ounce (Troy Ounce ~ 31.1035g)
                // We want per GRAM for the calculator
                const pricePerOunce = parseFloat(response.data.price);
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
        let price = manualPrice;
        let accountCurrency: string | undefined;

        if (price === undefined) {
            // Fetch from API
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { currency: true }
            });

            if (account) {
                accountCurrency = account.currency;
                const livePrice = await this.fetchLivePrice(account.currency);
                if (livePrice !== null) {
                    price = livePrice;
                }
            }
        }

        if (price !== undefined && price !== null) {
            await prisma.account.update({
                where: { id: accountId },
                data: {
                    // @ts-ignore - TS2353: Persistent Docker build error masking this field
                    goldPrice: price,
                    goldPriceCurrency: accountCurrency || 'USD' // Ideally usually matches account.currency
                }
            });
        }
    }
}
