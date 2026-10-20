import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobilePageHeader } from './MobilePageHeader';

afterEach(cleanup);

describe('companion page headers', () => {
    it('renders a shared heading and optional description without a redundant back button', () => {
        render(<MobilePageHeader title="Orders" description="Track and manage fulfilment" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
        expect(screen.getByText('Track and manage fulfilment')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
    });

    it('retains back navigation and page-specific actions', () => {
        const onBack = vi.fn();
        render(<MobilePageHeader title="Inventory" onBack={onBack} actions={<button>Grid view</button>} />);
        fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
        expect(onBack).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument();
    });
});
