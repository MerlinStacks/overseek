import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../utils/cn';
import { useState, useRef, useEffect } from 'react';

interface ThemeToggleProps {
    /** Show as a simple toggle button or a dropdown with all options */
    variant?: 'toggle' | 'dropdown';
    /** Additional CSS classes */
    className?: string;
}

/**
 * ThemeToggle - Toggle between light/dark modes.
 * 
 * @example
 * // Simple toggle
 * <ThemeToggle />
 * 
 * // Dropdown with System option
 * <ThemeToggle variant="dropdown" />
 */
export function ThemeToggle({ variant = 'toggle', className }: ThemeToggleProps) {
    const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (variant === 'toggle') {
        return (
            <button
                onClick={toggleTheme}
                className={cn(
                    "relative p-2.5 rounded-xl transition-all duration-300",
                    "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700",
                    "text-slate-600 dark:text-slate-300",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500/50",
                    className
                )}
                title={`Switch to ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
                aria-label={`Switch to ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
            >
                <div className="relative w-5 h-5">
                    {/* Sun Icon */}
                    <Sun
                        size={20}
                        className={cn(
                            "absolute inset-0 transition-all duration-500 rotate-0 scale-100 dark:-rotate-90 dark:scale-0",
                            resolvedTheme === 'light' ? "opacity-100" : "opacity-0"
                        )}
                    />
                    {/* Moon Icon */}
                    <Moon
                        size={20}
                        className={cn(
                            "absolute inset-0 transition-all duration-500 rotate-90 scale-0 dark:rotate-0 dark:scale-100",
                            resolvedTheme === 'dark' ? "opacity-100" : "opacity-0"
                        )}
                    />
                </div>
            </button>
        );
    }

    // Dropdown variant
    const options = [
        { value: 'light' as const, label: 'Light', icon: Sun },
        { value: 'dark' as const, label: 'Dark', icon: Moon },
        { value: 'system' as const, label: 'System', icon: Monitor },
    ];

    const currentOption = options.find(o => o.value === theme) || options[2];
    const CurrentIcon = currentOption.icon;

    return (
        <div ref={dropdownRef} className={cn("relative", className)}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-200",
                    "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700",
                    "text-slate-600 dark:text-slate-300",
                    "text-sm font-medium"
                )}
            >
                <CurrentIcon size={16} />
                <span className="hidden sm:inline">{currentOption.label}</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden animate-scale-in">
                    <div className="p-1.5">
                        {options.map((option) => {
                            const Icon = option.icon;
                            const isActive = theme === option.value;

                            return (
                                <button
                                    key={option.value}
                                    onClick={() => {
                                        setTheme(option.value);
                                        setIsOpen(false);
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-200",
                                        isActive
                                            ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium"
                                            : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                    )}
                                >
                                    <Icon size={16} />
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * ThemeToggleInline - Inline theme toggle for use in menus/settings.
 */
export function ThemeToggleInline({ className }: { className?: string }) {
    const { theme, setTheme } = useTheme();

    return (
        <div className={cn("flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg", className)}>
            {[
                { value: 'light' as const, icon: Sun, label: 'Light' },
                { value: 'dark' as const, icon: Moon, label: 'Dark' },
                { value: 'system' as const, icon: Monitor, label: 'System' },
            ].map((option) => {
                const Icon = option.icon;
                const isActive = theme === option.value;

                return (
                    <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={cn(
                            "p-2 rounded-md transition-all",
                            isActive
                                ? "bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400"
                                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                        )}
                        title={option.label}
                    >
                        <Icon size={16} />
                    </button>
                );
            })}
        </div>
    );
}
