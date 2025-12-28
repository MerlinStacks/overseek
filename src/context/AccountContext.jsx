import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../db/db';

const AccountContext = createContext();

export const useAccount = () => {
    const context = useContext(AccountContext);
    if (!context) {
        throw new Error('useAccount must be used within an AccountProvider');
    }
    return context;
};

export const AccountProvider = ({ children }) => {
    const [accounts, setAccounts] = useState([]);
    const [activeAccount, setActiveAccount] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadAccounts = async () => {
            try {
                const all = await db.accounts.toArray();
                setAccounts(all);

                // Auto-select logic
                const storedId = parseInt(localStorage.getItem('activeAccountId'), 10);

                let selected = null;
                if (storedId && all.find(a => a.id === storedId)) {
                    selected = all.find(a => a.id === storedId);
                } else if (all.length > 0) {
                    // Default to first available
                    selected = all[0];
                    localStorage.setItem('activeAccountId', selected.id);
                } else {
                    // No accounts exist (should be handled by migration, but just in case)
                    // We might need to prompt creation or waiting for migration to finish
                }

                setActiveAccount(selected);
            } catch (err) {
                console.error("Failed to load accounts", err);
            } finally {
                setLoading(false);
            }
        };

        loadAccounts();
    }, []);

    const switchAccount = (accountId) => {
        const acc = accounts.find(a => a.id === accountId);
        if (acc) {
            setActiveAccount(acc);
            localStorage.setItem('activeAccountId', acc.id);
            // Reload the page to ensure all contexts and sensitive states are reset cleanly
            // Or we can rely on React state propagation. 
            // Given the complexity of SyncContext and SettingsContext, a reload might be safer 
            // but effectively "locks" the reset. 
            // For a smooth SPA, we should rely on state. 
            // Let's rely on state. SettingsContext will listen to activeAccount.
        }
    };

    const createAccount = async (name, domain) => {
        try {
            const id = await db.accounts.add({
                name,
                domain,
                created_at: new Date().toISOString()
            });
            const newAcc = await db.accounts.get(id);
            setAccounts(prev => [...prev, newAcc]);
            // Switch to it immediately? Maybe.
            return newAcc;
        } catch (e) {
            console.error("Failed to create account", e);
            throw e;
        }
    };

    return (
        <AccountContext.Provider value={{ accounts, activeAccount, switchAccount, createAccount, loading }}>
            {children}
        </AccountContext.Provider>
    );
};
