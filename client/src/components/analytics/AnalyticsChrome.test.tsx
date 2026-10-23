import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReportsTabs } from './reports/ReportsTabs';
import { DateRangeFilter } from './DateRangeFilter';
import { OnboardingStepIndicator } from '../onboarding/OnboardingStepIndicator';

afterEach(cleanup);

it('exposes the active report tab and retains library and builder actions', () => {
    const onChangeTab = vi.fn(); const onEnterCustomBuilder = vi.fn();
    render(<ReportsTabs activeTab="overview" isAdvancedReportsEnabled onChangeTab={onChangeTab} onEnterCustomBuilder={onEnterCustomBuilder} />);
    expect(screen.getByRole('button', { name: 'Overview', pressed: true })).toHaveClass('bg-[var(--brand-subtle)]', 'text-[var(--brand-text)]', 'focus-visible:outline-[var(--focus-color)]');
    fireEvent.click(screen.getByRole('button', { name: 'Report Library' }));
    expect(onChangeTab).toHaveBeenCalledWith('premade');
    fireEvent.click(screen.getByRole('button', { name: 'Custom Builder' }));
    expect(onEnterCustomBuilder).toHaveBeenCalledOnce();
});

it('uses brand selection and keeps date range callbacks unchanged', () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={7} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '7 Days', pressed: true })).toHaveClass('bg-[var(--brand-subtle)]', 'focus-visible:outline-[var(--focus-color)]');
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onChange).toHaveBeenCalledWith(-1);
});

it('highlights the current setup step without enabling incomplete navigation', () => {
    const onStepClick = vi.fn();
    const { container } = render(<OnboardingStepIndicator currentStep={2} completedSteps={[1]} skippedSteps={[]} onStepClick={onStepClick} />);
    const current = container.querySelector('[aria-current="step"] button');
    expect(current).toBeDisabled();
    expect(current).toHaveClass('bg-[var(--brand-subtle)]', 'border-[var(--brand-border)]');
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onStepClick).toHaveBeenCalledWith(1);
    expect(screen.getAllByRole('button')[2]).toBeDisabled();
});
