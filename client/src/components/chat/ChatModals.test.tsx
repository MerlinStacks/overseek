import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./CannedResponsesManager', () => ({ CannedResponsesManager: () => null }));
vi.mock('./SnoozeModal', () => ({ SnoozeModal: () => null }));
vi.mock('./ImageLightbox', () => ({ ImageLightbox: () => null }));
vi.mock('./SchedulePickerModal', () => ({ SchedulePickerModal: () => null }));
vi.mock('./AssignModal', () => ({ AssignModal: ({ isOpen, onAssign }: { isOpen: boolean; onAssign: (id: string) => Promise<void> }) => isOpen ? <button onClick={() => onAssign('user')}>Assign</button> : null }));
vi.mock('./MergeModal', () => ({ MergeModal: ({ isOpen, onMerge }: { isOpen: boolean; onMerge: (id: string) => Promise<void> }) => isOpen ? <button onClick={() => onMerge('target')}>Merge</button> : null }));
import { ChatModals } from './ChatModals';
afterEach(cleanup);
const props = () => ({
    conversationId: 'conversation', showCannedManager: false, onCloseCannedManager: vi.fn(), onCannedUpdate: vi.fn(),
    showSnoozeModal: false, onCloseSnooze: vi.fn(), onSnooze: vi.fn(),
    showAssignModal: false, onCloseAssign: vi.fn(), showMergeModal: false, onCloseMerge: vi.fn(),
    lightboxImage: null, onCloseLightbox: vi.fn(), showScheduleModal: false, onCloseSchedule: vi.fn(), onSchedule: vi.fn(), isScheduling: false,
});
describe('chat modal capabilities', () => {
    it('shows a dismissible explanation instead of a successful no-op assignment', () => {
        const callbacks = props(); render(<ChatModals {...callbacks} showAssignModal />);
        expect(screen.getByRole('dialog')).toHaveTextContent('assignment is not available');
        expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(callbacks.onCloseAssign).toHaveBeenCalledOnce();
    });
    it('shows an explanation for an unavailable merge', () => {
        render(<ChatModals {...props()} showMergeModal />);
        expect(screen.getByRole('dialog')).toHaveTextContent('merging is not available');
        expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    });
    it('passes available actions through unchanged', async () => {
        const assign = vi.fn().mockResolvedValue(undefined); const merge = vi.fn().mockResolvedValue(undefined);
        render(<ChatModals {...props()} showAssignModal showMergeModal onAssign={assign} onMerge={merge} />);
        fireEvent.click(screen.getByRole('button', { name: 'Assign' })); fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
        await waitFor(() => { expect(assign).toHaveBeenCalledWith('user'); expect(merge).toHaveBeenCalledWith('target'); });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
