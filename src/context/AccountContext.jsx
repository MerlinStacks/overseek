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

    const refreshAccounts = async () => {
        setLoading(true);
        try {
            const all = await db.accounts.toArray();
            setAccounts(Array.isArray(all) ? all : []);

            // Re-sync active account if it was updated
            if (activeAccount) {
                const updated = all.find(a => a.id === activeAccount.id);
                if (updated) setActiveAccount(updated);
            }
        } catch (err) {
            console.error("Failed to refresh accounts", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshAccounts();
    }, []);

    const switchAccount = (accountId) => {
        const acc = accounts.find(a => a.id === accountId);
        if (acc) {
            setActiveAccount(acc);
            localStorage.setItem('activeAccountId', acc.id);
            // State update triggers re-renders, no reload needed relative to routing.
            // If specific components need to reset, they should listen to activeAccount changes.
        }
    };

    const createAccount = async (name, domain) => {
        try {
            const id = await db.accounts.add({
                name,
                domain,
                created_at: new Date().toISOString()
            });
            await refreshAccounts(); // Re-fetch to get complete object
            const newAcc = await db.accounts.get(id); // Double check or just use refresh results
            return newAcc;
        } catch (e) {
            console.error("Failed to create account", e);
            throw e;
        }
    };

    return (
        <AccountContext.Provider value={{ accounts, activeAccount, switchAccount, createAccount, refreshAccounts, loading }}>
            {children}
        </AccountContext.Provider>
    );
};
