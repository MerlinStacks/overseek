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
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors group"
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 rounded bg-blue-500 flex items-center justify-center text-white font-bold shrink-0">
                        {currentAccount.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left overflow-hidden">
                        <div className="text-sm font-medium text-white truncate">{currentAccount.name}</div>
                        <div className="text-xs text-slate-400 truncate">{currentAccount.domain || 'No Domain'}</div>
                    </div>
                </div>
                <ChevronsUpDown size={16} className="text-slate-500 group-hover:text-slate-300" />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full left-0 w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-20">
                    <div className="p-1">
                        <div className="text-xs font-semibold text-slate-500 px-3 py-2 uppercase tracking-wider">
                            My Accounts
                        </div>

                        {accounts.map(account => (
                            <button
                                key={account.id}
                                onClick={() => {
                                    setCurrentAccount(account);
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-md hover:bg-slate-700 transition-colors"
                            >
                                <span className={account.id === currentAccount.id ? "text-white" : "text-slate-300"}>
                                    {account.name}
                                </span>
                                {account.id === currentAccount.id && <Check size={14} className="text-blue-400" />}
                            </button>
                        ))}
                    </div>

                    <div className="border-t border-slate-700 p-1">
                        <button
                            onClick={() => navigate('/setup?addNew=true')}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-400 hover:bg-slate-700 rounded-md transition-colors"
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
