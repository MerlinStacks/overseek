import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
    /** Current theme setting */
    theme: Theme;
    /** Resolved theme (never 'system', always 'light' or 'dark') */
    resolvedTheme: 'light' | 'dark';
    /** Set the theme */
    setTheme: (theme: Theme) => void;
    /** Toggle between light and dark */
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'overseek-theme';

/**
 * Determines the resolved theme based on preference and system settings.
 */
function getResolvedTheme(theme: Theme): 'light' | 'dark' {
    if (theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
}

interface ThemeProviderProps {
    children: ReactNode;
    /** Default theme if none is saved */
    defaultTheme?: Theme;
}

/**
 * ThemeProvider - Manages app-wide theme state.
 * Syncs to localStorage and responds to system preference changes.
 * 
 * @example
 * // In App.tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * 
 * // In any component
 * const { theme, toggleTheme } = useTheme();
 */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>(() => {
        // Read from localStorage on mount
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
            return stored || defaultTheme;
        }
        return defaultTheme;
    });

    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
        getResolvedTheme(theme)
    );

    // Apply theme to document
    useEffect(() => {
        const resolved = getResolvedTheme(theme);

        // Defer state update to avoid cascading renders
        const timeoutId = setTimeout(() => {
            setResolvedTheme(resolved);
        }, 0);

        // Apply class to document root for Tailwind dark mode
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(resolved);

        // Also set data attribute for CSS selectors
        document.documentElement.setAttribute('data-theme', resolved);

        return () => clearTimeout(timeoutId);
    }, [theme]);

    // Listen for system preference changes when theme is 'system'
    useEffect(() => {
        if (theme !== 'system') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleChange = (e: MediaQueryListEvent) => {
            setResolvedTheme(e.matches ? 'dark' : 'light');
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(e.matches ? 'dark' : 'light');
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem(STORAGE_KEY, newTheme);
    };

    const toggleTheme = () => {
        const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
    };

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

/**
 * useTheme - Hook to access and control the current theme.
 */
export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
