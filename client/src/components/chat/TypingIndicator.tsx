/**
 * TypingIndicator - Animated typing dots bubble.
 * Displayed when someone is typing in the conversation.
 */
import { cn } from '../../utils/cn';

interface TypingIndicatorProps {
    /** Name of the person typing */
    name?: string;
    /** Whether this is from the agent side (right-aligned) */
    isAgent?: boolean;
}

/**
 * TypingIndicator component with bouncing dots animation.
 */
export function TypingIndicator({ name, isAgent = false }: TypingIndicatorProps) {
    return (
        <div
            role="status" aria-live="polite"
            className={cn(
                "flex gap-2",
                isAgent ? "justify-end" : "justify-start"
            )}
        >
            <span className="sr-only">{name?.trim() || (isAgent ? 'Agent' : 'Customer')} is typing</span>
            {/* Avatar */}
            {!isAgent && (
                <div aria-hidden="true" className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center text-white text-xs font-medium shrink-0">
                    {name?.charAt(0).toUpperCase() || 'C'}
                </div>
            )}

            {/* Typing Bubble */}
            <div
                className={cn(
                    "rounded-xl px-4 py-3 shadow-xs",
                    isAgent
                        ? "bg-[var(--primary-color)] rounded-br-md"
                        : "bg-white dark:bg-slate-800 rounded-bl-md border border-gray-100 dark:border-slate-700"
                )}
            >
                <div aria-hidden="true" className="flex items-center gap-1">
                    <span
                        className={cn(
                            "w-2 h-2 rounded-full animate-bounce motion-reduce:animate-none",
                            isAgent ? "bg-[var(--primary-foreground)]" : "bg-gray-400"
                        )}
                        style={{ animationDelay: '0ms' }}
                    />
                    <span
                        className={cn(
                            "w-2 h-2 rounded-full animate-bounce motion-reduce:animate-none",
                            isAgent ? "bg-[var(--primary-foreground)]" : "bg-gray-400"
                        )}
                        style={{ animationDelay: '150ms' }}
                    />
                    <span
                        className={cn(
                            "w-2 h-2 rounded-full animate-bounce motion-reduce:animate-none",
                            isAgent ? "bg-[var(--primary-foreground)]" : "bg-gray-400"
                        )}
                        style={{ animationDelay: '300ms' }}
                    />
                </div>
            </div>

            {/* Agent Avatar */}
            {isAgent && (
                <div aria-hidden="true" className="w-7 h-7 rounded-full bg-[var(--primary-color)] flex items-center justify-center text-[var(--primary-foreground)] text-xs font-medium shrink-0">
                    {name?.trim().charAt(0).toUpperCase() || 'A'}
                </div>
            )}
        </div>
    );
}
