import { DateRangeOption } from '../../../utils/dateUtils';
import { Calendar } from 'lucide-react';

interface ReportsDateSelectorProps {
    dateOption: DateRangeOption;
    onChange: (value: DateRangeOption) => void;
}

export function ReportsDateSelector({ dateOption, onChange }: ReportsDateSelectorProps) {
    return (
        <div className="flex items-center gap-1 rounded-lg bg-gray-100/80 p-1 dark:bg-slate-800">
            <Calendar className="ml-2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <select
                aria-label="Reporting date range"
                value={dateOption}
                onChange={(e) => onChange(e.target.value as DateRangeOption)}
                className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-900 shadow-xs outline-hidden dark:bg-slate-700 dark:text-slate-100"
            >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
                <option value="ytd">Year to Date</option>
                <option value="all">All Time</option>
            </select>
        </div>
    );
}
