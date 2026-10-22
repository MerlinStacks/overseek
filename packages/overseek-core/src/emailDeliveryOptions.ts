/** Non-secret configuration needed to reproduce a flow's delivery transforms. */
export interface EmailDeliveryPreviewOptions {
    automationId?: string;
    appendUtm?: boolean;
    campaignSource?: string;
    campaignMedium?: string;
    campaignName?: string;
    campaignTerm?: string;
    campaignContent?: string;
    overrideFrom?: boolean;
    fromName?: string;
    fromEmail?: string;
    replyToEmail?: string;
}
