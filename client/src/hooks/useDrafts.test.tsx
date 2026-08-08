import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrafts } from './useDrafts';

describe('useDrafts', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
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
