import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDeliveryEstimateTagValues, resolveDeliveryEstimateEmailTokens, type DeliveryEstimateSnapshot } from '@overseek/core';
import { compileEmailDesignV2, createDefaultEmailDesignV2, createEmailDesignV2FromUnknown, getEmailDesignV2BlockLabel } from '../../../lib/emailDesignerV2';
import { createBlock, createPaletteBlock, paletteItems } from './blockFactory';
import { EMAIL_MERGE_TAGS } from './mergeTags';
import { LiveBlock } from './LiveBlock';
import { PreviewOrderContext } from './PreviewOrderContext';
import { applyPreviewMergeTags, createFallbackPreviewMergeContext } from '../EmailDesignEditorV2';

const snapshot: DeliveryEstimateSnapshot = {
    version: 1,
    capturedAt: '2026-09-22T00:00:00.000Z',
    timezone: 'Australia/Sydney',
    fulfilmentType: 'delivery',
    method: { methodId: 'flat_rate', instanceId: 1, rateId: 'flat_rate:1', title: 'Standard' },
    dispatch: { min: '2026-09-23', max: '2026-09-24' },
    delivery: { min: '2026-09-25', max: '2026-09-28' },
    collection: null,
};
const order = { deliveryEstimateSnapshot: snapshot };

function fixture(heading = '', showDispatch = true) {
    const design = createDefaultEmailDesignV2();
    const block = { ...createBlock('deliveryEstimate'), type: 'deliveryEstimate' as const, props: { heading, showDispatch } };
    design.document.sections = [{ id: 's', columns: [{ id: 'c', width: 100, blocks: [block] }] }];
    return { design, block };
}

describe('existing-order delivery estimate designer integration', () => {
    it('exposes a WooCommerce palette block and all ten shared scalar tags', () => {
        const block = createPaletteBlock('deliveryEstimate', 'Example Store');
        expect(block).toMatchObject({ type: 'deliveryEstimate', props: { heading: '', showDispatch: true } });
        expect(getEmailDesignV2BlockLabel(block)).toBe('Delivery Estimate');
        expect(paletteItems.find(item => item.key === block.type)?.group).toBe('WooCommerce');
        const tags = EMAIL_MERGE_TAGS.filter(tag => tag.value.startsWith('{{order.estimated'));
        expect(tags).toHaveLength(10);
        expect(tags.map(tag => tag.value.slice(2, -2)).sort()).toEqual(Object.keys(getDeliveryEstimateTagValues(order)).sort());
    });

    it('URI-encodes the heading and all theme colours and resolves escaped customer content', () => {
        const heading = 'Arrival <strong> & "details" }}';
        const { design } = fixture(heading, false);
        design.document.theme.fontFamily = 'Georgia, serif';
        const html = compileEmailDesignV2(design);
        expect(html).toContain(`heading:${encodeURIComponent(heading)} showDispatch:false`);
        const theme = design.document.theme;
        for (const [name, value] of Object.entries({ textColor: theme.textColor, mutedColor: theme.mutedTextColor, backgroundColor: theme.contentBackgroundColor, accentColor: theme.primaryColor, fontFamily: theme.fontFamily })) {
            expect(html).toContain(`${name}:${encodeURIComponent(value)}`);
        }
        const resolved = resolveDeliveryEstimateEmailTokens(html, order);
        expect(resolved).toContain('Arrival &lt;strong&gt; &amp; &quot;details&quot;');
        expect(resolved).not.toContain('{{delivery_estimate');
        expect(resolved).not.toContain('Estimated dispatch');
        expect(resolved).toContain('font-family:Georgia, serif;');
    });

    it('leaves exactly the same email shell as an empty column when the snapshot is missing or invalid', () => {
        const { design } = fixture('Customer-facing heading');
        const compiled = compileEmailDesignV2(design);
        design.document.sections[0].columns[0].blocks = [];
        const empty = compileEmailDesignV2(design);
        for (const missing of [null, {}, { deliveryEstimateSnapshot: null }, { deliveryEstimateSnapshot: { version: 2 } }]) {
            expect(resolveDeliveryEstimateEmailTokens(compiled, missing)).toBe(empty);
        }
    });

    it('preserves saved block props and layout through JSON save/reopen without changing existing designs', () => {
        const { design, block } = fixture('Ready soon', false);
        block.visibility = 'mobile';
        block.responsive = true;
        expect(createEmailDesignV2FromUnknown(JSON.parse(JSON.stringify(design)))).toEqual(design);
        const existing = createDefaultEmailDesignV2({ title: 'Existing design' });
        expect(createEmailDesignV2FromUnknown(JSON.parse(JSON.stringify(existing)))).toEqual(existing);
        expect(compileEmailDesignV2(existing)).not.toContain('delivery_estimate');
    });

    it('renders the loaded collection snapshot with automatic heading and only an editor placeholder when absent', () => {
        const { design, block } = fixture();
        const render = (value: unknown) => renderToStaticMarkup(<PreviewOrderContext.Provider value={value}><LiveBlock block={block} theme={design.document.theme} onUpdate={() => {}} /></PreviewOrderContext.Provider>);
        const html = render({ deliveryEstimateSnapshot: { ...snapshot, fulfilmentType: 'collection', delivery: null, collection: snapshot.delivery } });
        expect(html).toContain('Estimated collection');
        expect(html).toContain('25 Sept 2026');
        expect(html).not.toContain('Estimated delivery');
        expect(render(null)).toContain('No saved delivery estimate on preview order');
        expect(render(null)).not.toContain('2026');
    });

    it('resolves shared tokens and fallback syntax before other preview replacements without inventing dates', () => {
        const context = createFallbackPreviewMergeContext('https://example.com');
        const template = '{{order.estimatedDelivery}}|{{order.estimatedCollection}}|{{delivery_estimate}}|{{customer.firstName}}';
        expect(applyPreviewMergeTags(template, context)).toBe('|||Alex');
        const values = getDeliveryEstimateTagValues(order);
        expect(applyPreviewMergeTags('{{order.estimatedDelivery}}', { ...context, order })).toBe(values['order.estimatedDelivery']);
        expect(applyPreviewMergeTags('{{order.estimatedDelivery | fallback:"Pending & unconfirmed"}}', context)).toBe('Pending &amp; unconfirmed');
        expect(applyPreviewMergeTags('{{order.estimatedDelivery}}', {
            ...context,
            order: { deliveryEstimateSnapshot: null, rawData: { meta_data: [{ key: '_overseek_delivery_estimate_v1', value: snapshot }] } },
        })).toBe('');
        expect(context.orderDate).toBe('');
    });
});
