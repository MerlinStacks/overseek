import { STEP_CONFIG } from './types';

interface Props { currentStep: number; completedSteps: number[]; skippedSteps: number[]; onStepClick?: (stepId: number) => void; disabled?: boolean }
export function OnboardingStepIndicator({ currentStep, completedSteps, skippedSteps, onStepClick, disabled = false }: Props) {
    if (!STEP_CONFIG.some(step => step.id === currentStep)) return <p role="status">Setup progress unavailable.</p>;
    return <section aria-label="Setup progress" className="space-y-4 text-slate-900 dark:text-slate-100"><h3 className="text-sm font-bold">Setup Progress</h3>
        <ol className="space-y-3">{STEP_CONFIG.map(step => {
            const current = step.id === currentStep;
            const skipped = step.skippable && skippedSteps.includes(step.id);
            const completed = !skipped && completedSteps.includes(step.id);
            const status = current ? 'In Progress' : skipped ? 'Skipped' : completed ? 'Completed' : 'Not started';
            return <li key={step.id} aria-current={current ? 'step' : undefined}><button type="button" disabled={disabled || !onStepClick || current || (!completed && !skipped)} onClick={() => onStepClick?.(step.id)} className={`w-full text-left p-3 border rounded-lg disabled:cursor-default focus-visible:outline-[var(--focus-color)] ${current ? 'bg-[var(--brand-subtle)] border-[var(--brand-border)] text-[var(--brand-text)]' : 'border-slate-200 dark:border-slate-700'}`}>
                <span className="font-medium">{step.id}. {step.label}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{status}</span>
            </button></li>;
        })}</ol>
    </section>;
}
