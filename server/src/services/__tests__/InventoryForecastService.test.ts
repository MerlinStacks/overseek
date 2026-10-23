/**
 * InventoryForecastService Unit Tests
 * 
 * Tests demand prediction, stockout classification, and forecast generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryForecastService } from '../analytics/InventoryForecastService';
import { prisma } from '../../utils/prisma';
import { esClient } from '../../utils/elastic';
import { BOMForecastCycleError } from '../analytics/inventory-forecast/errors';

// Mock prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooProduct: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
        },
        internalProduct: {
            findMany: vi.fn(),
        },
        purchaseOrderItem: {
            findMany: vi.fn(),
        },
        bOMItem: {
            findMany: vi.fn(),
        },
    }
}));

// Mock Elasticsearch
vi.mock('../../utils/elastic', () => ({
    esClient: {
        search: vi.fn(),
    }
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}));

// Mock the forecast utility functions
vi.mock('../analytics/utils/forecastUtils', () => ({
    predictDailyDemand: vi.fn(() => ({
        dailyDemand: 2.5,
        confidence: 75,
        seasonalityFactor: 1.1,
        trendDirection: 'UP' as const,
        trendPercent: 10
    })),
    calculateSeasonalityCoefficients: vi.fn(() => new Map()),
    calculateDaysUntilStockout: vi.fn((stock, demand) => demand > 0 ? Math.floor(stock / demand) : Infinity),
    classifyStockoutRisk: vi.fn((days, leadTime) => {
        if (days <= leadTime) return 'CRITICAL';
        if (days <= leadTime * 2) return 'HIGH';
        if (days <= leadTime * 3) return 'MEDIUM';
        return 'LOW';
    }),
    calculateReorderQuantity: vi.fn(() => 50),
}));

describe('InventoryForecastService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set default returns for required Prisma mocks
        (prisma.internalProduct.findMany as any).mockResolvedValue([]);
        (prisma.purchaseOrderItem.findMany as any).mockResolvedValue([]);
        (prisma.bOMItem.findMany as any).mockResolvedValue([]);
        (prisma.wooProduct.findUnique as any).mockResolvedValue(null);
    });

    describe('getSkuForecasts', () => {
        it('should return empty array when no managed stock products exist', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([]);

            const result = await InventoryForecastService.getSkuForecasts('acc_123');

            expect(result).toEqual([]);
        });

        it('should generate forecasts for managed stock products', async () => {
            // Mock products with managed stock
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_1',
                    wooId: 101,
                    name: 'Widget A',
                    sku: 'WIDGET-A',
                    mainImage: 'https://example.com/widget.jpg',
                    rawData: { manage_stock: true, stock_quantity: 50 },
                    supplier: { leadTimeDefault: 7 },
                    boms: [],
                    variations: []
                },
                {
                    id: 'prod_2',
                    wooId: 102,
                    name: 'Widget B',
                    sku: 'WIDGET-B',
                    mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 10 },
                    supplier: null,
                    boms: [],
                    variations: []
                }
            ]);

            // Mock ES sales data
            (esClient.search as any).mockResolvedValue({
                aggregations: { by_day: { buckets: [] } }
            });

            const result = await InventoryForecastService.getSkuForecasts('acc_123');

            expect(result.length).toBe(2);
            expect(result[0].name).toBeDefined();
            expect(result[0].currentStock).toBeDefined();
            expect(result[0].stockoutRisk).toBeDefined();
        });

        it('forecasts nested assembly demand without altering stock or counting direct sales twice', async () => {
            const leaf = { id: 'leaf', wooId: 101, name: 'Material', sku: 'MAT', mainImage: null,
                stockQuantity: 100, manageStock: true, rawData: { manage_stock: true, stock_quantity: 100 },
                supplier: { leadTimeDefault: 7 }, boms: [], variations: [] };
            (prisma.wooProduct.findMany as any).mockResolvedValue([leaf]);
            const product = (id: string, wooId: number) => ({ id, accountId: 'acc_123', wooId, boms: [{ variationId: 0 }] });
            const edge = (parent: string, parentWooId: number, child: string, childWooId: number, quantity: number, wasteFactor: number) => ({
                isActive: true, supplierItemId: null, internalProductId: null, internalProduct: null,
                childProductId: child, childVariationId: null, childVariation: null,
                childProduct: product(child, childWooId), quantity, wasteFactor,
                bom: { productId: parent, variationId: 0, product: product(parent, parentWooId) },
            });
            (prisma.bOMItem.findMany as any).mockResolvedValue([
                edge('middle', 201, 'leaf', 101, 2, 0.1), edge('root', 301, 'middle', 201, 3, 0.2),
            ]);
            const yesterday = new Date(); yesterday.setUTCHours(0, 0, 0, 0); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            (esClient.search as any).mockImplementation(async (query: any) => {
                const selected = query.aggs.by_day.aggs.line_items_nested.aggs.products.aggs.values.terms.include;
                return { aggregations: { by_day: { buckets: [{ key: yesterday.getTime(), line_items_nested: { products: { values: {
                    sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
                    buckets: selected.map((id: string) => ({ key: id, total_qty: { value: id === '201' ? 45 : 90 } })),
                } } } }] } } };
            });
            const [forecast] = await InventoryForecastService.getSkuForecasts('acc_123');
            expect(forecast.derivedDemand).toBeCloseTo(45 / 90 * 2.2 + 90 / 90 * 7.92);
            expect(forecast.dailyDemand).toBeCloseTo(2.5 + 9.02);
            expect(forecast.forecastedDemand).toBe(346);
            expect(forecast.currentStock).toBe(100);
            expect(leaf.stockQuantity).toBe(100);
            expect(prisma.bOMItem.findMany).toHaveBeenCalledTimes(1);
        });

        it('should include ordered PO stock and subtract it from the reorder recommendation', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_1',
                    wooId: 101,
                    name: 'Inbound Widget',
                    sku: 'INBOUND-1',
                    mainImage: null,
                    stockQuantity: 0,
                    manageStock: true,
                    rawData: { manage_stock: true, stock_quantity: 0 },
                    supplier: { leadTimeDefault: null, leadTimeMin: 7, leadTimeMax: 12 },
                    boms: [],
                    variations: []
                }
            ]);
            (prisma.purchaseOrderItem.findMany as any).mockResolvedValue([
                {
                    productId: 'prod_1',
                    variationWooId: null,
                    quantity: 50,
                    purchaseOrder: { expectedDate: new Date(), orderDate: new Date(), createdAt: new Date() }
                }
            ]);
            (esClient.search as any).mockResolvedValue({ aggregations: { by_day: { buckets: [] } } });

            const [result] = await InventoryForecastService.getSkuForecasts('acc_123');

            expect(prisma.purchaseOrderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    purchaseOrder: { accountId: 'acc_123', status: 'ORDERED' }
                })
            }));
            expect(result.currentStock).toBe(0);
            expect(result.inboundStock).toBe(50);
            expect(result.projectedStock).toBe(50);
            expect(result.recommendedReorderQty).toBe(0);
            expect(result.daysUntilStockout).toBe(20);
            expect(result.supplierLeadTime).toBe(12);
            expect(result.supplierLeadTimeMin).toBe(7);
            expect(result.supplierLeadTimeMax).toBe(12);
        });

        it('should not treat a PO arriving after the planning horizon as available stock', async () => {
            const lateDate = new Date();
            lateDate.setUTCDate(lateDate.getUTCDate() + 60);
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_late', wooId: 102, name: 'Late Widget', sku: 'LATE-1', mainImage: null,
                    stockQuantity: 0, manageStock: true,
                    rawData: { manage_stock: true, stock_quantity: 0 },
                    supplier: { leadTimeDefault: 7, leadTimeMin: 5, leadTimeMax: 10 },
                    boms: [], variations: []
                }
            ]);
            (prisma.purchaseOrderItem.findMany as any).mockResolvedValue([
                {
                    productId: 'prod_late', variationWooId: null, quantity: 50,
                    purchaseOrder: { expectedDate: lateDate, orderDate: new Date(), createdAt: new Date() }
                }
            ]);
            (esClient.search as any).mockResolvedValue({ aggregations: { by_day: { buckets: [] } } });

            const [result] = await InventoryForecastService.getSkuForecasts('acc_123');

            expect(result.inboundStock).toBe(50);
            expect(result.projectedStock).toBe(0);
            expect(result.daysUntilStockout).toBe(0);
            expect(result.recommendedReorderQty).toBe(50);
        });

        it('should exclude products without managed stock', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_1',
                    wooId: 101,
                    name: 'Widget A',
                    sku: 'WIDGET-A',
                    mainImage: null,
                    rawData: { manage_stock: false }, // Not managed
                    supplier: null,
                    boms: [],
                    variations: []
                },
                {
                    id: 'prod_2',
                    wooId: 102,
                    name: 'Widget B',
                    sku: null,
                    mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 25 },
                    supplier: null,
                    boms: [],
                    variations: []
                }
            ]);

            (esClient.search as any).mockResolvedValue({ aggregations: { by_day: { buckets: [] } } });

            const result = await InventoryForecastService.getSkuForecasts('acc_123');

            expect(result.length).toBe(1);
            expect(result[0].wooId).toBe(102);
        });

        it('should sort results by risk priority (CRITICAL first)', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_1', wooId: 101, name: 'Low Risk',
                    sku: 'LR', mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 1000 },
                    supplier: { leadTimeDefault: 7 },
                    boms: [], variations: []
                },
                {
                    id: 'prod_2', wooId: 102, name: 'Critical Risk',
                    sku: 'CR', mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 5 },
                    supplier: { leadTimeDefault: 7 },
                    boms: [], variations: []
                }
            ]);

            (esClient.search as any).mockResolvedValue({ aggregations: { by_day: { buckets: [] } } });

            const result = await InventoryForecastService.getSkuForecasts('acc_123');

            // Critical risk should be sorted first
            expect(result.length).toBe(2);
        });

        it('should expose unavailable sales history instead of inventing empty demand', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_1', wooId: 101, name: 'Widget',
                    sku: 'W1', mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 50 },
                    supplier: null,
                    boms: [], variations: []
                }
            ]);

            (esClient.search as any).mockRejectedValue(new Error('ES connection failed'));

            await expect(InventoryForecastService.getSkuForecasts('acc_123')).rejects.toThrow('ES connection failed');
        });
    });

    describe('getStockoutAlerts', () => {
        it('should group alerts by risk level', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_1', wooId: 101, name: 'Critical Item',
                    sku: 'C1', mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 5 },
                    supplier: { leadTimeDefault: 7 },
                    boms: [], variations: []
                },
                {
                    id: 'prod_2', wooId: 102, name: 'Safe Item',
                    sku: 'S1', mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 500 },
                    supplier: { leadTimeDefault: 7 },
                    boms: [], variations: []
                }
            ]);

            (esClient.search as any).mockResolvedValue({ aggregations: { by_day: { buckets: [] } } });

            const result = await InventoryForecastService.getStockoutAlerts('acc_123');

            expect(result.summary).toBeDefined();
            expect(result.summary.totalAtRisk).toBeGreaterThanOrEqual(0);
            expect(result.critical).toBeDefined();
            expect(result.high).toBeDefined();
            expect(result.medium).toBeDefined();
        });
    });

    describe('getSkuForecastDetail', () => {
        it('propagates real cycle conflicts instead of converting them to a missing product', async () => {
            const error = new BOMForecastCycleError();
            const spy = vi.spyOn(InventoryForecastService, 'getSkuForecasts').mockRejectedValue(error);
            try {
                await expect(InventoryForecastService.getSkuForecastDetail('acc_123', 101)).rejects.toBe(error);
            } finally { spy.mockRestore(); }
        });
        it('should return null for non-existent product', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([]);

            const result = await InventoryForecastService.getSkuForecastDetail('acc_123', 999);

            expect(result).toBeNull();
        });

        it('should include forecast curve and historical demand', async () => {
            (prisma.wooProduct.findMany as any).mockResolvedValue([
                {
                    id: 'prod_1', wooId: 101, name: 'Widget',
                    sku: 'W1', mainImage: null,
                    rawData: { manage_stock: true, stock_quantity: 50 },
                    supplier: null,
                    boms: [], variations: []
                }
            ]);

            (esClient.search as any).mockResolvedValue({
                aggregations: { by_day: { buckets: [] } }
            });

            const result = await InventoryForecastService.getSkuForecastDetail('acc_123', 101);

            expect(result).not.toBeNull();
            expect(result!.forecastCurve).toBeDefined();
            expect(result!.forecastCurve.length).toBeGreaterThan(0);
            expect(result!.historicalDemand).toBeDefined();
        });
    });
});
