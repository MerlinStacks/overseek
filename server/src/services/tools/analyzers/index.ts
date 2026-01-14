/**
 * Analyzers Index
 * 
 * AI Marketing Co-Pilot analysis modules.
 */

// Base infrastructure
export { BaseAnalyzer } from './BaseAnalyzer';
export type { AnalyzerName } from './BaseAnalyzer';

export { AnalysisPipeline } from './AnalysisPipeline';

// Individual analyzers
export { MultiPeriodAnalyzer } from './MultiPeriodAnalyzer';
export type { MultiPeriodAnalysis, MultiPeriodData } from './MultiPeriodAnalyzer';

export { CrossChannelAnalyzer } from './CrossChannelAnalyzer';
export type { CrossChannelInsight } from './CrossChannelAnalyzer';

export { LTVAnalyzer } from './LTVAnalyzer';
export type { LTVInsight, ChannelLTV } from './LTVAnalyzer';

export { FunnelAnalyzer } from './FunnelAnalyzer';
export type { FunnelAnalysis, CampaignFunnelAnalysis, FunnelStage } from './FunnelAnalyzer';

export { AudienceAnalyzer } from './AudienceAnalyzer';
export type { AudienceAnalysis, DevicePerformance, GeoPerformance } from './AudienceAnalyzer';

