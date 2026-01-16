import { ChevronsUpDown, Plus, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../../context/AccountContext';

export function AccountSwitcher() {
    const { accounts, currentAccount, setCurrentAccount } = useAccount();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!currentAccount) return null;

    return (
        <div className="relative mb-6" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-700/50 transition-all duration-200 group"
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-lg shadow-blue-500/20">
                        {currentAccount.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left overflow-hidden">
                        <div className="text-sm font-semibold text-slate-800 dark:text-white truncate">{currentAccount.name}</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 truncate">{currentAccount.domain || 'No Domain'}</div>
                    </div>
                </div>
                <ChevronsUpDown size={16} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full left-0 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden z-20 animate-scale-in">
                    <div className="p-1.5">
                        <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 px-3 py-2 uppercase tracking-wider">
                            My Accounts
                        </div>

                        {accounts.map(account => (
                            <button
                                key={account.id}
                                onClick={() => {
                                    setCurrentAccount(account);
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all duration-200"
                            >
                                <span className={account.id === currentAccount.id ? "text-slate-900 dark:text-white font-medium" : "text-slate-600 dark:text-slate-300"}>
                                    {account.name}
                                </span>
                                {account.id === currentAccount.id && <Check size={14} className="text-blue-500" />}
                            </button>
                        ))}
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-700 p-1.5">
                        <button
                            onClick={() => navigate('/setup?addNew=true')}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-all duration-200 font-medium"
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
