import { WIZARD_STEPS } from './types';

const steps = [
    { id: WIZARD_STEPS.GOAL, label: 'Goal & Type' }, { id: WIZARD_STEPS.PRODUCTS, label: 'Products' },
    { id: WIZARD_STEPS.AD_COPY, label: 'Ad Copy' }, { id: WIZARD_STEPS.BUDGET, label: 'Budget & Review' },
];
export function WizardStepIndicator({ currentStep }: { currentStep: number }) {
    if (!steps.some(step => step.id === currentStep)) return <p role="status">Campaign progress unavailable.</p>;
    return <section aria-label="Campaign setup progress" className="space-y-4"><h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Setup Progress</h3>
        <ol className="space-y-4">{steps.map(step => {
            const state = step.id < currentStep ? 'Completed' : step.id === currentStep ? 'In Progress' : 'Not started';
            return <li key={step.id} aria-current={step.id === currentStep ? 'step' : undefined} className="flex items-center gap-3">
                <span aria-hidden="true" className={`flex h-10 w-10 items-center justify-center rounded-xl ${step.id === currentStep ? 'bg-indigo-600 text-white' : step.id < currentStep ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{step.id}</span>
                <div><p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{step.label}</p><p className="text-xs text-slate-500 dark:text-slate-400">{state}</p></div>
            </li>;
        })}</ol>
    </section>;
}
