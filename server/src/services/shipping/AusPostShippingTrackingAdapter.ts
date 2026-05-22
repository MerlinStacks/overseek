import { prisma } from '../../utils/prisma';
import { decrypt } from '../../utils/encryption';
import { Logger } from '../../utils/logger';
import { AUSPOST_SERVICE_CATALOG, AUSPOST_SERVICE_CATALOG_UPDATED_AT } from './AusPostServiceCatalog';

interface AusPostCredentials {
    apiKey: string;
    apiSecret?: string;
    accountNumber?: string;
    baseUrl?: string;
    environment: 'sandbox' | 'production';
    senderAddress: Record<string, unknown>;
    defaultDomesticService?: string;
    paymentMethod?: 'CHARGE_ACCOUNT' | 'CREDIT_CARD' | 'PAYPAL';
    endpoints: {
        test?: string;
        rates?: string;
        labels?: string;
        labelPdf?: string;
        tracking?: string;
        cancellation?: string;
        validateSuburb?: string;
        validateShipment?: string;
        createShipment?: string;
        createOrder?: string;
    };
}

interface AusPostServiceDiscoveryResult {
    services: Array<{ code: string; label: string }>;
    updatedAt: string;
    source: 'live_account' | 'live_account_cached' | 'static_fallback';
    warning?: string;
}

const DEFAULT_BASE_URL = 'https://digitalapi.auspost.com.au/shipping/v1';
const DEFAULT_ENDPOINTS = {
    test: '/accounts/{account_number}',
    rates: '/prices/shipments',
    itemRates: '/prices/items',
    labels: '/labels',
    labelPdf: '/labels/{request_id}',
    tracking: '/track?tracking_ids={tracking_ids}',
    cancellation: '/shipments/{shipment_id}',
    createShipment: '/shipments',
    validateShipment: '/shipments/validation',
    createOrder: '/orders',
    validateSuburb: '/address?suburb={suburb}&state={state}&postcode={postcode}',
};

export interface AusPostRateRequest {
    wooOrderId: number;
    address: Record<string, unknown>;
    dimensions: Record<string, unknown>;
    serviceCode?: string | null;
}

export interface AusPostLabelRequest extends AusPostRateRequest {
    order: Record<string, unknown>;
    senderAddress: Record<string, unknown>;
}

export interface AusPostCreateLabelRequest {
    shipmentId: string;
    printGroup: 'Parcel Post' | 'Express Post';
    layout: 'A4-1pp' | 'A4-3pp' | 'A4-4pp' | 'A6-1pp';
    branded: boolean;
    leftOffset?: number;
    topOffset?: number;
    waitForLabelUrl?: boolean;
}

export interface AusPostCancelShipmentResult {
    status: string;
    carrier: 'AUSPOST';
    shipmentId: string;
    rawResponse: unknown;
}

class AusPostShippingTrackingAdapter {
    private static readonly serviceDiscoveryTtlMs = 6 * 60 * 60 * 1000;

    private static readonly serviceDiscoveryCache = new Map<string, { expiresAt: number; result: AusPostServiceDiscoveryResult }>();

    async testConnection(accountId: string) {
        const credentials = await this.getCredentials(accountId);
        if (credentials.endpoints.test) {
            await this.request(credentials, this.applyTemplate(credentials.endpoints.test, {
                account_number: credentials.accountNumber || '',
            }), { method: 'GET' });
            return {
                ok: true,
                status: 'live_test_passed',
                message: `AusPost Shipping and Tracking API test endpoint responded successfully for ${credentials.environment}.`,
            };
        }

        return {
            ok: true,
            status: 'credentials_ready',
            message: `AusPost Shipping and Tracking API credentials are saved for ${credentials.environment}. Add a credential test endpoint path to run a live validation call.`,
        };
    }

    async getRates(accountId: string, request: AusPostRateRequest) {
        const credentials = await this.getCredentials(accountId);
        if (!credentials.endpoints.rates) throw new Error('AusPost rates endpoint mapping is not configured yet');
        const payload = this.buildShipmentRatePayload(credentials, request);
        const response = await this.request(credentials, credentials.endpoints.rates, {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        return {
            status: 'ok',
            carrier: 'AUSPOST',
            rates: this.extractRates(response),
            rawResponse: response,
        };
    }

    async listAvailableServiceCatalog(accountId: string, options: { forceRefresh?: boolean } = {}): Promise<AusPostServiceDiscoveryResult> {
        try {
            const credentials = await this.getCredentials(accountId);
            const cacheKey = `${accountId}:${credentials.environment}:${credentials.accountNumber || 'no-account'}`;
            const cached = AusPostShippingTrackingAdapter.serviceDiscoveryCache.get(cacheKey);
            if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
                return {
                    ...cached.result,
                    source: cached.result.source === 'live_account' ? 'live_account_cached' : cached.result.source,
                };
            }

            const destination = this.toAusPostAddress(credentials.senderAddress, false);
            const probeRequestBase: Omit<AusPostRateRequest, 'serviceCode'> = {
                wooOrderId: 0,
                address: destination,
                dimensions: { weightGrams: 500, lengthMm: 220, widthMm: 160, heightMm: 20 },
            };

            const available: Array<{ code: string; label: string }> = [];
            for (const service of AUSPOST_SERVICE_CATALOG) {
                try {
                    if (!credentials.endpoints.rates) throw new Error('AusPost rates endpoint mapping is not configured yet');
                    const payload = this.buildShipmentRatePayload(credentials, { ...probeRequestBase, serviceCode: service.code });
                    await this.request(credentials, credentials.endpoints.rates, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                    });
                    available.push(service);
                } catch {
                    // unsupported product for this account/environment
                }
            }

            if (available.length === 0) {
                throw new Error('No usable AusPost service codes were discovered for this account');
            }

            const result: AusPostServiceDiscoveryResult = {
                services: available,
                updatedAt: new Date().toISOString(),
                source: 'live_account',
            };
            AusPostShippingTrackingAdapter.serviceDiscoveryCache.set(cacheKey, {
                expiresAt: Date.now() + AusPostShippingTrackingAdapter.serviceDiscoveryTtlMs,
                result,
            });
            return result;
        } catch (error: any) {
            const reason = this.sanitizedErrorReason(error);
            Logger.warn('[AusPostAdapter] Falling back to static service catalog', {
                accountId,
                error: reason,
            });
            return {
                services: AUSPOST_SERVICE_CATALOG,
                updatedAt: AUSPOST_SERVICE_CATALOG_UPDATED_AT,
                source: 'static_fallback',
                warning: `Live account service discovery failed. Showing static catalog values. Reason: ${reason}`,
            };
        }
    }

    // Label creation is handled via createShipment + createLabelRequest instead.
    // The two-step flow: (1) createShipment to register the shipment, (2) createLabelRequest to generate the label.

    async validateShipment(accountId: string, request: AusPostLabelRequest) {
        const credentials = await this.getCredentials(accountId);
        await this.validateShipmentWithCredentials(credentials, request);
        return { ok: true, status: 'valid' };
    }

    async createShipment(accountId: string, request: AusPostLabelRequest) {
        const credentials = await this.getCredentials(accountId);
        if (!credentials.endpoints.createShipment) throw new Error('AusPost shipment creation endpoint mapping is not configured yet');
        const payload = this.buildShipmentValidationPayload(credentials, request);
        const response = await this.request(credentials, credentials.endpoints.createShipment, {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        return {
            status: 'created',
            carrier: 'AUSPOST',
            shipment: this.extractShipment(response),
            rawResponse: response,
        };
    }

    async createLabelRequest(accountId: string, request: AusPostCreateLabelRequest) {
        const credentials = await this.getCredentials(accountId);
        if (!credentials.endpoints.labels) throw new Error('AusPost label creation endpoint mapping is not configured yet');
        const response = await this.request(credentials, credentials.endpoints.labels, {
            method: 'POST',
            body: JSON.stringify(this.buildLabelRequestPayload(request)),
        });

        return {
            status: 'requested',
            carrier: 'AUSPOST',
            labelRequest: this.extractLabelRequest(response),
            rawResponse: response,
        };
    }

    async getLabelRequest(accountId: string, requestId: string) {
        const credentials = await this.getCredentials(accountId);
        if (!credentials.endpoints.labelPdf) throw new Error('AusPost label PDF endpoint mapping is not configured yet');
        const response = await this.request(credentials, this.applyTemplate(credentials.endpoints.labelPdf, { request_id: requestId, requestId }), { method: 'GET' });
        return {
            status: 'fetched',
            carrier: 'AUSPOST',
            labelRequest: this.extractLabelRequest(response),
            rawResponse: response,
        };
    }

    async downloadLabelPdf(url: string) {
        const labelUrl = this.stringConfig(url);
        if (!labelUrl) throw new Error('AusPost label PDF URL is missing');
        const parsed = new URL(labelUrl);
        if (parsed.protocol !== 'https:') throw new Error('AusPost label PDF URL must use HTTPS');
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.16.') || hostname.startsWith('169.254.') || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
            throw new Error('AusPost label PDF URL points to an internal or private address');
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(labelUrl, { signal: controller.signal });
            if (!response.ok) throw new Error(`AusPost label PDF download failed (${response.status})`);
            return Buffer.from(await response.arrayBuffer());
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async validateAddress(accountId: string, address: Record<string, unknown>) {
        const credentials = await this.getCredentials(accountId);
        if (!credentials.endpoints.validateSuburb) throw new Error('AusPost suburb validation endpoint mapping is not configured yet');
        const suburb = this.stringConfig(address.suburb);
        const state = this.stringConfig(address.state);
        const postcode = this.stringConfig(address.postcode);
        if (!suburb || !state || !postcode) throw new Error('Suburb, state, and postcode are required before validating an AusPost address');

        const response = await this.request<Record<string, unknown>>(credentials, this.applyTemplate(credentials.endpoints.validateSuburb, {
            suburb,
            state: state.toUpperCase(),
            postcode,
        }), { method: 'GET' });

        return {
            found: response.found === true,
            results: Array.isArray(response.results) ? response.results.map((result) => String(result)) : [],
            rawResponse: response,
        };
    }

    async refreshTracking(accountId: string, trackingNumber: string) {
        const credentials = await this.getCredentials(accountId);
        if (!credentials.endpoints.tracking) throw new Error('AusPost tracking endpoint mapping is not configured yet');
        const response = await this.request(credentials, this.applyTemplate(credentials.endpoints.tracking, { trackingNumber, tracking_ids: trackingNumber }), { method: 'GET' });
        return this.extractTrackingEvents(response);
    }

    async cancelShipment(accountId: string, shipmentId: string): Promise<AusPostCancelShipmentResult> {
        const credentials = await this.getCredentials(accountId);
        if (!credentials.endpoints.cancellation) throw new Error('AusPost cancellation endpoint mapping is not configured yet');
        const resolvedShipmentId = this.stringConfig(shipmentId);
        if (!resolvedShipmentId) throw new Error('Carrier shipment ID is required before cancellation');
        const response = await this.request(credentials, this.applyTemplate(credentials.endpoints.cancellation, { shipment_id: resolvedShipmentId, shipmentId: resolvedShipmentId }), {
            method: 'DELETE',
        });
        return {
            status: 'cancelled',
            carrier: 'AUSPOST',
            shipmentId: resolvedShipmentId,
            rawResponse: response,
        };
    }

    private async getCredentials(accountId: string): Promise<AusPostCredentials> {
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST', isEnabled: true } });
        if (!settings?.credentialsEncrypted) throw new Error('AusPost credentials are not configured');

        let decrypted: { apiKey?: string; apiSecret?: string } = {};
        try {
            decrypted = JSON.parse(decrypt(settings.credentialsEncrypted));
        } catch (parseError) {
            Logger.warn('[AusPostAdapter] Failed to parse decrypted credentials', { error: parseError });
            throw new Error('AusPost credentials are corrupted');
        }
        if (!decrypted.apiKey) throw new Error('AusPost API key is not configured');

        const config = (settings.config as Record<string, unknown> | null) || {};
        const accountNumber = this.stringConfig(config.accountNumber);
        if (!accountNumber) throw new Error('AusPost account number is not configured');
        return {
            apiKey: decrypted.apiKey,
            apiSecret: decrypted.apiSecret,
            accountNumber,
            baseUrl: this.stringConfig(config.apiBaseUrl) || DEFAULT_BASE_URL,
            environment: config.apiEnvironment === 'sandbox' ? 'sandbox' : 'production',
            senderAddress: (settings.senderAddress as Record<string, unknown> | null) || {},
            defaultDomesticService: this.stringConfig(config.defaultDomesticService),
            paymentMethod: this.paymentMethodConfig(config.paymentMethod),
            endpoints: {
                test: this.stringConfig(config.testEndpointPath) || DEFAULT_ENDPOINTS.test,
                rates: this.stringConfig(config.ratesEndpointPath) || DEFAULT_ENDPOINTS.rates,
                labels: this.stringConfig(config.labelsEndpointPath) || DEFAULT_ENDPOINTS.labels,
                labelPdf: this.stringConfig(config.labelPdfEndpointPath) || DEFAULT_ENDPOINTS.labelPdf,
                tracking: this.stringConfig(config.trackingEndpointPath) || DEFAULT_ENDPOINTS.tracking,
                cancellation: this.stringConfig(config.cancellationEndpointPath) || DEFAULT_ENDPOINTS.cancellation,
                validateSuburb: this.stringConfig(config.validateSuburbEndpointPath) || DEFAULT_ENDPOINTS.validateSuburb,
                validateShipment: this.stringConfig(config.validateShipmentEndpointPath) || DEFAULT_ENDPOINTS.validateShipment,
                createShipment: this.stringConfig(config.createShipmentEndpointPath) || DEFAULT_ENDPOINTS.createShipment,
                createOrder: this.stringConfig(config.createOrderEndpointPath) || DEFAULT_ENDPOINTS.createOrder,
            },
        };
    }

    async request<T>(credentials: AusPostCredentials, path: string, init: RequestInit = {}): Promise<T> {
        const baseUrl = credentials.baseUrl;
        if (!baseUrl) throw new Error('AusPost API base URL is not configured');

        const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(credentials.accountNumber ? { 'account-number': credentials.accountNumber } : {}),
            ...(init.headers as Record<string, string> | undefined),
        };

        headers.Authorization = `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret || ''}`).toString('base64')}`;

        const method = String(init.method || 'GET').toUpperCase();
        const endpointPath = `/${path.replace(/^\//, '')}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(`${baseUrl.replace(/\/$/, '')}${endpointPath}`, { ...init, headers, signal: controller.signal });
            const body = await response.text();
            const parsed = body ? this.parseBody(body) : null;
            if (!response.ok) {
                Logger.error('[AusPostAdapter] Carrier request failed', {
                    environment: credentials.environment,
                    accountNumber: credentials.accountNumber,
                    method,
                    endpointPath,
                    status: response.status,
                    error: this.errorMessage(parsed),
                });
                throw new Error(`AusPost API request failed (${response.status} ${method} ${endpointPath}): ${this.errorMessage(parsed)}`);
            }
            return parsed as T;
        } catch (error: any) {
            if (error?.name === 'AbortError') throw new Error('AusPost API request timed out');
            if (!String(error?.message || '').includes('AusPost API request failed')) {
                Logger.error('[AusPostAdapter] Carrier request transport failure', {
                    environment: credentials.environment,
                    accountNumber: credentials.accountNumber,
                    method,
                    endpointPath,
                    error: error?.message || 'Unknown transport error',
                });
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private parseBody(body: string) {
        try {
            return JSON.parse(body);
        } catch {
            return body;
        }
    }

    private errorMessage(body: unknown) {
        if (!body) return 'No response body';
        if (typeof body === 'string') return body.slice(0, 500);
        if (typeof body === 'object' && 'error_description' in body) return String((body as { error_description?: unknown }).error_description);
        if (typeof body === 'object' && 'message' in body) return String((body as { message?: unknown }).message);
        if (typeof body === 'object' && 'error' in body) return String((body as { error?: unknown }).error);
        if (typeof body === 'object' && 'errors' in body && Array.isArray((body as { errors?: unknown[] }).errors)) {
            const first = (body as { errors?: unknown[] }).errors?.[0];
            if (first && typeof first === 'object' && 'message' in first) return String((first as { message?: unknown }).message);
        }
        try { return JSON.stringify(body).slice(0, 500); } catch { return String(body).slice(0, 500); }
    }

    private sanitizedErrorReason(error: unknown) {
        const raw = error instanceof Error ? error.message : String(error || 'Unknown error');
        return raw.replace(/\s+/g, ' ').trim().slice(0, 240) || 'Unknown error';
    }

    private stringConfig(value: unknown) {
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    private paymentMethodConfig(value: unknown): 'CHARGE_ACCOUNT' | 'CREDIT_CARD' | 'PAYPAL' | undefined {
        return value === 'CHARGE_ACCOUNT' || value === 'CREDIT_CARD' || value === 'PAYPAL' ? value : undefined;
    }

    private applyTemplate(path: string, values: Record<string, string>) {
        return Object.entries(values).reduce((current, [key, value]) => current.replaceAll(`{${key}}`, encodeURIComponent(value)), path);
    }

    private buildShipmentRatePayload(credentials: AusPostCredentials, request: AusPostRateRequest) {
        return this.buildShipmentPayload(credentials, request, { includeProduct: false, requireProduct: false, errorContext: 'requesting AusPost rates' });
    }

    private buildShipmentValidationPayload(credentials: AusPostCredentials, request: AusPostRateRequest) {
        return this.buildShipmentPayload(credentials, request, { includeProduct: true, requireProduct: true, errorContext: 'validating an AusPost shipment' });
    }

    private buildShipmentPayload(credentials: AusPostCredentials, request: AusPostRateRequest, options: { includeProduct: boolean; requireProduct: boolean; errorContext: string }) {
        const dimensions = request.dimensions || {};
        const weight = this.gramsToKg(dimensions.weightGrams);
        if (!weight) throw new Error(`Package weight is required before ${options.errorContext}`);

        const item: Record<string, unknown> = {
            item_reference: this.truncate(`ORDER-${request.wooOrderId}-1`, 50),
            weight,
            contains_dangerous_goods: false,
            authority_to_leave: true,
        };
        const productId = this.stringConfig(request.serviceCode) || credentials.defaultDomesticService;
        if (options.includeProduct && productId) item.product_id = productId;
        if (options.requireProduct && !productId) throw new Error(`AusPost service code is required before ${options.errorContext}`);

        const length = this.mmToCm(dimensions.lengthMm);
        const width = this.mmToCm(dimensions.widthMm);
        const height = this.mmToCm(dimensions.heightMm);
        if (length) item.length = length;
        if (width) item.width = width;
        if (height) item.height = height;

        return {
            shipments: [{
                shipment_reference: this.truncate(`OVERSEEK-${request.wooOrderId}`, 50),
                customer_reference_1: this.truncate(`Woo order ${request.wooOrderId}`, 50),
                email_tracking_enabled: false,
                ...(credentials.paymentMethod ? { payment_method: credentials.paymentMethod } : {}),
                from: this.toAusPostAddress(credentials.senderAddress, true),
                to: this.toAusPostAddress(request.address, false),
                items: [item],
            }],
        };
    }

    private async validateShipmentWithCredentials(credentials: AusPostCredentials, request: AusPostRateRequest) {
        if (!credentials.endpoints.validateShipment) throw new Error('AusPost shipment validation endpoint mapping is not configured yet');
        const payload = this.buildShipmentValidationPayload(credentials, request);
        await this.request(credentials, credentials.endpoints.validateShipment, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    private toAusPostAddress(address: Record<string, unknown>, sender: boolean) {
        const lines = [this.stringConfig(address.address1), this.stringConfig(address.address2)].filter(Boolean) as string[];
        if (lines.length === 0) throw new Error(`${sender ? 'Sender' : 'Recipient'} address line is required before building an AusPost shipment`);
        const suburb = this.stringConfig(address.suburb);
        const state = this.stringConfig(address.state);
        const postcode = this.stringConfig(address.postcode);
        if (!suburb || !state || !postcode) throw new Error(`${sender ? 'Sender' : 'Recipient'} suburb, state, and postcode are required before building an AusPost shipment`);

        return {
            name: this.truncate(this.stringConfig(address.name) || (sender ? 'Sender' : 'Customer'), sender ? 40 : 35),
            ...(this.stringConfig(address.company) ? { business_name: this.truncate(this.stringConfig(address.company), 40) } : {}),
            type: sender ? 'MERCHANT_LOCATION' : 'STANDARD_ADDRESS',
            lines: lines.slice(0, 3).map((line, index) => this.truncate(line, index === 1 ? 60 : 40)),
            suburb: this.truncate(suburb, sender ? 40 : 35),
            state: this.truncate(state.toUpperCase(), 3),
            postcode: this.truncate(postcode, 4),
            ...(this.stringConfig(address.phone) ? { phone: this.truncate(this.stringConfig(address.phone), 20) } : {}),
            ...(this.stringConfig(address.email) ? { email: this.truncate(this.stringConfig(address.email), 50) } : {}),
        };
    }

    private extractRates(response: unknown) {
        const rates: Array<Record<string, unknown>> = [];
        const object = response && typeof response === 'object' ? response as Record<string, any> : {};
        for (const shipment of Array.isArray(object.shipments) ? object.shipments : []) {
            const summary = shipment.shipment_summary || {};
            for (const item of Array.isArray(shipment.items) ? shipment.items : []) {
                if (Array.isArray(item.prices)) {
                    for (const price of item.prices) {
                        rates.push({
                            productId: price.product_id,
                            productType: price.product_type,
                            serviceName: price.product_type || price.product_name || price.product_id,
                            totalCost: price.calculated_price,
                            totalGst: price.calculated_gst,
                            raw: price,
                        });
                    }
                }
                if (summary.total_cost !== undefined) {
                    rates.push({
                        productId: item.product_id,
                        serviceName: item.product_type || item.product_name || item.product_id,
                        totalCost: summary.total_cost,
                        shippingCost: summary.shipping_cost,
                        totalGst: summary.total_gst,
                        status: summary.status,
                        raw: shipment,
                    });
                }
            }
        }

        for (const item of Array.isArray(object.items) ? object.items : []) {
            for (const price of Array.isArray(item.prices) ? item.prices : []) {
                rates.push({
                    productId: price.product_id,
                    productType: price.product_type,
                    serviceName: price.product_type || price.product_name || price.product_id,
                    totalCost: price.calculated_price,
                    totalGst: price.calculated_gst,
                    raw: price,
                });
            }
        }

        return rates;
    }

    private extractShipment(response: unknown) {
        const object = response && typeof response === 'object' ? response as Record<string, any> : {};
        const shipment = Array.isArray(object.shipments) ? object.shipments[0] || {} : object.shipment || object;
        const item = Array.isArray(shipment.items) ? shipment.items[0] || {} : {};
        const trackingDetails = item.tracking_details || {};
        const summary = shipment.shipment_summary || item.item_summary || {};

        return {
            carrierShipmentId: shipment.shipment_id || shipment.id || null,
            shipmentReference: shipment.shipment_reference || null,
            carrierItemId: item.item_id || null,
            productId: item.product_id || null,
            trackingNumber: trackingDetails.article_id || trackingDetails.consignment_id || trackingDetails.barcode_id || null,
            consignmentId: trackingDetails.consignment_id || null,
            articleId: trackingDetails.article_id || null,
            barcodeId: trackingDetails.barcode_id || null,
            totalCost: summary.total_cost || null,
            totalGst: summary.total_gst || null,
            status: summary.status || null,
        };
    }

    private buildLabelRequestPayload(request: AusPostCreateLabelRequest) {
        const shipmentId = this.stringConfig(request.shipmentId);
        if (!shipmentId) throw new Error('AusPost shipment ID is required before requesting labels');

        return {
            preferences: [{
                type: 'PRINT',
                groups: [{
                    group: request.printGroup,
                    layout: request.layout,
                    branded: request.branded,
                    left_offset: request.leftOffset || 0,
                    top_offset: request.topOffset || 0,
                }],
            }],
            shipments: [{ shipment_id: shipmentId }],
            ...(request.waitForLabelUrl ? { wait_for_label_url: true } : {}),
        };
    }

    private extractLabelRequest(response: unknown) {
        const object = response && typeof response === 'object' ? response as Record<string, any> : {};
        const label = Array.isArray(object.labels) ? object.labels[0] || {} : object.label || object;
        return {
            requestId: label.request_id || object.request_id || object.requestId || label.id || null,
            status: label.status || object.status || null,
            url: label.url || object.url || null,
            message: object.message || label.message || null,
            code: object.code || label.code || null,
            shipmentIds: label.shipment_ids || object.shipment_ids || null,
        };
    }

    private mmToCm(value: unknown) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
        return Number((numeric / 10).toFixed(1));
    }

    private gramsToKg(value: unknown) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
        return Number((numeric / 1000).toFixed(3));
    }

    private truncate(value: string | undefined, length: number) {
        return String(value || '').slice(0, length);
    }

    private extractTrackingEvents(response: unknown) {
        const candidates = this.findEventArray(response);
        return candidates.map((event: any) => ({
            eventCode: String(event.eventCode || event.code || event.statusCode || event.event_code || event.id || ''),
            status: event.status || event.statusDescription || event.status_description || event.description || null,
            description: event.description || event.eventDescription || event.event_description || event.statusDescription || null,
            location: event.location || event.locationName || event.location_name || event.facility || null,
            occurredAt: event.occurredAt || event.eventDateTime || event.event_date_time || event.date || event.datetime || null,
            rawEvent: event,
        }));
    }

    private findEventArray(value: unknown, depth = 0): any[] {
        if (depth > 20) return [];
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== 'object') return [];
        const object = value as Record<string, unknown>;
        for (const key of ['events', 'trackingEvents', 'tracking_events', 'items', 'results']) {
            if (Array.isArray(object[key])) return object[key] as any[];
        }
        for (const nested of Object.values(object)) {
            const events = this.findEventArray(nested, depth + 1);
            if (events.length > 0) return events;
        }
        return [];
    }
}

export const ausPostShippingTrackingAdapter = new AusPostShippingTrackingAdapter();
