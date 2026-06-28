/**
 * DelayConfig - Configuration panel for flow delay nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React from 'react';
import { LTR_TEXT_STYLE } from '../textInputBidi';

type DelayMode = 'SPECIFIC_PERIOD' | 'SPECIFIC_DATE' | 'CUSTOM_FIELD';

interface DelayNodeConfig {
    delayMode?: DelayMode;
    duration?: number;
    unit?: 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
    useContactTimezone?: boolean;
    delayUntilTimeEnabled?: boolean;
    delayUntilTime?: string;
    delayUntilDaysEnabled?: boolean;
    delayUntilDays?: string[];
    jumpIfPassed?: boolean;
    specificDate?: string;
    customFieldKey?: string;
}

export interface DelayConfigProps {
    config: DelayNodeConfig;
    onUpdate: (key: string, value: unknown) => void;
}

export const DelayConfig: React.FC<DelayConfigProps> = ({ config, onUpdate }) => {
    const delayMode = config.delayMode || 'SPECIFIC_PERIOD';
    const hasAdvancedConstraints = Boolean(config.useContactTimezone || config.delayUntilTimeEnabled || config.delayUntilDaysEnabled || config.jumpIfPassed);

    const clearAdvancedConstraints = () => {
        onUpdate('useContactTimezone', false);
        onUpdate('delayUntilTimeEnabled', false);
        onUpdate('delayUntilTime', undefined);
        onUpdate('delayUntilDaysEnabled', false);
        onUpdate('delayUntilDays', []);
        onUpdate('jumpIfPassed', false);
    };

    const handleDurationChange = (value: string) => {
        const parsed = Number.parseInt(value, 10);
        const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        onUpdate('duration', normalized);
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
                        disabled
                        checked={delayMode === 'SPECIFIC_DATE'}
                        onChange={() => onUpdate('delayMode', 'SPECIFIC_DATE')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay until a specific date and time</div>
                        <div className="text-xs text-gray-500">Set a specific date and time (coming soon)</div>
                    </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                        type="radio"
                        name="delayMode"
                        value="CUSTOM_FIELD"
                        disabled
                        checked={delayMode === 'CUSTOM_FIELD'}
                        onChange={() => onUpdate('delayMode', 'CUSTOM_FIELD')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay until a custom field date</div>
                        <div className="text-xs text-gray-500">Choose from contacts custom field (coming soon)</div>
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
                            onChange={(e) => handleDurationChange(e.target.value)}
                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            dir="ltr"
                            style={LTR_TEXT_STYLE}
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

                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <div className="font-medium">Advanced delay constraints are coming soon.</div>
                        <p className="mt-1 text-xs">Timezone, time-of-day, day-of-week, and jump-if-passed settings are not applied by the runtime yet.</p>
                        {hasAdvancedConstraints && (
                            <button
                                type="button"
                                onClick={clearAdvancedConstraints}
                                className="mt-2 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200"
                            >
                                Clear unsupported settings
                            </button>
                        )}
                    </div>

                    {/* Summary pill */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                        <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                            <span className="text-white text-[10px] font-bold">i</span>
                        </div>
                        <span className="text-xs text-blue-700">
                            Delay of {config.duration || 1} {config.unit || 'hours'}
                            .
                        </span>
                    </div>
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
                        dir="ltr"
                        style={LTR_TEXT_STYLE}
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
