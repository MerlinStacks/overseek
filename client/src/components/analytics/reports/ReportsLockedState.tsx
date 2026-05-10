import { Lock } from 'lucide-react';

interface ReportsLockedStateProps {
    title: string;
    description: string;
    colorClass: string;
}

export function ReportsLockedState({ title, description, colorClass }: ReportsLockedStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-20 bg-gray-50 border border-gray-200 rounded-xl border-dashed">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${colorClass}`}>
                <Lock size={32} />
            </div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-gray-500 max-w-md text-center mt-2">{description}</p>
        </div>
    );
}
