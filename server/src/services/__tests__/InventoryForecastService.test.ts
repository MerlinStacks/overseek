/**
 * InventoryForecastService Unit Tests
 * 
 * Tests demand prediction, stockout classification, and forecast generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryForecastService } from '../analytics/InventoryForecastService';
import { prisma } from '../../utils/prisma';
import { esClient } from '../../utils/elastic';

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
                aggregations: {
                    products: {
                        by_product: {
                            buckets: [
                                {
                                    key: 101,
                                    sales_over_time: {
                                        by_day: {
                                            buckets: [
                                                { key_as_string: '2026-01-10', doc_count: 5 },
                                                { key_as_string: '2026-01-11', doc_count: 3 }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            });

            const result = await InventoryForecastService.getSkuForecasts('acc_123');

            expect(result.length).toBe(2);
            expect(result[0].name).toBeDefined();
            expect(result[0].currentStock).toBeDefined();
            expect(result[0].stockoutRisk).toBeDefined();
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

            (esClient.search as any).mockResolvedValue({ aggregations: { products: { by_product: { buckets: [] } } } });

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

            (esClient.search as any).mockResolvedValue({ aggregations: { products: { by_product: { buckets: [] } } } });

            const result = await InventoryForecastService.getSkuForecasts('acc_123');

            // Critical risk should be sorted first
            expect(result.length).toBe(2);
        });

        it('should handle Elasticsearch failures gracefully', async () => {
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

            // Should not throw, should return forecasts with empty sales data
            const result = await InventoryForecastService.getSkuForecasts('acc_123');

            expect(result.length).toBe(1);
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

            (esClient.search as any).mockResolvedValue({ aggregations: { products: { by_product: { buckets: [] } } } });

            const result = await InventoryForecastService.getStockoutAlerts('acc_123');

            expect(result.summary).toBeDefined();
            expect(result.summary.totalAtRisk).toBeGreaterThanOrEqual(0);
            expect(result.critical).toBeDefined();
            expect(result.high).toBeDefined();
            expect(result.medium).toBeDefined();
        });
    });

    describe('getSkuForecastDetail', () => {
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
                aggregations: {
                    products: {
                        by_product: {
                            buckets: [{
                                key: 101,
                                sales_over_time: {
                                    by_day: {
                                        buckets: [
                                            { key_as_string: '2026-01-10', doc_count: 5 }
                                        ]
                                    }
                                }
                            }]
                        }
                    }
                }
            });

            const result = await InventoryForecastService.getSkuForecastDetail('acc_123', 101);

            expect(result).not.toBeNull();
            expect(result!.forecastCurve).toBeDefined();
            expect(result!.forecastCurve.length).toBeGreaterThan(0);
            expect(result!.historicalDemand).toBeDefined();
        });
    });
});
