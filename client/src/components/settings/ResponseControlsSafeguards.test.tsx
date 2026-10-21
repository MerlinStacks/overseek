import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CannedResponseForm } from './CannedResponseForm';
import { CannedResponseLabelManager } from './CannedResponseLabelManager';
import { CannedResponseList } from './CannedResponseList';
import { hasResponseText } from './cannedResponseValues';
vi.mock('../common/RichTextEditor', () => ({ RichTextEditor: ({ ariaLabel, value }: { ariaLabel: string; value: string }) => <textarea aria-label={ariaLabel} value={value} readOnly /> }));
afterEach(cleanup);
describe('canned-response controls', () => {
    it.each(['<p><br></p>', '<p>&nbsp;</p>', '<script>alert(1)</script>', '<p>\u200B</p>'])('rejects visually empty content %s', content => { expect(hasResponseText(content)).toBe(false); });
    it('validates an available label and names the editor without submitting the enclosing form', () => {
        const save = vi.fn(); const view = render(<form><CannedResponseForm formData={{ shortcut: 'hello', content: '<p>Hi</p>', labelId: 'missing' }} labels={[]} editingId={null} onFormChange={vi.fn()} onSave={save} onCancel={vi.fn()} /></form>);
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled(); expect(screen.getByLabelText('Response content')).toBeInTheDocument(); expect(screen.getByLabelText('Shortcut')).toHaveValue('hello');
        view.rerender(<form><CannedResponseForm formData={{ shortcut: 'hello', content: '<p>Hi</p>', labelId: '' }} labels={[]} editingId={null} onFormChange={vi.fn()} onSave={save} onCancel={vi.fn()} /></form>); const button = screen.getByRole('button', { name: 'Add' }); expect(button).toHaveAttribute('type', 'button'); fireEvent.click(button); expect(save).toHaveBeenCalledOnce();
    });
    it('edits a local label draft and cancels without changing shared labels or refetching', () => {
        const label = Object.freeze({ id: 'label', name: 'Original', color: '#123456' }); const change = vi.fn(); const refresh = vi.fn(); const cancel = vi.fn();
        render(<CannedResponseLabelManager labels={[label]} editingLabelId="label" newLabelName="" newLabelColor="#123456" onLabelsChange={change} onEditingLabelIdChange={cancel} onNewLabelNameChange={vi.fn()} onNewLabelColorChange={vi.fn()} onCreateLabel={vi.fn()} onUpdateLabel={vi.fn()} onDeleteLabel={vi.fn()} onRefreshLabels={refresh} />);
        fireEvent.change(screen.getByLabelText('Label name'), { target: { value: 'Unsaved' } }); expect(label.name).toBe('Original'); expect(change).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Cancel editing label Original' })); expect(cancel).toHaveBeenCalledWith(null); expect(refresh).not.toHaveBeenCalled();
    });
    it('names preset colors and prevents Enter from submitting an enclosing form', () => {
        const create = vi.fn(); render(<CannedResponseLabelManager labels={[]} editingLabelId={null} newLabelName="Name" newLabelColor="#6366f1" onLabelsChange={vi.fn()} onEditingLabelIdChange={vi.fn()} onNewLabelNameChange={vi.fn()} onNewLabelColorChange={vi.fn()} onCreateLabel={create} onUpdateLabel={vi.fn()} onDeleteLabel={vi.fn()} onRefreshLabels={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Use color #6366f1' })).toHaveAttribute('aria-pressed', 'true'); const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); screen.getByLabelText('New label name').dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(create).toHaveBeenCalledOnce();
    });
    it('keeps sanitization and names response actions', () => {
        const view = render(<CannedResponseList groups={[{ name: 'Group', label: null, items: [{ id: 'r', shortcut: 'hello', content: '<script>bad()</script><p>Hello</p>', labelId: null, label: null }] }]} editingId={null} isLoading={false} searchQuery="" onEdit={vi.fn()} onDelete={vi.fn()} />);
        expect(view.container.querySelector('script')).toBeNull(); expect(screen.getByRole('button', { name: 'Delete response /hello' })).toHaveAttribute('type', 'button');
    });
});
