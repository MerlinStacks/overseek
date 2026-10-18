import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { useDesignHistory } from './useDesignHistory';

describe('email undo/redo', () => {
    it('restores edits and clears redo after a new edit', () => {
        const { result } = renderHook(() => useDesignHistory(() => createDefaultEmailDesignV2({ title: 'Original' })));
        const edit = (title: string) => act(() => result.current.setDesign((current) => ({ ...current, document: { ...current.document, meta: { title } } })));
        edit('New subject');
        act(() => result.current.undo());
        expect(result.current.design.document.meta.title).toBe('Original');
        expect(result.current.canRedo).toBe(true);
        act(() => result.current.redo());
        expect(result.current.design.document.meta.title).toBe('New subject');
        act(() => result.current.undo());
        edit('Different subject');
        expect(result.current.canRedo).toBe(false);
    });
});
