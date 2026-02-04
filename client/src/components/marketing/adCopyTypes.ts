/**
 * Ad Copy Types
 * 
 * Type definitions for the Ad Copy Generator.
 */

export interface TonePreset {
    id: string;
    name: string;
    description: string;
}

export interface Platform {
    id: string;
    name: string;
    limits?: {
        headline?: number;
        description?: number;
        primaryText?: number;
    };
}

export interface GeneratedCopy {
    headlines: string[];
    descriptions: string[];
    primaryTexts?: string[];
    source: 'ai' | 'template';
    platform?: string;
    notes?: string[];
}
