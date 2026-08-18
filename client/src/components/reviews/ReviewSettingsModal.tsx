import { BadgeCheck, Flag, Loader2, ShieldCheck, SlidersHorizontal, UserRound } from 'lucide-react';
import { Modal } from '../ui/Modal';

export type ReviewerNameDisplay = 'full' | 'first_initial_last' | 'initials' | 'first_last_initial';
export type ReviewModerationMode = 'auto_publish' | 'hold_all' | 'hold_below';

export interface ReviewSettings {
    showCountryFlags: boolean;
    reviewerNameDisplay: ReviewerNameDisplay;
    showTransparencyBadge: boolean;
    showVerifiedCountBadge: boolean;
    moderationMode: ReviewModerationMode;
    moderationThreshold: number;
}

interface ReviewSettingsModalProps {
    isOpen: boolean;
    isLoading: boolean;
    isSaving: boolean;
    loadError: string;
    settings: ReviewSettings;
    onChange: (settings: ReviewSettings) => void;
    onClose: () => void;
    onSave: () => void;
    onRetry: () => void;
}

const NAME_DISPLAY_OPTIONS: Array<{ value: ReviewerNameDisplay; label: string; example: string }> = [
    { value: 'full', label: 'Full name', example: 'Megan Green' },
    { value: 'first_initial_last', label: 'First initial and last name', example: 'M Green' },
    { value: 'initials', label: 'Initials only', example: 'M G' },
    { value: 'first_last_initial', label: 'First name and last initial', example: 'Megan G' },
];

const MODERATION_OPTIONS: Array<{ value: ReviewModerationMode; label: string; description: string }> = [
    { value: 'auto_publish', label: 'Use normal WordPress moderation', description: 'Publish reviews when WordPress and your moderation tools approve them.' },
	{ value: 'hold_all', label: 'Hold all reviews', description: 'Every new review waits for manual approval.' },
    { value: 'hold_below', label: 'Hold reviews below a rating', description: 'Hold lower ratings; higher ratings still follow normal WordPress moderation.' },
];

export function ReviewSettingsModal({
    isOpen,
    isLoading,
    isSaving,
    loadError,
    settings,
    onChange,
    onClose,
    onSave,
    onRetry,
}: ReviewSettingsModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={isSaving ? undefined : onClose} title="Review settings" maxWidth="max-w-2xl">
            {isLoading ? (
                <div className="flex min-h-44 items-center justify-center text-slate-500">
                    <Loader2 className="mr-2 animate-spin" size={18} /> Loading settings…
                </div>
            ) : loadError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
                    <p>{loadError}</p>
                    <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100 dark:border-red-800 dark:bg-red-950">Try again</button>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                        WooCommerce controls who may submit reviews. Customers with a matching order are automatically shown as verified owners.
                    </div>
                    <div>
                        <div className="mb-3 flex items-center gap-2">
                            <ShieldCheck className="text-blue-600" size={19} />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white">Storefront trust badges</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Show earned badges on review pages and review summary widgets.</p>
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {[
                                {
                                    key: 'showTransparencyBadge' as const,
                                    icon: ShieldCheck,
                                    title: 'Transparency badge',
                                    description: 'Bronze at 30%, Silver at 60%, and Gold at 90% of active reviews published.',
                                },
                                {
                                    key: 'showVerifiedCountBadge' as const,
                                    icon: BadgeCheck,
                                    title: 'Verified reviews badge',
                                    description: 'Displays the highest earned tier from 50 to 10,000 verified reviews.',
                                },
                            ].map(({ key, icon: Icon, title, description }) => (
                                <div key={key} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                                    <Icon className="mt-0.5 shrink-0 text-blue-600" size={20} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="font-semibold text-slate-900 dark:text-white">{title}</div>
                                                <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">{description}</p>
                                            </div>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={settings[key]}
                                                aria-label={title}
                                                onClick={() => onChange({ ...settings, [key]: !settings[key] })}
                                                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${settings[key] ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                                            >
                                                <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${settings[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="mb-3 flex items-center gap-2">
                            <SlidersHorizontal className="text-blue-600" size={19} />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white">New review moderation</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Choose the initial publication status for incoming reviews.</p>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {MODERATION_OPTIONS.map((option) => (
                                <label key={option.value} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3.5 has-checked:border-blue-500 has-checked:bg-blue-50/70 dark:border-slate-700 dark:has-checked:border-blue-500 dark:has-checked:bg-blue-950/20">
                                    <input
                                        type="radio"
                                        name="review-moderation-mode"
                                        value={option.value}
                                        checked={settings.moderationMode === option.value}
                                        onChange={() => onChange({ ...settings, moderationMode: option.value })}
                                        className="mt-1 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span>
                                        <span className="block font-medium text-slate-900 dark:text-white">{option.label}</span>
                                        <span className="block text-sm text-slate-500 dark:text-slate-400">{option.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        {settings.moderationMode === 'hold_below' && (
                            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                                <div className="flex items-center justify-between gap-4">
                                    <label htmlFor="review-moderation-threshold" className="font-medium text-slate-900 dark:text-white">Hold reviews below</label>
                                    <strong className="rounded-lg bg-white px-3 py-1 text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300">{settings.moderationThreshold} stars</strong>
                                </div>
                                <input
                                    id="review-moderation-threshold"
                                    type="range"
                                    min="2"
                                    max="5"
                                    step="1"
                                    value={settings.moderationThreshold}
                                    onChange={(event) => onChange({ ...settings, moderationThreshold: Number(event.target.value) })}
                                    className="mt-4 w-full accent-blue-600"
                                />
                                <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>2 stars</span><span>5 stars</span></div>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                        <Flag className="mt-0.5 shrink-0 text-blue-600" size={20} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-slate-900 dark:text-white">Show customer country flags</div>
                                    <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">
                                        Display a country flag for logged-in customers when their billing country is available at submission.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={settings.showCountryFlags}
                                    aria-label="Show customer country flags"
                                    onClick={() => onChange({ ...settings, showCountryFlags: !settings.showCountryFlags })}
                                    className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${settings.showCountryFlags ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                                >
                                    <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${settings.showCountryFlags ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="mb-3 flex items-center gap-2">
                            <UserRound className="text-blue-600" size={19} />
                            <div>
                                <label htmlFor="reviewer-name-display" className="font-semibold text-slate-900 dark:text-white">Reviewer name display</label>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Choose how customer names appear publicly on review cards.</p>
                            </div>
                        </div>
                        <select
                            id="reviewer-name-display"
                            value={settings.reviewerNameDisplay}
                            onChange={(event) => onChange({ ...settings, reviewerNameDisplay: event.target.value as ReviewerNameDisplay })}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        >
                            {NAME_DISPLAY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label} — {option.example}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-700">
                        <button type="button" onClick={onClose} disabled={isSaving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                            Cancel
                        </button>
                        <button type="button" onClick={onSave} disabled={isSaving} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                            {isSaving && <Loader2 className="mr-2 animate-spin" size={16} />}
                            {isSaving ? 'Saving…' : 'Save settings'}
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
