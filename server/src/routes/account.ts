/**
 * Account Route - Fastify Plugin
 * Account management and user assignment
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { IndexingService } from '../services/search/IndexingService';
import { GoldPriceService } from '../services/GoldPriceService';
import { WooService } from '../services/woo';
import { OrderTaggingService } from '../services/OrderTaggingService';

const accountRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Create Account
    fastify.post('/', async (request, reply) => {
        try {
            const userId = request.user!.id;
            const { name, domain, wooUrl, wooConsumerKey, wooConsumerSecret } = request.body as any;

            if (!name || !wooUrl || !wooConsumerKey || !wooConsumerSecret) {
                return reply.code(400).send({ error: 'Missing required fields' });
            }

            const validUser = await prisma.user.findUnique({ where: { id: userId } });
            if (!validUser) return reply.code(401).send({ error: 'User invalid' });

            const account = await prisma.account.create({
                data: {
                    name, domain, wooUrl, wooConsumerKey, wooConsumerSecret,
                    users: { create: { userId, role: 'OWNER' } }
                }
            });

            try {
                const wooService = new WooService({ url: wooUrl, consumerKey: wooConsumerKey, consumerSecret: wooConsumerSecret, accountId: account.id });
                const storeSettings = await wooService.getStoreSettings();
                const updatedAccount = await prisma.account.update({
                    where: { id: account.id },
                    data: { weightUnit: storeSettings.weightUnit, dimensionUnit: storeSettings.dimensionUnit, currency: storeSettings.currency }
                });
                return updatedAccount;
            } catch (settingsError) {
                Logger.warn('Failed to fetch WooCommerce store settings during account creation', { accountId: account.id, error: settingsError });
            }

            return account;
        } catch (error: any) {
            if (error.code === 'P2003') return reply.code(401).send({ error: 'User invalid' });
            Logger.error('Create Account error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // Get All Accounts for User
    fastify.get('/', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) return reply.code(401).send({ error: 'User ID missing' });

            const accounts = await prisma.account.findMany({
                where: { users: { some: { userId } } },
                include: { features: true }
            });
            return accounts;
        } catch (error) {
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // Update Account
    fastify.put<{ Params: { accountId: string } }>('/:accountId', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const {
                name, domain, wooUrl, wooConsumerKey, wooConsumerSecret, webhookSecret,
                openRouterApiKey, aiModel, appearance,
                goldPrice, refreshGoldPrice,
                goldPrice18ct, goldPrice9ct, goldPrice18ctWhite, goldPrice9ctWhite, goldPriceMargin
            } = request.body as any;
            const userId = request.user!.id;

            const membership = await prisma.accountUser.findUnique({ where: { userId_accountId: { userId, accountId } } });
            if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
                return reply.code(403).send({ error: 'Forbidden' });
            }

            const data: any = { name, domain, wooUrl, wooConsumerKey, openRouterApiKey, aiModel, appearance };
            if (wooConsumerSecret?.trim()) data.wooConsumerSecret = wooConsumerSecret;
            if (webhookSecret !== undefined) data.webhookSecret = webhookSecret?.trim() || null;

            if (refreshGoldPrice) {
                await GoldPriceService.updateAccountPrices(accountId);
                return await prisma.account.findUnique({ where: { id: accountId } });
            }

            // Check if any of the new gold price fields are being updated
            if (goldPrice18ct !== undefined || goldPrice9ct !== undefined || goldPrice18ctWhite !== undefined || goldPrice9ctWhite !== undefined || goldPriceMargin !== undefined) {
                 await GoldPriceService.updateAccountPrices(accountId, {
                    goldPrice18ct: goldPrice18ct ? parseFloat(goldPrice18ct) : undefined,
                    goldPrice9ct: goldPrice9ct ? parseFloat(goldPrice9ct) : undefined,
                    goldPrice18ctWhite: goldPrice18ctWhite ? parseFloat(goldPrice18ctWhite) : undefined,
                    goldPrice9ctWhite: goldPrice9ctWhite ? parseFloat(goldPrice9ctWhite) : undefined,
                    goldPriceMargin: goldPriceMargin ? parseFloat(goldPriceMargin) : undefined
                 });
                 // If base goldPrice is also provided (legacy or base update), update it too
                 if (goldPrice !== undefined) {
                     await GoldPriceService.updateAccountPrice(accountId, parseFloat(goldPrice));
                 }
                 return await prisma.account.findUnique({ where: { id: accountId } });
            } else if (goldPrice !== undefined) {
                await GoldPriceService.updateAccountPrice(accountId, parseFloat(goldPrice));
                return await prisma.account.findUnique({ where: { id: accountId } });
            }

            const updated = await prisma.account.update({ where: { id: accountId }, data });
            return updated;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to update account' });
        }
    });

    // Delete Account
    fastify.delete<{ Params: { accountId: string } }>('/:accountId', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const userId = request.user!.id;

            const user = await prisma.user.findUnique({ where: { id: userId } });
            const isSuperAdmin = user?.isSuperAdmin === true;

            if (!isSuperAdmin) {
                const membership = await prisma.accountUser.findUnique({ where: { userId_accountId: { userId, accountId } } });
                if (!membership || membership.role !== 'OWNER') {
                    return reply.code(403).send({ error: 'Forbidden. Only Owners or Super Admins can delete accounts.' });
                }
            }

            await IndexingService.deleteAccountData(accountId);
            await prisma.account.delete({ where: { id: accountId } });
            return { success: true, message: 'Account deleted successfully' };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to delete account' });
        }
    });

    // List Users
    fastify.get<{ Params: { accountId: string } }>('/:accountId/users', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const userId = request.user!.id;

            const membership = await prisma.accountUser.findUnique({ where: { userId_accountId: { userId, accountId } } });
            if (!membership) return reply.code(403).send({ error: 'Forbidden' });

            const users = await prisma.accountUser.findMany({
                where: { accountId },
                include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true } } }
            });
            return users;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed' });
        }
    });

    // Add User
    fastify.post<{ Params: { accountId: string }; Body: { email: string; role?: string } }>('/:accountId/users', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { email, role } = request.body;
            const userId = request.user!.id;

            const membership = await prisma.accountUser.findUnique({ where: { userId_accountId: { userId, accountId } } });
            if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
                return reply.code(403).send({ error: 'Forbidden' });
            }

            const targetUser = await prisma.user.findUnique({ where: { email } });
            if (!targetUser) return reply.code(404).send({ error: 'User not found. They must register first.' });

            const exists = await prisma.accountUser.findUnique({ where: { userId_accountId: { userId: targetUser.id, accountId } } });
            if (exists) return reply.code(400).send({ error: 'User already in account' });

            const newUser = await prisma.accountUser.create({
                data: { accountId, userId: targetUser.id, role: (role || 'STAFF') as any },
                include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true } } }
            });
            return newUser;
        } catch (e) {
            Logger.error('Failed to add user to account', { error: e });
            return reply.code(500).send({ error: 'Failed' });
        }
    });

    // Remove User
    fastify.delete<{ Params: { accountId: string; targetUserId: string } }>('/:accountId/users/:targetUserId', async (request, reply) => {
        try {
            const { accountId, targetUserId } = request.params;
            const userId = request.user!.id;

            const membership = await prisma.accountUser.findUnique({ where: { userId_accountId: { userId, accountId } } });
            if (!membership || membership.role !== 'OWNER') {
                if (userId !== targetUserId && membership?.role !== 'OWNER') {
                    return reply.code(403).send({ error: 'Forbidden' });
                }
            }

            await prisma.accountUser.delete({ where: { userId_accountId: { userId: targetUserId, accountId } } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed' });
        }
    });

    // Tag Mappings - Get
    fastify.get<{ Params: { accountId: string } }>('/:accountId/tag-mappings', async (request, reply) => {
        try {
            const mappings = await OrderTaggingService.getTagMappings(request.params.accountId);
            return { mappings };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to get tag mappings' });
        }
    });

    // Tag Mappings - Save
    fastify.put<{ Params: { accountId: string }; Body: { mappings: any[] } }>('/:accountId/tag-mappings', async (request, reply) => {
        try {
            const { mappings } = request.body;
            if (!Array.isArray(mappings)) return reply.code(400).send({ error: 'mappings must be an array' });
            await OrderTaggingService.saveTagMappings(request.params.accountId, mappings);
            return { success: true };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to save tag mappings' });
        }
    });

    // Product Tags
    fastify.get<{ Params: { accountId: string } }>('/:accountId/product-tags', async (request, reply) => {
        try {
            const tags = await OrderTaggingService.getAllProductTags(request.params.accountId);
            return { tags };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to get product tags' });
        }
    });

    // Sync WooCommerce Settings
    fastify.post<{ Params: { accountId: string } }>('/:accountId/sync-settings', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const wooService = await WooService.forAccount(accountId);
            const storeSettings = await wooService.getStoreSettings();

            const updatedAccount = await prisma.account.update({
                where: { id: accountId },
                data: { weightUnit: storeSettings.weightUnit, dimensionUnit: storeSettings.dimensionUnit, currency: storeSettings.currency }
            });

            Logger.info('Synced WooCommerce store settings', { accountId, settings: storeSettings });
            return { success: true, weightUnit: updatedAccount.weightUnit, dimensionUnit: updatedAccount.dimensionUnit, currency: updatedAccount.currency };
        } catch (error) {
            Logger.error('Failed to sync WooCommerce settings', { accountId: request.params.accountId, error });
            return reply.code(500).send({ error: 'Failed to sync WooCommerce settings' });
        }
    });
};

export default accountRoutes;
