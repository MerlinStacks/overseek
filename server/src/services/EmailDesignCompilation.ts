import { assertEmailDesign, compileEmailDesignV2, isEmailDesignV2 } from '@overseek/core';

export function canonicalEmailDesign(design: unknown, fallbackHtml: string): string {
    if (!isEmailDesignV2(design)) {
        if ((design as any)?.engine === 'overseek-v2') throw Object.assign(new Error('Unsupported email design version'), { statusCode: 400 });
        return fallbackHtml;
    }
    try { assertEmailDesign(design); return compileEmailDesignV2(design); }
    catch { throw Object.assign(new Error('Invalid or unsupported email design; correct it before saving'), { statusCode: 400 }); }
}
export function canonicalFlowEmailDesigns(definition: unknown): any {
    const flow = structuredClone(definition) as any;
    if (!Array.isArray(flow?.nodes)) return flow;
    for (const node of flow.nodes) {
        const config = node?.data?.config;
        if (config?.designJson && (config.actionType || 'SEND_EMAIL') === 'SEND_EMAIL') config.htmlContent = canonicalEmailDesign(config.designJson, config.htmlContent || '');
    }
    return flow;
}
