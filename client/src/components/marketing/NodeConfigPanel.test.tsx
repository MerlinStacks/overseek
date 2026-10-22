import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeConfigPanel } from './NodeConfigPanel';

vi.mock('./nodeConfigs', () => ({
    ActionConfig: () => <div>Email configuration</div>,
    TriggerConfig: () => <div>Trigger configuration</div>,
    DelayConfig: () => <div>Delay configuration</div>,
    ConditionConfig: () => <div>Condition configuration</div>,
}));

afterEach(cleanup);

describe('node configuration dialog layout', () => {
    it.each(['SEND_EMAIL', undefined])('widens %s email actions while keeping footer actions outside the scroll area', async (actionType) => {
        const close = vi.fn();
        await act(async () => {
            render(<NodeConfigPanel node={{ id: 'email', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Send Email', config: { actionType } } }} onClose={close} onUpdate={vi.fn()} onDelete={vi.fn()} />);
        });
        const dialog = screen.getByRole('dialog', { name: 'Send Email' });
        expect(dialog).toHaveClass('max-w-6xl', 'max-h-[92dvh]');
        expect(screen.getByText('Email configuration').parentElement).toHaveClass('overflow-y-auto');
        expect(screen.getByRole('button', { name: 'Apply to draft' }).parentElement?.parentElement).toHaveClass('shrink-0');
        fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
        expect(close).toHaveBeenCalledOnce();
    });

    it('keeps other action dialogs compact', async () => {
        await act(async () => {
            render(<NodeConfigPanel node={{ id: 'sms', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Send SMS', config: { actionType: 'SEND_SMS' } } }} onClose={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />);
        });
        expect(screen.getByRole('dialog', { name: 'Send SMS' })).toHaveClass('max-w-xl');
    });

    it('does not apply typing or cancellation to the parent flow', async () => {
        const update = vi.fn();
        await act(async () => { render(<NodeConfigPanel node={{ id: 'email', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Original', config: {} } }} onClose={vi.fn()} onUpdate={update} onDelete={vi.fn()} />); });
        fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Local draft' } });
        expect(update).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(update).not.toHaveBeenCalled();
    });

    it('applies the local changes only when explicitly confirmed', async () => {
        const update = vi.fn();
        await act(async () => { render(<NodeConfigPanel node={{ id: 'email', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Original', config: {} } }} onClose={vi.fn()} onUpdate={update} onDelete={vi.fn()} />); });
        fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Local draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
        expect(update).toHaveBeenCalledExactlyOnceWith('email', expect.objectContaining({ label: 'Local draft' }));
    });
});
