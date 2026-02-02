/**
 * DelayConfig - Configuration panel for flow delay nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React from 'react';

export interface DelayConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const DelayConfig: React.FC<DelayConfigProps> = ({ config, onUpdate }) => {
    const delayMode = config.delayMode || 'SPECIFIC_PERIOD';

    const toggleDay = (day: string) => {
        const current = config.delayUntilDays || [];
        if (current.includes(day)) {
            onUpdate('delayUntilDays', current.filter((d: string) => d !== day));
        } else {
            onUpdate('delayUntilDays', [...current, day]);
        }
    };

    return (
        <div className="space-y-4">
            {/* Delay Mode Selector */}
            <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                        type="radio"
                        name="delayMode"
                        value="SPECIFIC_PERIOD"
                        checked={delayMode === 'SPECIFIC_PERIOD'}
                        onChange={() => onUpdate('delayMode', 'SPECIFIC_PERIOD')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay for a specific period</div>
                        <div className="text-xs text-gray-500">Wait for a specified number of hours, days, or weeks before continuing</div>
                    </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                        type="radio"
                        name="delayMode"
                        value="SPECIFIC_DATE"
                        checked={delayMode === 'SPECIFIC_DATE'}
                        onChange={() => onUpdate('delayMode', 'SPECIFIC_DATE')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay until a specific date and time</div>
                        <div className="text-xs text-gray-500">Set a specific date and time</div>
                    </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                        type="radio"
                        name="delayMode"
                        value="CUSTOM_FIELD"
                        checked={delayMode === 'CUSTOM_FIELD'}
                        onChange={() => onUpdate('delayMode', 'CUSTOM_FIELD')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay until a custom field date</div>
                        <div className="text-xs text-gray-500">Choose from contacts custom field</div>
                    </div>
                </label>
            </div>

            {/* Specific Period Options */}
            {delayMode === 'SPECIFIC_PERIOD' && (
                <div className="space-y-3 p-3 bg-gray-50 rounded-lg border">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min="1"
                            value={config.duration || 1}
                            onChange={(e) => onUpdate('duration', parseInt(e.target.value) || 1)}
                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <select
                            value={config.unit || 'hours'}
                            onChange={(e) => onUpdate('unit', e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                            <option value="months">Months</option>
                        </select>
                    </div>

                    {/* Contact Timezone */}
                    <label className="flex items-center gap-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
                        <input
                            type="checkbox"
                            checked={config.useContactTimezone || false}
                            onChange={(e) => onUpdate('useContactTimezone', e.target.checked)}
                            className="rounded-sm text-purple-600"
                        />
                        <div>
                            <span className="text-sm font-medium text-purple-700">Use contact's timezone</span>
                            <p className="text-xs text-purple-600">Times will be calculated based on the contact's local time</p>
                        </div>
                    </label>

                    {/* Time of day constraint */}
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={config.delayUntilTimeEnabled || false}
                            onChange={(e) => onUpdate('delayUntilTimeEnabled', e.target.checked)}
                            className="rounded-sm"
                        />
                        <span className="text-sm text-gray-600">Delay until a specific time of day</span>
                    </label>
                    {config.delayUntilTimeEnabled && (
                        <input
                            type="time"
                            value={config.delayUntilTime || '09:00'}
                            onChange={(e) => onUpdate('delayUntilTime', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                    )}

                    {/* Day of week constraint */}
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={config.delayUntilDaysEnabled || false}
                            onChange={(e) => onUpdate('delayUntilDaysEnabled', e.target.checked)}
                            className="rounded-sm"
                        />
                        <span className="text-sm text-gray-600">Delay until a specific day(s) of the week</span>
                    </label>
                    {config.delayUntilDaysEnabled && (
                        <div className="flex flex-wrap gap-1">
                            {DAYS_OF_WEEK.map(day => (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => toggleDay(day)}
                                    className={`px-2 py-1 text-xs rounded ${(config.delayUntilDays || []).includes(day)
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }`}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Summary pill */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                        <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                            <span className="text-white text-[10px] font-bold">i</span>
                        </div>
                        <span className="text-xs text-blue-700">
                            Delay of {config.duration || 1} {config.unit || 'hours'}
                            {config.useContactTimezone && " (contact's timezone)"}
                            {config.delayUntilTimeEnabled && ` until ${config.delayUntilTime || '09:00'}`}
                            {config.delayUntilDaysEnabled && (config.delayUntilDays?.length > 0) && ` on ${config.delayUntilDays.join(', ')}`}.
                        </span>
                    </div>

                    {/* Jump if time passed */}
                    <label className="flex items-center gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <input
                            type="checkbox"
                            checked={config.jumpIfPassed || false}
                            onChange={(e) => onUpdate('jumpIfPassed', e.target.checked)}
                            className="rounded-sm text-yellow-600"
                        />
                        <div>
                            <span className="text-sm font-medium text-yellow-700">Jump to next step if time has passed</span>
                            <p className="text-xs text-yellow-600">If the scheduled time already passed, skip this delay</p>
                        </div>
                    </label>
                </div>
            )}

            {/* Specific Date Options */}
            {delayMode === 'SPECIFIC_DATE' && (
                <div className="p-3 bg-gray-50 rounded-lg border">
                    <input
                        type="datetime-local"
                        value={config.specificDate || ''}
                        onChange={(e) => onUpdate('specificDate', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            )}

            {/* Custom Field Options */}
            {delayMode === 'CUSTOM_FIELD' && (
                <div className="p-3 bg-gray-50 rounded-lg border">
                    <select
                        value={config.customFieldKey || ''}
                        onChange={(e) => onUpdate('customFieldKey', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">Select a date field...</option>
                        <option value="birthday">Birthday</option>
                        <option value="subscription_renewal">Subscription Renewal</option>
                        <option value="last_order_date">Last Order Date</option>
                    </select>
                </div>
            )}
        </div>
    );
};
