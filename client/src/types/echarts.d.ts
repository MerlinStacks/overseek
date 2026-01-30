/**
 * Type declarations for echarts modules.
 * Provides ambient module declarations to suppress TypeScript errors.
 */

declare module 'echarts' {
    export interface EChartsOption {
        [key: string]: any;
    }

    export interface SeriesOption {
        type?: string;
        data?: any[];
        [key: string]: any;
    }

    export interface ECharts {
        setOption(option: EChartsOption): void;
        resize(): void;
        dispose(): void;
    }

    export function init(dom: HTMLElement | null, theme?: string | object): ECharts;
    export function use(extension: any): void;

    export const graphic: {
        LinearGradient: new (x: number, y: number, x2: number, y2: number, colorStops: Array<{ offset: number; color: string }>) => any;
        RadialGradient: new (x: number, y: number, r: number, colorStops: Array<{ offset: number; color: string }>) => any;
        [key: string]: any;
    };
}

declare module 'echarts-for-react' {
    import { ComponentType } from 'react';
    import { EChartsOption } from 'echarts';

    interface ReactEChartsProps {
        option: EChartsOption;
        notMerge?: boolean;
        lazyUpdate?: boolean;
        theme?: string | object;
        onChartReady?: (instance: any) => void;
        onEvents?: Record<string, (params: any) => void>;
        opts?: {
            renderer?: 'canvas' | 'svg';
            width?: number | string;
            height?: number | string;
        };
        style?: React.CSSProperties;
        className?: string;
    }

    const ReactECharts: ComponentType<ReactEChartsProps>;
    export default ReactECharts;
}
