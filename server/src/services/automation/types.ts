/**
 * Automation Flow Types
 * 
 * Shared type definitions for the automation engine.
 */

export interface FlowNode {
    id: string;
    type: string; // 'trigger', 'action', 'delay', 'condition'
    data: any;
}

export interface FlowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null; // 'true', 'false' for conditions
}

export interface FlowDefinition {
    nodes: FlowNode[];
    edges: FlowEdge[];
}

export interface NodeExecutionResult {
    action: 'NEXT' | 'WAIT';
    outcome?: string;
}
