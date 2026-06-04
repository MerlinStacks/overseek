import { Lock } from 'lucide-react';

interface ReportsLockedStateProps {
    title: string;
    description: string;
    colorClass: string;
}

export function ReportsLockedState({ title, description, colorClass }: ReportsLockedStateProps) {
    return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-20 text-center dark:border-slate-700 dark:bg-slate-900/50">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${colorClass}`}>
                <Lock size={32} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
            <p className="mt-2 max-w-md text-gray-500 dark:text-slate-400">{description}</p>
        </div>
    );
}
