import { $isLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode } from '@lexical/rich-text';
import { $getRoot, $getState, $setState, $isElementNode, $isTextNode, createState, ParagraphNode, TextNode, type DOMConversionMap, type DOMExportOutputMap, type HTMLConfig, type LexicalEditor, type ElementNode } from 'lexical';
import { safeEmailUrl } from '../../../lib/emailDesignerV2';

// Lexical's stock HTML conversions do not retain paragraph/heading styles.
// Preserve the sanitized email styles in node state, including through undo,
// rather than copying DOM styles back by paragraph index after every edit.
const imports: DOMConversionMap = {};
const exports: DOMExportOutputMap = new Map();
const emailStyle = createState('emailStyle', { parse: value => typeof value === 'string' ? value : '' });
for (const NodeClass of [ParagraphNode, HeadingNode, LinkNode, ListNode, ListItemNode, TextNode]) {
    const nodeConfig = NodeClass.prototype.$config() as Record<string, { importDOM?: DOMConversionMap }>;
    const conversions = NodeClass.importDOM?.() || Object.values(nodeConfig).find(config => config.importDOM)?.importDOM || {};
    for (const [tag, factory] of Object.entries(conversions)) {
        const previous = imports[tag];
        imports[tag] = element => {
            const original = factory(element);
            if (!original) return previous?.(element) || null;
            return {
                priority: 4,
                conversion: dom => {
                    const output = original.conversion(dom);
                    if (!output) return output;
                    const style = dom.style?.cssText || '';
                    const nodes = Array.isArray(output.node) ? output.node : output.node ? [output.node] : [];
                    for (const node of nodes) {
                        if ($isElementNode(node) && style) $setState(node, emailStyle, style);
                        else if ($isTextNode(node) && style) node.setStyle(style);
                    }
                    // Span/strong/em converters often return no node. Apply
                    // their formatting to descendant text; inner styles win.
                    const forChild = output.forChild;
                    return {
                        ...output,
                        forChild: (child, parent) => {
                            const converted = forChild ? forChild(child, parent) : child;
                            if (nodes.length === 0 && $isTextNode(converted) && style) converted.setStyle(`${style};${converted.getStyle()}`);
                            return converted;
                        },
                    };
                },
            };
        };
    }
    exports.set(NodeClass, (editor, node) => {
        const output = node.exportDOM(editor);
        if (output.element instanceof HTMLElement && ($isElementNode(node) || $isTextNode(node))) {
            // exportDOM's active alignment/formatting wins over imported style.
            const style = $isElementNode(node) ? $getState(node, emailStyle) : node.getStyle();
            output.element.style.cssText = `${style};${output.element.style.cssText}`;
            if ($isLinkNode(node)) output.element.setAttribute('href', safeEmailUrl(node.getURL()));
        }
        return output;
    });
}

export const emailTextHtmlConfig: HTMLConfig = { import: imports, export: exports };

/** ElementNode does not apply arbitrary styles to its live DOM. Keep the live
 * editor in sync with the same serializable styles used by HTML export. */
export function registerEmailTextStyles(editor: LexicalEditor): () => void {
    const apply = () => editor.getEditorState().read(() => {
        const visit = (node: ElementNode) => {
            for (const child of node.getChildren()) {
                if (!$isElementNode(child)) continue;
                const element = editor.getElementByKey(child.getKey());
                const style = $getState(child, emailStyle);
                if (element && style) {
                    element.style.cssText = style;
                    if (child.getFormatType()) element.style.textAlign = child.getFormatType();
                }
                visit(child);
            }
        };
        visit($getRoot());
    });
    apply();
    return editor.registerUpdateListener(apply);
}
