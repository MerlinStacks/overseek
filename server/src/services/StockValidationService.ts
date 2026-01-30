/**
 * Stock Validation Service
 * 
 * Validates stock levels between OverSeek and WooCommerce before automated writes.
 * Detects mismatches and creates notifications for review.
 */

import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { WooService } from './woo';
import { EventBus, EVENTS } from './events';

export interface StockValidationResult {
    valid: boolean;
    wooStock: number | null;
    expectedStock: number;
    diff: number;
    productName?: string;
}

export class StockValidationService {
    /**
     * Validate stock before writing to WooCommerce.
     * Compares the expected stock (from local calculation) with actual WooCommerce stock.
     * 
     * @param accountId - Account context
     * @param wooProductId - WooCommerce product ID
     * @param expectedCurrentStock - What we expect current stock to be before our change
     * @returns Validation result with mismatch details
     */
    static async validateBeforeWrite(
        accountId: string,
        wooProductId: number,
        expectedCurrentStock: number
    ): Promise<StockValidationResult> {
        try {
            const wooService = await WooService.forAccount(accountId);
            const wooProduct = await wooService.getProduct(wooProductId);
            const wooStock = wooProduct.stock_quantity;
            const productName = wooProduct.name;

            // If WooCommerce doesn't manage stock, we can't validate
            if (typeof wooStock !== 'number') {
                Logger.debug(`[StockValidation] Product ${wooProductId} does not have managed stock, skipping validation`);
                return {
                    valid: true,
                    wooStock: null,
                    expectedStock: expectedCurrentStock,
                    diff: 0,
                    productName
                };
            }

            const diff = wooStock - expectedCurrentStock;
            const valid = diff === 0;

            if (!valid) {
                Logger.warn(`[StockValidation] Stock mismatch for product ${wooProductId}: Woo=${wooStock}, Expected=${expectedCurrentStock}, Diff=${diff}`, { accountId });
            }

            return {
                valid,
                wooStock,
                expectedStock: expectedCurrentStock,
                diff,
                productName
            };
        } catch (error: any) {
            Logger.error(`[StockValidation] Failed to validate stock for product ${wooProductId}`, { error: error.message, accountId });
            // On error, allow the operation but mark as skipped
            return {
                valid: true, // Allow to proceed
                wooStock: null,
                expectedStock: expectedCurrentStock,
                diff: 0
            };
        }
    }

    /**
     * Create a notification when a stock mismatch is detected.
     * Called when we proceed with a write despite mismatch.
     */
    static async notifyMismatch(
        accountId: string,
        productId: number,
        productName: string,
        wooStock: number,
        expectedStock: number,
        newStock: number
    ): Promise<void> {
        try {
            // Find the local product to get the internal ID
            const localProduct = await prisma.wooProduct.findFirst({
                where: { accountId, wooId: productId }
            });

            // Emit event for NotificationEngine to handle push and in-app notification
            EventBus.emit(EVENTS.STOCK.MISMATCH, {
                accountId,
                productId,
                productName,
                wooStock,
                expectedStock,
                newStock,
                internalProductId: localProduct?.id
            });

            Logger.info(`[StockValidation] Emitted mismatch event for product ${productId}`, { accountId });
        } catch (error: any) {
            Logger.error(`[StockValidation] Failed to send mismatch notification`, { error: error.message, accountId });
        }
    }

    /**
     * Log a stock change to the audit trail with validation context.
     */
    static async logStockChange(
        accountId: string,
        productId: string,
        source: 'USER' | 'SYSTEM_BOM' | 'SYSTEM_SYNC',
        previousStock: number | null,
        newStock: number,
        validationStatus: 'PASSED' | 'SKIPPED' | 'MISMATCH_OVERRIDE',
        additionalDetails?: Record<string, any>
    ): Promise<void> {
        try {
            await prisma.auditLog.create({
                data: {
                    accountId,
                    userId: null, // System action
                    action: 'UPDATE',
                    resource: 'PRODUCT',
                    resourceId: productId,
                    source,
                    previousValue: previousStock !== null ? { stock_quantity: previousStock } : null,
                    validationStatus,
                    details: {
                        stock_quantity: newStock,
                        ...additionalDetails
                    }
                }
            });
        } catch (error: any) {
            Logger.error(`[StockValidation] Failed to log stock change`, { error: error.message, accountId });
        }
    }
}
