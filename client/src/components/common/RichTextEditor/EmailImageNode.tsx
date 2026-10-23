import { $getNodeByKey, DecoratorNode, type DOMConversionMap, type DOMExportOutput, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { JSX } from 'react';

type SerializedImage = Spread<{ src: string; alt: string; width: number; height?: number }, SerializedLexicalNode>;

export function validEmailImageUrl(value: string): boolean {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

function ImageView({ nodeKey, src, alt, width, height }: { nodeKey: NodeKey; src: string; alt: string; width: number; height?: number }) {
    const [editor] = useLexicalComposerContext();
    return <span className="group relative inline-block max-w-full align-middle">
        <img src={src} alt={alt} width={width} height={height} style={{ display: 'inline-block', verticalAlign: 'middle', maxWidth: '100%', height: height ? `${height}px` : 'auto' }} />
        <button type="button" aria-label={`Remove image: ${alt || 'image'}`} className="absolute right-0 top-0 rounded bg-white px-1 text-xs text-red-700 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={event => { event.preventDefault(); event.stopPropagation(); editor.update(() => { $getNodeByKey(nodeKey)?.remove(); }); }}>×</button>
    </span>;
}

/** Real image nodes keep footer images through HTML hydration, edits and undo. */
export class EmailImageNode extends DecoratorNode<JSX.Element> {
    __src: string;
    __alt: string;
    __width: number;
    __height?: number;
    static getType() { return 'email-image'; }
    static clone(node: EmailImageNode) { return new EmailImageNode(node.__src, node.__alt, node.__width, node.__height, node.__key); }
    constructor(src = '', alt = '', width = 200, height?: number, key?: NodeKey) { super(key); this.__src = src; this.__alt = alt; this.__width = width; this.__height = height; }
    static importJSON(value: SerializedImage) { return new EmailImageNode(value.src, value.alt, value.width, value.height); }
    exportJSON(): SerializedImage { return { ...super.exportJSON(), type: 'email-image', version: 1, src: this.__src, alt: this.__alt, width: this.__width, height: this.__height }; }
    static importDOM(): DOMConversionMap {
        return { img: element => validEmailImageUrl((element as HTMLImageElement).src) ? { priority: 1, conversion: dom => {
            const image = dom as HTMLImageElement;
            return { node: new EmailImageNode(image.src, image.alt, Math.min(600, Math.max(1, Number(image.getAttribute('width')) || 200)), Number(image.getAttribute('height')) || undefined) };
        } } : null };
    }
    exportDOM(): DOMExportOutput {
        const image = document.createElement('img');
        image.src = this.__src; image.alt = this.__alt; image.width = this.__width;
        if (this.__height) image.height = this.__height;
        image.style.cssText = `display:inline-block;vertical-align:middle;max-width:100%;height:${this.__height ? `${this.__height}px` : 'auto'};border:0;`;
        return { element: image };
    }
    createDOM() { return document.createElement('span'); }
    updateDOM() { return false; }
    isInline() { return true; }
    decorate() { return <ImageView nodeKey={this.__key} src={this.__src} alt={this.__alt} width={this.__width} height={this.__height} />; }
}
