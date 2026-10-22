import type { EmailDesignV2Envelope } from './emailDesign';
import { EMAIL_RENDERER_VERSION } from './emailDesign';

const blockTypes = new Set(['siteLogo', 'text', 'image', 'button', 'list', 'divider', 'spacer', 'product', 'newProducts', 'cartItems', 'cartLink', 'orderSummary', 'orderTracking', 'deliveryEstimate', 'address', 'coupon', 'review', 'menu', 'social', 'footer', 'rawHtml']);
export function assertEmailDesign(value: unknown): asserts value is EmailDesignV2Envelope {
    const design = value as any;
    const fail = () => { throw new Error('Invalid or unsupported email design'); };
    if (!design || design.engine !== 'overseek-v2' || design.version !== 1 || design.rendererVersion && design.rendererVersion !== EMAIL_RENDERER_VERSION || !design.document || !design.document.theme || !design.document.meta || !Array.isArray(design.document.sections) || design.document.sections.length > 100) fail();
    const ids = new Set<string>(); let blocks = 0;
    const id = (value: any) => { if (typeof value !== 'string' || !value || value.length > 200 || ids.has(value)) fail(); ids.add(value); };
    const styles = (source: any) => {
        for (const [key, value] of Object.entries(source || {})) {
            if (/^(?:.*Color|color|fontFamily|padding|align|verticalAlign|borderStyle|textDecoration|fontStyle)$/.test(key) && typeof value === 'string' && /[;"<>\\]|url\s*\(|expression/i.test(value)) fail();
            if (['width', 'height', 'size', 'fontWeight', 'fontSize', 'lineHeight', 'contentWidth', 'count'].includes(key) && value !== undefined && typeof value !== 'number') fail();
            if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 10000)) fail();
        }
    };
    if (typeof design.document.meta.title !== 'string' || !Number.isFinite(design.document.theme.contentWidth) || design.document.theme.contentWidth < 240 || design.document.theme.contentWidth > 1200) fail();
    styles(design.document.theme);
    for (const section of design.document.sections) {
        if (!section || !Array.isArray(section.columns) || section.columns.length < 1 || section.columns.length > 4) fail();
        id(section.id); styles(section);
        for (const column of section.columns) {
            if (!column || !Array.isArray(column.blocks) || !Number.isFinite(column.width) || column.width <= 0 || column.width > 100) fail();
            id(column.id); styles(column);
            for (const block of column.blocks) {
                if (!block || !blockTypes.has(block.type) || !block.props || typeof block.props !== 'object' || Array.isArray(block.props) || ++blocks > 1000) fail();
                id(block.id); styles(block.props);
                for (const item of Array.isArray(block.props.links) ? block.props.links : []) styles(item);
                if (block.type === 'list' && !Array.isArray(block.props.items)) fail();
                if (['text', 'footer', 'rawHtml'].includes(block.type) && typeof block.props.html !== 'string') fail();
            }
        }
    }
}
