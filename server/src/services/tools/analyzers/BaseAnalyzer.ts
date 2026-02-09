/**
 * Base Analyzer
 * 
 * Abstract base class for all AI Marketing Co-Pilot analyzers.
 * Provides common structure, error handling, and timing.
 */

import { Logger } from '../../../utils/logger';
import { BaseAnalysisResult, Suggestion, AnalysisMetadata } from '../types/AnalysisTypes';


export abstract class BaseAnalyzer<TResult extends BaseAnalysisResult = BaseAnalysisResult> {

    /** Unique identifier for this analyzer */
    abstract readonly name: string;

    /**
     * Run the analysis. Subclasses implement doAnalyze().
     * This wrapper handles timing, error handling, and metadata.
     */
    async analyze(accountId: string): Promise<TResult> {
        const startTime = Date.now();

        try {
            const result = await this.doAnalyze(accountId);
            result.metadata = this.createMetadata(accountId, startTime);
            return result;
        } catch (error) {
            Logger.error(`${this.name} failed`, { error, accountId });
            const emptyResult = this.createEmptyResult(accountId);
            emptyResult.metadata = this.createMetadata(accountId, startTime);
            return emptyResult;
        }
    }

    /**
     * Actual analysis logic. Implement in subclasses.
     */
    protected abstract doAnalyze(accountId: string): Promise<TResult>;

    /**
     * Create empty result structure. Implement in subclasses.
     */
    protected abstract createEmptyResult(accountId: string): TResult;

    /**
     * Create analysis metadata.
     */
    protected createMetadata(accountId: string, startTime: number): AnalysisMetadata {
        return {
            analyzedAt: new Date(),
            durationMs: Date.now() - startTime,
            source: this.name,
            accountId,
        };
    }

    /**
     * Helper to create a suggestion with defaults.
     */
    protected suggestion(
        id: string,
        text: string,
        options: Partial<Omit<Suggestion, 'id' | 'text' | 'source'>> = {}
    ): Suggestion {
        return {
            id: `${this.name}_${id}`,
            text,
            source: this.name,
            priority: options.priority ?? 3,
            category: options.category ?? 'optimization',
            confidence: options.confidence ?? 50,
            ...options,
        };
    }

    /**
     * Log warning without failing analysis.
     */
    protected warn(message: string, context?: object): void {
        Logger.warn(`[${this.name}] ${message}`, context);
    }
}


/** All available analyzer names */
export type AnalyzerName =
    | 'MultiPeriodAnalyzer'
    | 'CrossChannelAnalyzer'
    | 'LTVAnalyzer'
    | 'FunnelAnalyzer'
    | 'AudienceAnalyzer'
    | 'KnowledgeBaseAnalyzer';
