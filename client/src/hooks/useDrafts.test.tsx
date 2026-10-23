import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrafts } from './useDrafts';

describe('useDrafts', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => vi.useRealTimers());

    it('restores the latest draft even before its storage write', () => {
        const { result, unmount } = renderHook(() => useDrafts());
        act(() => {
            result.current.saveDraft('first', 'Initial text');
            result.current.saveDraft('first', 'Latest text');
        });
        expect(result.current.getDraft('first')).toBe('Latest text');
        expect(result.current.hasDraft('first')).toBe(true);
        unmount();
        expect(localStorage.getItem('inbox_draft_first')).toBe('Latest text');
    });

    it('preserves both drafts when switching conversations before the debounce expires', () => {
        const { result, unmount } = renderHook(() => useDrafts());
        act(() => {
            result.current.saveDraft('first', 'First draft');
            result.current.saveDraft('second', 'Second draft');
            vi.advanceTimersByTime(500);
        });
        expect(result.current.getDraft('first')).toBe('First draft');
        expect(result.current.getDraft('second')).toBe('Second draft');
        expect(localStorage.getItem('inbox_draft_first')).toBe('First draft');
        expect(localStorage.getItem('inbox_draft_second')).toBe('Second draft');
        unmount();
    });

    it('persists the latest pending draft on unmount', () => {
        const { result, unmount } = renderHook(() => useDrafts());
        act(() => result.current.saveDraft('first', 'Unfinished message'));
        unmount();
        expect(localStorage.getItem('inbox_draft_first')).toBe('Unfinished message');
    });

    it('clearing one conversation does not cancel another conversation draft', () => {
        const { result, unmount } = renderHook(() => useDrafts());
        act(() => {
            result.current.saveDraft('first', 'Already sent');
            result.current.saveDraft('second', 'Keep this draft');
            result.current.clearDraft('first');
            vi.advanceTimersByTime(500);
        });
        expect(result.current.getDraft('first')).toBe('');
        expect(result.current.getDraft('second')).toBe('Keep this draft');
        unmount();
        expect(localStorage.getItem('inbox_draft_first')).toBeNull();
        expect(localStorage.getItem('inbox_draft_second')).toBe('Keep this draft');
    });

    it('deletes a persisted draft when its content becomes empty', () => {
        localStorage.setItem('inbox_draft_conversation-1', 'old draft');
        const { result, unmount } = renderHook(() => useDrafts());

        act(() => {
            result.current.saveDraft('conversation-1', '<p><br></p>');
            vi.advanceTimersByTime(500);
        });

        expect(localStorage.getItem('inbox_draft_conversation-1')).toBeNull();
        unmount();
        vi.useRealTimers();
    });
});
