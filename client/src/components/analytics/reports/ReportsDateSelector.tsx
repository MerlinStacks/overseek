import { DateRangeOption } from '../../../utils/dateUtils';

interface ReportsDateSelectorProps {
    dateOption: DateRangeOption;
    onChange: (value: DateRangeOption) => void;
}

export function ReportsDateSelector({ dateOption, onChange }: ReportsDateSelectorProps) {
    return (
        <div className="flex justify-end">
            <div className="flex bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
                <select
                    value={dateOption}
                    onChange={(e) => onChange(e.target.value as DateRangeOption)}
                    className="bg-transparent px-4 py-2.5 text-sm font-medium text-gray-700 outline-hidden focus:bg-gray-50"
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
