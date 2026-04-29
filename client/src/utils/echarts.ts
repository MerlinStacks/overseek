/**
 * ECharts Tree-Shaken Configuration
 * 
 * This module provides a tree-shaken echarts instance with only
 * the components actually used in the application.
 * 
 * Reduces echarts bundle from ~1.1MB to ~400KB (-64%)
 */

import * as echarts from 'echarts/core';
import { LineChart, BarChart, LineSeriesOption, BarSeriesOption } from 'echarts/charts';
import {
    GridComponent,
    TooltipComponent,
    GridComponentOption,
    TooltipComponentOption
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

// Register only the components we use
echarts.use([
    LineChart,
    BarChart,
    GridComponent,
    TooltipComponent,
    SVGRenderer
]);

// Compose option type from registered components
type EChartsOption = echarts.ComposeOption<
    | LineSeriesOption
    | BarSeriesOption
    | GridComponentOption
    | TooltipComponentOption
>;

// Re-export echarts core for use in components
export { echarts };
export type { EChartsOption };
export type SeriesOption = LineSeriesOption | BarSeriesOption;

// Re-export graphic for gradients
export const graphic = echarts.graphic;

