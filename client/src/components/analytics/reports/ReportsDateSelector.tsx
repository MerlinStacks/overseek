import { DateRangeOption } from '../../../utils/dateUtils';
import { CalendarDays } from 'lucide-react';

interface ReportsDateSelectorProps {
    dateOption: DateRangeOption;
    onChange: (value: DateRangeOption) => void;
}

export function ReportsDateSelector({ dateOption, onChange }: ReportsDateSelectorProps) {
    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white/80 p-3 shadow-xs backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/70 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-slate-400">
                <div className="rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-900/30">
                    <CalendarDays size={18} />
                </div>
                <div>
                    <p className="font-semibold text-gray-900 dark:text-white">Reporting window</p>
                    <p className="text-xs">Applies to overview, profitability, and library reports</p>
                </div>
            </div>
            <div className="flex overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-800 sm:shrink-0">
                <select
                    value={dateOption}
                    onChange={(e) => onChange(e.target.value as DateRangeOption)}
                    className="bg-transparent px-4 py-2.5 text-sm font-medium text-gray-700 outline-hidden focus:bg-gray-50 dark:text-slate-200 dark:focus:bg-slate-700"
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
        </div>
    );
}
