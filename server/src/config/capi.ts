import { Logger } from '../utils/logger';

export async function registerCAPIPlatforms(): Promise<void> {
    const { ConversionForwarder } = await import('../services/tracking/ConversionForwarder');
    const { MetaCAPIService } = await import('../services/tracking/MetaCAPIService');
    const { TikTokEventsService } = await import('../services/tracking/TikTokEventsService');
    const { GoogleEnhancedConversionsService } = await import('../services/tracking/GoogleEnhancedConversionsService');
    const { PinterestCAPIService } = await import('../services/tracking/PinterestCAPIService');
    const { GA4MeasurementService } = await import('../services/tracking/GA4MeasurementService');
    const { SnapchatCAPIService } = await import('../services/tracking/SnapchatCAPIService');
    const { MicrosoftCAPIService } = await import('../services/tracking/MicrosoftCAPIService');
    const { TwitterCAPIService } = await import('../services/tracking/TwitterCAPIService');

    ConversionForwarder.register(new MetaCAPIService());
    ConversionForwarder.register(new TikTokEventsService());
    ConversionForwarder.register(new GoogleEnhancedConversionsService());
    ConversionForwarder.register(new PinterestCAPIService());
    ConversionForwarder.register(new GA4MeasurementService());
    ConversionForwarder.register(new SnapchatCAPIService());
    ConversionForwarder.register(new MicrosoftCAPIService());
    ConversionForwarder.register(new TwitterCAPIService());
    Logger.info('[CAPI] All conversion platform services registered');
}
