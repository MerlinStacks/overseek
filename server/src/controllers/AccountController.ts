import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { IndexingService } from '../services/search/IndexingService';
import { GoldPriceService } from '../services/GoldPriceService';
import { WooService } from '../services/woo';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();

export class AccountController {
    static async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { name, domain, wooUrl, wooConsumerKey, wooConsumerSecret } = req.body;

            if (!name || !wooUrl || !wooConsumerKey || !wooConsumerSecret) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const validUser = await prisma.user.findUnique({ where: { id: userId } });
            if (!validUser) {
                return res.status(401).json({ error: 'User invalid. Please login again.' });
            }

            try {
                const account = await prisma.account.create({
                    data: {
                        name,
                        domain,
                        wooUrl,
                        wooConsumerKey,
                        wooConsumerSecret,
                        users: {
                            create: {
                                userId,
                                role: 'OWNER'
                            }
                        }
                    }
                });

                // Fetch WooCommerce store settings to sync measurement units
                try {
                    const wooService = new WooService({
                        url: wooUrl,
                        consumerKey: wooConsumerKey,
                        consumerSecret: wooConsumerSecret,
                        accountId: account.id
                    });

                    const storeSettings = await wooService.getStoreSettings();

                    // Update account with fetched settings
                    const updatedAccount = await prisma.account.update({
                        where: { id: account.id },
                        data: {
                            weightUnit: storeSettings.weightUnit,
                            dimensionUnit: storeSettings.dimensionUnit,
                            currency: storeSettings.currency
                        }
                    });

                    return res.json(updatedAccount);
                } catch (settingsError) {
                    // Log but don't fail account creation - settings use defaults
                    Logger.warn('Failed to fetch WooCommerce store settings during account creation', { accountId: account.id, error: settingsError });
                }

                res.json(account);
            } catch (e: any) {
                if (e.code === 'P2003') {
                    return res.status(401).json({ error: 'User invalid. Please login again.' });
                }
                throw e;
            }
        } catch (error) {
            console.error('Create Account error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async getAll(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'User ID missing' });
            }

            const accounts = await prisma.account.findMany({
                where: {
                    users: {
                        some: { userId }
                    }
                },
                include: { features: true }
            });
            res.json(accounts);
        } catch (error) {
            console.error('Get Accounts Error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async update(req: Request, res: Response) {
        try {
            const { accountId } = req.params;
            const { name, domain, wooUrl, wooConsumerKey, wooConsumerSecret, openRouterApiKey, aiModel, appearance, goldPrice, refreshGoldPrice } = req.body;
            const userId = (req as any).user.id;

            const membership = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId, accountId } }
            });

            if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const data: any = {
                name,
                domain,
                wooUrl,
                wooConsumerKey,
                openRouterApiKey,
                aiModel,
                appearance
            };

            if (wooConsumerSecret && wooConsumerSecret.trim() !== '') {
                data.wooConsumerSecret = wooConsumerSecret;
            }

            if (refreshGoldPrice) {
                await GoldPriceService.updateAccountPrice(accountId);
                const fresh = await prisma.account.findUnique({ where: { id: accountId } });
                return res.json(fresh);
            } else if (goldPrice !== undefined) {
                await GoldPriceService.updateAccountPrice(accountId, parseFloat(goldPrice));
                const fresh = await prisma.account.findUnique({ where: { id: accountId } });
                return res.json(fresh);
            }

            const updated = await prisma.account.update({
                where: { id: accountId },
                data
            });
            res.json(updated);
        } catch (error) {
            console.error("Update account error", error);
            res.status(500).json({ error: "Failed to update account" });
        }
    }

    static async delete(req: Request, res: Response) {
        try {
            const { accountId } = req.params;
            const userId = (req as any).user.id;

            const user = await prisma.user.findUnique({ where: { id: userId } });
            const isSuperAdmin = user?.isSuperAdmin === true;

            if (!isSuperAdmin) {
                const membership = await prisma.accountUser.findUnique({
                    where: { userId_accountId: { userId, accountId } }
                });

                if (!membership || membership.role !== 'OWNER') {
                    return res.status(403).json({ error: 'Forbidden. Only Owners or Super Admins can delete accounts.' });
                }
            }

            await IndexingService.deleteAccountData(accountId);
            await prisma.account.delete({
                where: { id: accountId }
            });

            res.json({ success: true, message: 'Account deleted successfully' });
        } catch (error) {
            console.error('Delete Account Error:', error);
            res.status(500).json({ error: 'Failed to delete account' });
        }
    }
}
