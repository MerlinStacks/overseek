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
            className={cn(
                "flex gap-2",
                isAgent ? "justify-end" : "justify-start"
            )}
        >
            {/* Avatar */}
            {!isAgent && (
                <div className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                    {name?.charAt(0).toUpperCase() || 'C'}
                </div>
            )}

            {/* Typing Bubble */}
            <div
                className={cn(
                    "rounded-2xl px-4 py-3 shadow-sm",
                    isAgent
                        ? "bg-blue-600 rounded-br-md"
                        : "bg-white rounded-bl-md border border-gray-100"
                )}
            >
                <div className="flex items-center gap-1">
                    <span
                        className={cn(
                            "w-2 h-2 rounded-full animate-bounce",
                            isAgent ? "bg-blue-300" : "bg-gray-400"
                        )}
                        style={{ animationDelay: '0ms' }}
                    />
                    <span
                        className={cn(
                            "w-2 h-2 rounded-full animate-bounce",
                            isAgent ? "bg-blue-300" : "bg-gray-400"
                        )}
                        style={{ animationDelay: '150ms' }}
                    />
                    <span
                        className={cn(
                            "w-2 h-2 rounded-full animate-bounce",
                            isAgent ? "bg-blue-300" : "bg-gray-400"
                        )}
                        style={{ animationDelay: '300ms' }}
                    />
                </div>
            </div>

            {/* Agent Avatar */}
            {isAgent && (
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                    ME
                </div>
            )}
        </div>
    );
}
