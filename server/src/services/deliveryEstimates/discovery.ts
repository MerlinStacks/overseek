import { z } from 'zod';
import { WooService } from '../woo';

const capabilitiesSchema = z.object({
    schemaVersion: z.literal(1),
    pluginVersion: z.string().min(1).max(64),
    capabilities: z.object({
        shippingMethods: z.boolean(), calculationEngine: z.boolean(),
        configurationSync: z.boolean(), storefront: z.boolean(),
    }),
});
const id = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const methodsSchema = z.object({
    schemaVersion: z.literal(1),
    timezone: z.string().min(1).max(100),
    methods: z.array(z.object({
        methodId: z.string().min(1).max(191).regex(/^[A-Za-z0-9_-]+$/),
        instanceId: id, zoneId: id,
        zoneName: z.string().max(255), title: z.string().max(255),
        enabled: z.boolean(), provider: z.enum(['woocommerce', 'weight_based', 'unknown']),
        rateIdentityScope: z.literal('method_instance'), requiresRateVerification: z.boolean(),
        observedRates: z.array(z.object({ rateId: z.string().regex(/^[\x21-\x7e]{1,200}(?![\s\S])/), title: z.string().max(200), capturedAt: z.string().datetime() }).strict()).max(100).optional(),
    })).max(1000),
    warnings: z.array(z.string().max(512)).max(1000),
});

export class DeliveryDiscoveryError extends Error {
    constructor(public readonly statusCode: 502 | 503, public readonly code: string, message: string) {
        super(message);
    }
}

const unsupported = () => ({
    status: 'plugin_update_required' as const, methods: [],
    warnings: ['Update the Overseek WooCommerce plugin to enable shipping discovery.'],
});

/** Instances and bounded past admin observations, never sync readiness or current eligibility. */
export async function discoverShippingMethods(accountId: string) {
    let woo: WooService;
    try { woo = await WooService.forAccount(accountId); }
    catch { throw new DeliveryDiscoveryError(503, 'DELIVERY_DISCOVERY_UNAVAILABLE', 'Shipping discovery is unavailable.'); }
    try {
        const caps = capabilitiesSchema.safeParse(await woo.getDeliveryDiscovery('capabilities'));
        if (!caps.success) throw new DeliveryDiscoveryError(502, 'DELIVERY_DISCOVERY_INVALID_RESPONSE', 'Invalid shipping discovery response.');
        if (!caps.data.capabilities.shippingMethods) return { ...unsupported(), capabilities: caps.data.capabilities };
        const result = methodsSchema.safeParse(await woo.getDeliveryDiscovery('shipping-methods'));
        if (!result.success) throw new DeliveryDiscoveryError(502, 'DELIVERY_DISCOVERY_INVALID_RESPONSE', 'Invalid shipping discovery response.');
        return {
            status: 'available' as const, timezone: result.data.timezone,
            methods: result.data.methods,
            // Generate bounded warnings locally rather than forwarding arbitrary upstream text.
            warnings: [
                'Discovery availability does not mean configuration sync is ready or storefront delivery estimates are live.',
                ...result.data.methods.filter(method => method.requiresRateVerification).map(method =>
                    `Method ${method.methodId}:${method.instanceId} requires an exact observed option mapping or an explicitly confirmed instance-wide policy. Observed options are not current eligibility.`),
            ],
            capabilities: caps.data.capabilities,
        };
    } catch (error) {
        if (error instanceof DeliveryDiscoveryError) throw error;
        const upstream = error as { response?: { status?: number }; code?: string } | null;
        const status = upstream?.response?.status;
        if (status === 404) return unsupported();
        if (status === 401 || status === 403) {
            throw new DeliveryDiscoveryError(502, 'DELIVERY_DISCOVERY_AUTH_FAILED', 'Shipping discovery authorization failed.');
        }
        if (status === 429 || (status !== undefined && status >= 500) ||
            ['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(upstream?.code ?? '')) {
            throw new DeliveryDiscoveryError(503, 'DELIVERY_DISCOVERY_UNAVAILABLE', 'Shipping discovery is unavailable.');
        }
        throw new DeliveryDiscoveryError(502, 'DELIVERY_DISCOVERY_UPSTREAM_ERROR', 'Shipping discovery request failed.');
    }
}
