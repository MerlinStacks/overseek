/**
 * useCommandPalette Hook
 * 
 * Provides global access to the CommandPalette open state.
 * Allows Header and other components to trigger the search modal.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface CommandPaletteContextValue {
    /** Whether the palette is currently open */
    isOpen: boolean;
    /** Open the command palette */
    open: () => void;
    /** Close the command palette */
    close: () => void;
    /** Toggle open state */
    toggle: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

interface CommandPaletteProviderProps {
    children: ReactNode;
}

/**
 * Provider component that wraps the app to provide palette state.
 * Should be placed near the root of the component tree.
 */
export function CommandPaletteProvider({ children }: CommandPaletteProviderProps) {
    const [isOpen, setIsOpen] = useState(false);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen(prev => !prev), []);

    // Listen for global toggle event (fired by Ctrl+K handler in CommandPalette)
    React.useEffect(() => {
        const handleToggle = () => toggle();
        window.addEventListener('commandpalette:toggle', handleToggle);
        return () => window.removeEventListener('commandpalette:toggle', handleToggle);
    }, [toggle]);

    return (
        <CommandPaletteContext.Provider value={{ isOpen, open, close, toggle }}>
            {children}
        </CommandPaletteContext.Provider>
    );
}

/**
 * Hook to access and control the command palette state.
 * Must be used within a CommandPaletteProvider.
 */
export function useCommandPalette(): CommandPaletteContextValue {
    const context = useContext(CommandPaletteContext);
    if (!context) {
        throw new Error('useCommandPalette must be used within a CommandPaletteProvider');
    }
    return context;
}
