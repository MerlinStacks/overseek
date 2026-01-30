import * as React from 'react';
import { Calendar } from 'lucide-react';

interface DateRangeFilterProps {
    value: number;
    onChange: (days: number) => void;
}

const ranges = [
    { label: 'Today', value: 1 },
    { label: 'Yesterday', value: -1 },
    { label: '7 Days', value: 7 },
    { label: '30 Days', value: 30 },
    { label: '90 Days', value: 90 },
    { label: '1 Year', value: 365 }
];

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange }) => {
    return (
        <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-1">
            <Calendar className="w-4 h-4 text-gray-400 ml-2" />
            {ranges.map(range => (
                <button
                    key={range.value}
                    onClick={() => onChange(range.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${value === range.value
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    {range.label}
                </button>
            ))}
        </div>
    );
};

export default DateRangeFilter;
