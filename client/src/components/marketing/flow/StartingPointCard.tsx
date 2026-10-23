/**
 * StartingPointCard - Initial canvas placeholder for empty flows.
 * Shows dashed-border cards with "Select an Event" and "Use Recipe" options.
 */
import * as React from 'react';
import { MousePointer2, BookOpen } from 'lucide-react';

interface StartingPointCardProps {
    onClick: () => void;
    onRecipeClick?: () => void;
}

export const StartingPointCard: React.FC<StartingPointCardProps> = ({ onClick, onRecipeClick }) => {
    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col sm:flex-row gap-4 p-4 max-w-full">
                <button
                    type="button"
                    onClick={onClick}
                    className="pointer-events-auto flex items-center gap-3 px-6 py-4 bg-white dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-xl hover:border-[var(--primary-color)] hover:bg-[var(--brand-subtle)] dark:hover:bg-slate-700 transition-all duration-200 motion-reduce:transition-none group cursor-pointer"
                >
                    <div className="p-2 bg-gray-100 rounded-lg group-hover:bg-[var(--brand-subtle)] transition-colors">
                        <MousePointer2 size={20} className="text-gray-500 group-hover:text-[var(--brand-text)]" />
                    </div>
                    <span className="text-gray-700 dark:text-slate-100 font-medium group-hover:text-[var(--brand-text)] dark:group-hover:text-[var(--brand-text)]">
                        Select an Event
                    </span>
                </button>
                {onRecipeClick && (
                    <button
                        type="button"
                        onClick={onRecipeClick}
                        className="pointer-events-auto flex items-center gap-3 px-6 py-4 bg-white dark:bg-slate-800 border-2 border-dashed border-[var(--brand-border)] rounded-xl hover:border-[var(--primary-color)] hover:bg-[var(--brand-subtle)] dark:hover:bg-slate-700 transition-all duration-200 motion-reduce:transition-none group cursor-pointer"
                    >
                        <div className="p-2 bg-[var(--brand-subtle)] rounded-lg group-hover:bg-[var(--brand-subtle)] transition-colors">
                            <BookOpen size={20} className="text-[var(--brand-text)] group-hover:text-[var(--brand-text)]" />
                        </div>
                        <span className="text-[var(--brand-text)] font-medium group-hover:text-[var(--brand-text)] dark:group-hover:text-[var(--brand-text)]">
                            Use Recipe
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
};
