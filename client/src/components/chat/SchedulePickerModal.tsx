/**
 * SchedulePickerModal
 * 
 * Modal for scheduling messages to be sent later.
 * Provides preset options and a custom date/time picker.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { Clock, Calendar, Send } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';

interface SchedulePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSchedule: (scheduledFor: Date) => void | Promise<void>;
    isLoading?: boolean;
}

/**
 * Get preset schedule options based on current time.
 */
function getPresetOptions(): { label: string; value: Date }[] {
    const now = new Date();
    const presets: { label: string; value: Date }[] = [];

    // In 1 hour
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    presets.push({ label: 'In 1 hour', value: inOneHour });

    // In 2 hours
    const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    presets.push({ label: 'In 2 hours', value: inTwoHours });

    // Tomorrow 9 AM
    const tomorrow9am = new Date(now);
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
    tomorrow9am.setHours(9, 0, 0, 0);
    presets.push({ label: 'Tomorrow 9:00 AM', value: tomorrow9am });

    // Next Monday 9 AM
    const nextMonday = new Date(now);
    const currentDay = nextMonday.getDay();
    const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 0, 0, 0);
    if (nextMonday > now) {
        presets.push({ label: 'Monday 9:00 AM', value: nextMonday });
    }

    return presets;
}

/**
 * Format date for display.
 */
function formatScheduleTime(date: Date): string {
    return date.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

export function SchedulePickerModal({
    isOpen, ...props
}: SchedulePickerModalProps) {
    return isOpen ? <OpenSchedulePicker {...props} /> : null;
}

function OpenSchedulePicker({
    onClose,
    onSchedule,
    isLoading = false,
}: Omit<SchedulePickerModalProps, 'isOpen'>) {
    const [selectedPreset, setSelectedPreset] = useState<Date | null>(null);
    const [customDate, setCustomDate] = useState('');
    const [customTime, setCustomTime] = useState('');
    const [useCustom, setUseCustom] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = useRef(false);
    const active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    const busy = isLoading || submitting;

    // Memoize presets to avoid impure function call during render
    const presets = useMemo(() => getPresetOptions(), []);

    // Keep date input bounded to today or later.
    const { minDateString } = useMemo(() => {
        const minDate = new Date();
        return { minDateString: `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}` };
    }, []);

    const handlePresetSelect = (date: Date) => {
        if (busy) return;
        setSubmitted(false); setError(null);
        setSelectedPreset(date);
        setUseCustom(false);
    };

    const handleCustomChange = () => {
        setSubmitted(false); setError(null);
        setUseCustom(true);
        setSelectedPreset(null);
    };

    const getScheduledTime = (): Date | null => {
        if (useCustom && customDate && customTime) {
            const combined = new Date(`${customDate}T${customTime}`);
            const [year, month, day] = customDate.split('-').map(Number);
            const [hour, minute] = customTime.split(':').map(Number);
            // Reject nonexistent local times (for example during a daylight-saving jump).
            if (combined.getFullYear() === year && combined.getMonth() + 1 === month && combined.getDate() === day && combined.getHours() === hour && combined.getMinutes() === minute) {
                return combined;
            }
        }
        return selectedPreset;
    };

    const scheduledTime = getScheduledTime();

    const handleSubmit = async () => {
        if (pending.current || busy || submitted) return;
        const candidate = getScheduledTime();
        if (!candidate || !Number.isFinite(candidate.getTime()) || candidate.getTime() <= Date.now()) { setError('Choose a valid future time in your device timezone.'); return; }
        pending.current = true; setSubmitting(true); setError(null);
        try { await onSchedule(candidate); if (active.current) setSubmitted(true); }
        catch { if (active.current) setError('Could not schedule the message. Check its status before retrying.'); }
        finally { pending.current = false; if (active.current) setSubmitting(false); }
    };

    return (
        <Modal
            isOpen
            onClose={busy ? undefined : onClose}
            title={
                <div className="flex items-center gap-2 text-white">
                    <Clock className="w-5 h-5 text-[var(--brand-text)]" />
                    <span>Schedule Message</span>
                </div>
            }
            maxWidth="max-w-md"
        >
            <div className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">Times use your device timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
                {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                {/* Preset Options */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Quick Options</label>
                    <div className="grid grid-cols-2 gap-2">
                        {presets.map((preset, index) => (
                            <button
                                type="button" disabled={busy} aria-pressed={selectedPreset === preset.value && !useCustom}
                                key={index}
                                onClick={() => handlePresetSelect(preset.value)}
                                className={cn(
                                    'px-3 py-2 rounded-lg text-sm font-medium transition-all',
                                    'border',
                                    selectedPreset === preset.value && !useCustom
                                        ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[var(--primary-foreground)]'
                                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-gray-600'
                                )}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-gray-700" />
                    <span className="text-xs text-gray-500 uppercase">or</span>
                    <div className="flex-1 h-px bg-gray-700" />
                </div>

                {/* Custom Date/Time */}
                <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-400">Custom Time</label>
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus-within:border-[var(--primary-color)]">
                                <Calendar className="w-4 h-4 text-gray-400" />
                                <input
                                    aria-label="Scheduled date" disabled={busy}
                                    type="date"
                                    value={customDate}
                                    onChange={(e) => {
                                        setCustomDate(e.target.value);
                                        handleCustomChange();
                                    }}
                                    min={minDateString}
                                    className="flex-1 bg-transparent text-white text-sm outline-none"
                                />
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus-within:border-[var(--primary-color)]">
                                <Clock className="w-4 h-4 text-gray-400" />
                                <input
                                    aria-label="Scheduled time" disabled={busy}
                                    type="time"
                                    value={customTime}
                                    onChange={(e) => {
                                        setCustomTime(e.target.value);
                                        handleCustomChange();
                                    }}
                                    className="flex-1 bg-transparent text-white text-sm outline-none"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Selected Time Preview */}
                {scheduledTime && (
                    <div className="p-3 bg-[var(--brand-subtle)] border border-[var(--brand-border)] rounded-lg">
                        <div className="flex items-center gap-2 text-[var(--brand-text)]">
                            <Send className="w-4 h-4" />
                            <span className="text-sm">
                                Message will be sent: <strong>{formatScheduleTime(scheduledTime)}</strong>
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-700">
                <button
                    type="button" disabled={busy}
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!scheduledTime || busy || submitted}
                    className={cn(
                        'px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2',
                        scheduledTime && !isLoading
                                ? 'bg-[var(--primary-color)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]'
                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    )}
                >
                    <Clock className="w-4 h-4" />
                    {isLoading ? 'Scheduling...' : 'Schedule'}
                </button>
            </div>
        </Modal>
    );
}
