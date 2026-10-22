import { LinkNode, type SerializedLinkNode } from '@lexical/link';

/** Lexical normally prefixes schemeless links with https://. Email destination
 * placeholders must stay exact so delivery can substitute a working URL. */
export class EmailLinkNode extends LinkNode {
    static getType() { return 'email-link'; }
    static clone(node: EmailLinkNode) { return new EmailLinkNode(node.getURL(), { target: node.getTarget(), rel: node.getRel(), title: node.getTitle() }, node.__key); }
    static importJSON(value: SerializedLinkNode) { return new EmailLinkNode().updateFromJSON(value); }
    sanitizeUrl(url: string) {
        if (/^\{\{(?:unsubscribe_url|unsubscribe_list_url|preferences_url|store_url)\}\}$/.test(url)) return url;
        return super.sanitizeUrl(url);
    }
}
