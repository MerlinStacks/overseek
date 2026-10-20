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
                    className="pointer-events-auto flex items-center gap-3 px-6 py-4 bg-white dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-xl hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-700 transition-all duration-200 motion-reduce:transition-none group cursor-pointer"
                >
                    <div className="p-2 bg-gray-100 rounded-lg group-hover:bg-blue-100 transition-colors">
                        <MousePointer2 size={20} className="text-gray-500 group-hover:text-blue-600" />
                    </div>
                    <span className="text-gray-700 dark:text-slate-100 font-medium group-hover:text-blue-700 dark:group-hover:text-blue-300">
                        Select an Event
                    </span>
                </button>
                {onRecipeClick && (
                    <button
                        type="button"
                        onClick={onRecipeClick}
                        className="pointer-events-auto flex items-center gap-3 px-6 py-4 bg-white dark:bg-slate-800 border-2 border-dashed border-purple-200 dark:border-purple-800 rounded-xl hover:border-purple-400 hover:bg-purple-50/50 dark:hover:bg-slate-700 transition-all duration-200 motion-reduce:transition-none group cursor-pointer"
                    >
                        <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                            <BookOpen size={20} className="text-purple-500 group-hover:text-purple-600" />
                        </div>
                        <span className="text-purple-700 dark:text-purple-300 font-medium group-hover:text-purple-800 dark:group-hover:text-purple-200">
                            Use Recipe
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
};
