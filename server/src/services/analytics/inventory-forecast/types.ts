import { StockoutRisk, TrendDirection } from '../utils/forecastUtils';

export interface SkuForecast {
    id: string;
    wooId: number;
    parentWooId?: number;
    name: string;
    sku: string | null;
    image: string | null;
    currentStock: number;
    dailyDemand: number;
    derivedDemand: number;
    forecastedDemand: number;
    daysUntilStockout: number;
    stockoutRisk: StockoutRisk;
    confidence: number;
    seasonalityFactor: number;
    trendDirection: TrendDirection;
    trendPercent: number;
    recommendedReorderQty: number;
    supplierLeadTime: number | null;
    reorderPoint: number;
}

export interface BOMComponentMapping {
    componentProductId: string;
    componentWooId: number;
    parentMappings: Array<{
        parentProductId: string;
        parentWooId: number;
        parentVariationId: number;
        quantity: number;
        wasteFactor: number;
    }>;
}

export interface StockoutAlert {
    critical: SkuForecast[];
    high: SkuForecast[];
    medium: SkuForecast[];
    summary: {
        totalAtRisk: number;
        criticalCount: number;
        highCount: number;
        mediumCount: number;
    };
}

export interface ForecastCurvePoint {
    date: string;
    predictedStock: number;
    upperBound: number;
    lowerBound: number;
}

export interface SkuForecastDetail extends SkuForecast {
    forecastCurve: ForecastCurvePoint[];
    historicalDemand: { date: string; quantity: number }[];
}

export interface ManagedProduct {
    id: string;
    wooId: number;
    parentWooId?: number;
    name: string;
    sku: string | null;
    image: string | null;
    currentStock: number;
    supplierLeadTime: number | null;
    isVariation?: boolean;
}
