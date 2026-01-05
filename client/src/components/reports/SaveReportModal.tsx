import React, { useState } from 'react';
import { Clock } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface SaveReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
}

export function SaveReportModal({ isOpen, onClose, onSave }: SaveReportModalProps) {
    const [templateName, setTemplateName] = useState('');
    const [enableSchedule, setEnableSchedule] = useState(false);
    const [scheduleFreq, setScheduleFreq] = useState('WEEKLY');
    const [scheduleDay, setScheduleDay] = useState(1);
    const [scheduleTime, setScheduleTime] = useState('09:00');
    const [recipients, setRecipients] = useState('');

    const handleSave = async () => {
        if (!templateName) return;

        await onSave({
            name: templateName,
            schedule: enableSchedule ? {
                frequency: scheduleFreq,
                dayOfWeek: scheduleFreq === 'WEEKLY' ? Number(scheduleDay) : undefined,
                dayOfMonth: scheduleFreq === 'MONTHLY' ? Number(scheduleDay) : undefined,
                time: scheduleTime,
                emailRecipients: recipients.split(',').map(e => e.trim()).filter(Boolean)
            } : null
        });

        // Reset form
        setTemplateName('');
        setEnableSchedule(false);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Save Report Template">
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                    <input
                        type="text"
                        className="w-full border rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="e.g., Weekly Sales Overview"
                        value={templateName}
                        onChange={e => setTemplateName(e.target.value)}
                    />
                </div>

                <div className="border-t pt-4">
                    <label className="flex items-center gap-2 cursor-pointer mb-4">
                        <input
                            type="checkbox"
                            className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                            checked={enableSchedule}
                            onChange={e => setEnableSchedule(e.target.checked)}
                        />
                        <span className="font-medium text-gray-900">Schedule Email Report</span>
                    </label>

                    {enableSchedule && (
                        <div className="space-y-3 pl-6 border-l-2 border-blue-100 animate-in fade-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Frequency</label>
                                    <select
                                        value={scheduleFreq}
                                        onChange={e => setScheduleFreq(e.target.value)}
                                        className="w-full border rounded-md p-2 text-sm"
                                    >
                                        <option value="WEEKLY">Weekly</option>
                                        <option value="MONTHLY">Monthly</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">
                                        {scheduleFreq === 'WEEKLY' ? 'Day of Week' : 'Day of Month'}
                                    </label>
                                    <select
                                        value={scheduleDay}
                                        onChange={e => setScheduleDay(Number(e.target.value))}
                                        className="w-full border rounded-md p-2 text-sm"
                                    >
                                        {scheduleFreq === 'WEEKLY' ? (
                                            <>
                                                <option value={1}>Monday</option>
                                                <option value={2}>Tuesday</option>
                                                <option value={3}>Wednesday</option>
                                                <option value={4}>Thursday</option>
                                                <option value={5}>Friday</option>
                                                <option value={6}>Saturday</option>
                                                <option value={7}>Sunday</option>
                                            </>
                                        ) : (
                                            Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                                                <option key={d} value={d}>{d}</option>
                                            ))
                                        )}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Time</label>
                                <div className="relative">
                                    <input
                                        type="time"
                                        value={scheduleTime}
                                        onChange={e => setScheduleTime(e.target.value)}
                                        className="w-full border rounded-md p-2 text-sm pl-8"
                                    />
                                    <Clock size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Recipients (comma separated)</label>
                                <input
                                    type="text"
                                    className="w-full border rounded-md p-2 text-sm"
                                    placeholder="managers@example.com, ceo@example.com"
                                    value={recipients}
                                    onChange={e => setRecipients(e.target.value)}
                                />
                                <p className="text-[10px] text-gray-400 mt-1">Make sure recipients are whitelisted if using trial SMTP.</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="pt-4 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!templateName}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 font-medium"
                    >
                        Save Template
                    </button>
                </div>
            </div>
        </Modal>
    );
}
