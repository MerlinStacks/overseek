import { useLayoutEffect, type KeyboardEvent, type RefObject } from 'react';
import { RichTextEditor } from '../common/RichTextEditor';
import './MobileReplyEditor.css';

interface Props {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    richText: boolean;
    expanded: boolean;
}

/** Keep the same editor mounted while expanding, preserving selection and undo history. */
export function MobileReplyEditor({ value, onChange, onKeyDown, inputRef, richText, expanded }: Props) {
    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!input || richText) return;
        const resize = () => {
            input.style.height = expanded ? '100%' : 'auto';
            if (!expanded) input.style.height = `${input.scrollHeight}px`;
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [value, expanded, richText, inputRef]);

    return (
        <div className={`mobile-reply-editor min-w-0 ${expanded ? 'is-expanded min-h-0 flex-1' : 'w-full'}`} onKeyDownCapture={onKeyDown}>
            {richText ? (
                <RichTextEditor
                    value={value}
                    onChange={onChange}
                    variant="compact"
                    features={['bold', 'italic', 'list']}
                    ariaLabel="Reply message"
                    placeholder="Write your email reply…"
                    disableEnterSubmit
                />
            ) : (
                <textarea
                    ref={inputRef}
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    aria-label="Reply message"
                    enterKeyHint="enter"
                    placeholder="Write your reply…"
                    rows={3}
                    className="block min-h-[72px] w-full resize-none overflow-y-auto bg-transparent text-base leading-6 text-white placeholder-slate-500 focus:outline-none"
                />
            )}
        </div>
    );
}
