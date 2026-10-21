import { type WizardStepProps } from '../types';

export function StepGoalType({ draft, setDraft }: WizardStepProps) {
    return <section className="space-y-5 text-slate-900 dark:text-slate-100">
        <h3 className="text-2xl font-bold">Choose a campaign type</h3>
        <p>Create a Search campaign with editable ad copy. Review bidding and targeting in Google Ads.</p>
        <div role="group" aria-label="Campaign type" className="flex flex-wrap gap-4">
            <button type="button" aria-pressed={draft.type === 'SEARCH'} className="p-4 border rounded-xl border-indigo-500 bg-indigo-50 dark:bg-indigo-950" onClick={() => setDraft(current => ({ ...current, type: 'SEARCH', name: current.name || 'New Search Campaign' }))}>Search</button>
            <button type="button" disabled aria-pressed={draft.type === 'PMAX'} className="p-4 border rounded-xl opacity-60">Performance Max — creation unavailable</button>
        </div>
        <label className="block">Campaign name<input className="block w-full p-2 border rounded-lg bg-white dark:bg-slate-900" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
    </section>;
}
