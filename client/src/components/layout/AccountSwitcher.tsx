import { ChevronsUpDown, Plus, Check } from 'lucide-react';
import { useState, useRef, useEffect, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../../context/AccountContext';

export function AccountSwitcher() {
    const { accounts, currentAccount, setCurrentAccount } = useAccount();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    const [failedLogo, setFailedLogo] = useState<string | null>(null);
    const navigate = useNavigate();

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('pointerdown', handleClickOutside);
        return () => document.removeEventListener('pointerdown', handleClickOutside);
    }, []);

    if (!currentAccount) return null;
    const brandName = currentAccount.appearance?.appName?.trim() || currentAccount.name?.trim() || 'OverSeek';
    const logoUrl = currentAccount.appearance?.logoUrl?.trim();
    const logoKey = `${currentAccount.id}:${logoUrl}`;

    return (
        <div className="relative mb-6" ref={containerRef}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}
            onKeyDown={event => {
                if (event.key === 'Escape' && isOpen) {
                    event.preventDefault(); event.stopPropagation(); setIsOpen(false); triggerRef.current?.focus();
                }
            }}>
            <button
                ref={triggerRef} type="button" aria-label={`Switch account: ${currentAccount.name}`}
                aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined}
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-700/50 transition-all duration-200 group"
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    {logoUrl && failedLogo !== logoKey ? <img key={logoKey} src={logoUrl} alt="" onError={() => setFailedLogo(logoKey)} className="w-9 h-9 rounded-lg bg-white object-contain p-1 shrink-0" /> : <div className="w-9 h-9 rounded-lg bg-[var(--primary-color)] text-[var(--primary-foreground)] flex items-center justify-center font-semibold text-sm shrink-0">
                        {brandName.charAt(0).toUpperCase()}
                    </div>}
                    <div className="text-left overflow-hidden">
                        <div className="text-sm font-semibold text-slate-800 dark:text-white truncate">{brandName}</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 truncate">{currentAccount.domain || 'No Domain'}</div>
                    </div>
                </div>
                <ChevronsUpDown size={16} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div id={panelId} role="group" aria-label="My Accounts" className="absolute top-full left-0 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden z-20 animate-scale-in">
                    <div className="p-1.5">
                        <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 px-3 py-2 uppercase tracking-wider">
                            My Accounts
                        </div>

                        {accounts.map(account => (
                            <button
                                type="button" aria-pressed={account.id === currentAccount.id}
                                key={account.id}
                                onClick={() => {
                                    setCurrentAccount(account);
                                    setIsOpen(false);
                                    triggerRef.current?.focus();
                                }}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all duration-200"
                            >
                                <span className={account.id === currentAccount.id ? "text-slate-900 dark:text-white font-medium" : "text-slate-600 dark:text-slate-300"}>
                                    {account.appearance?.appName?.trim() || account.name}
                                </span>
                                {account.id === currentAccount.id && <Check size={14} className="text-[var(--brand-text)]" />}
                            </button>
                        ))}
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-700 p-1.5">
                        <button
                            type="button"
                            onClick={() => { setIsOpen(false); navigate('/setup?addNew=true'); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[var(--brand-text)] hover:bg-[var(--brand-subtle)] rounded-lg transition-colors font-medium"
                        >
                            <Plus size={14} />
                            Create New Account
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
