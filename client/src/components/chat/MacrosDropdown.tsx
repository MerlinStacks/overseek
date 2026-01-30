/**
 * MacrosDropdown - Quick action buttons for inbox automations.
 * Displays available macros and executes on click.
 */
import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { Zap, ChevronDown, Play } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { cn } from '../../utils/cn';

interface Macro {
    id: string;
    name: string;
    icon?: string;
    color?: string;
    actions: Array<{ type: string; userId?: string; labelId?: string }>;
}

interface MacrosDropdownProps {
    conversationId: string;
    onExecuted?: () => void;
}

export function MacrosDropdown({ conversationId, onExecuted }: MacrosDropdownProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [macros, setMacros] = useState<Macro[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isExecuting, setIsExecuting] = useState<string | null>(null);

    useEffect(() => {
        fetchMacros();
    }, [currentAccount?.id]);

    const fetchMacros = async () => {
        if (!currentAccount?.id || !token) return;
        try {
            const res = await fetch('/api/chat/macros', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) setMacros(await res.json());
        } catch (e) {
            Logger.error('Failed to fetch macros:', { error: e });
        }
    };

    const executeMacro = async (macroId: string) => {
        setIsExecuting(macroId);
        try {
            const res = await fetch(`/api/chat/macros/${macroId}/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ conversationId })
            });
            if (res.ok) {
                setIsOpen(false);
                onExecuted?.();
            }
        } catch (e) {
            Logger.error('Failed to execute macro:', { error: e });
        } finally {
            setIsExecuting(null);
        }
    };

    if (macros.length === 0) return null;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Quick Actions"
            >
                <Zap size={14} />
                <ChevronDown size={12} />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Quick Actions
                        </div>
                        {macros.map((macro) => (
                            <button
                                key={macro.id}
                                onClick={() => executeMacro(macro.id)}
                                disabled={isExecuting === macro.id}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors",
                                    isExecuting === macro.id && "opacity-50"
                                )}
                            >
                                <div
                                    className="w-5 h-5 rounded flex items-center justify-center text-white text-[10px]"
                                    style={{ backgroundColor: macro.color || '#6366f1' }}
                                >
                                    <Play size={10} />
                                </div>
                                <span className="flex-1 text-left">{macro.name}</span>
                                <span className="text-[10px] text-gray-400">
                                    {macro.actions.length} action{macro.actions.length !== 1 ? 's' : ''}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
