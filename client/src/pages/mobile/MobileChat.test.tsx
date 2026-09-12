import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileChat } from './MobileChat';

const { useMobileChatMock } = vi.hoisted(() => ({ useMobileChatMock: vi.fn() }));
vi.mock('./useMobileChat', () => ({ useMobileChat: useMobileChatMock }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-1' } }) }));

describe('MobileChat composer', () => {
    const state = () => ({
        conversation: { id: 'conversation-1', customerName: 'Sam', channel: 'chat' },
        messages: [], newMessage: '', loading: false, sending: false,
        inputRef: createRef<HTMLTextAreaElement>(), fileInputRef: createRef<HTMLInputElement>(),
        messagesContainerRef: createRef<HTMLDivElement>(), messagesEndRef: createRef<HTMLDivElement>(),
        filteredCanned: [{ id: 'reply-1', shortcut: 'hello', content: '<p>Hello <strong>Sam</strong></p>' }],
        cannedResponses: [{ id: 'reply-1', shortcut: 'hello', content: '<p>Hello <strong>Sam</strong></p>' }], showCanned: false,
        handleToggleCanned: vi.fn(), handleCloseCanned: vi.fn(), handleSelectCanned: vi.fn(), handleInputChange: vi.fn(),
        isRichText: false, setShowMenu: vi.fn(),
    });

    beforeEach(() => vi.clearAllMocks());

    it('starts multiline and resizes after programmatic draft changes and clearing', () => {
        const chat = state();
        useMobileChatMock.mockReturnValue(chat);
        const { rerender } = render(<MemoryRouter><MobileChat /></MemoryRouter>);
        const input = screen.getByRole('textbox', { name: 'Reply message' });
        expect(input).toHaveAttribute('rows', '3');
        expect(input).toHaveAttribute('enterkeyhint', 'enter');
        const scrollHeight = vi.spyOn(input, 'scrollHeight', 'get').mockReturnValue(192);
        useMobileChatMock.mockReturnValue({ ...chat, newMessage: 'A long saved reply\nSecond paragraph' });
        rerender(<MemoryRouter><MobileChat /></MemoryRouter>);
        expect(input).toHaveStyle({ height: '192px' });

        scrollHeight.mockReturnValue(72);
        useMobileChatMock.mockReturnValue(chat);
        rerender(<MemoryRouter><MobileChat /></MemoryRouter>);
        expect(input).toHaveStyle({ height: '72px' });
        scrollHeight.mockRestore();
    });

    it('opens the picker without editing input and renders searchable readable previews', () => {
        const chat = state();
        useMobileChatMock.mockReturnValue(chat);
        const { rerender } = render(<MemoryRouter><MobileChat /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Saved replies' }));
        expect(chat.handleToggleCanned).toHaveBeenCalledOnce();
        expect(chat.handleInputChange).not.toHaveBeenCalled();
        useMobileChatMock.mockReturnValue({ ...chat, showCanned: true });
        rerender(<MemoryRouter><MobileChat /></MemoryRouter>);
        expect(screen.getByText('Hello Sam')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
        expect(screen.getByText(/No matching saved replies/)).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sam' } });
        fireEvent.click(screen.getByRole('button', { name: '/hello Hello Sam' }));
        expect(chat.handleSelectCanned).toHaveBeenCalledWith(chat.cannedResponses[0]);
    });

    it('keeps the same editor and draft when expanded and collapsed', () => {
        useMobileChatMock.mockReturnValue({ ...state(), newMessage: 'Unsent reply' });
        render(<MemoryRouter><MobileChat /></MemoryRouter>);
        const input = screen.getByRole('textbox', { name: 'Reply message' });
        fireEvent.click(screen.getByRole('button', { name: 'Expand reply editor' }));
        expect(screen.getByRole('textbox', { name: 'Reply message' })).toBe(input);
        expect(input).toHaveValue('Unsent reply');
        expect(input).toHaveFocus();
        fireEvent.click(screen.getByRole('button', { name: 'Return to conversation' }));
        expect(screen.getByRole('textbox', { name: 'Reply message' })).toBe(input);
        expect(input).toHaveValue('Unsent reply');
    });

    it('renders formatted email drafts instead of HTML code', async () => {
        useMobileChatMock.mockReturnValue({ ...state(), isRichText: true, newMessage: '<p>Hello <strong>Sam</strong></p><p>Thanks!</p>' });
        render(<MemoryRouter><MobileChat /></MemoryRouter>);
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply message' })).toHaveTextContent('Hello Sam'));
        expect(screen.getByRole('textbox', { name: 'Reply message' }).querySelector('b, strong')).toHaveTextContent('Sam');
        expect(screen.getByRole('button', { name: 'Format Bold' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Reply message' })).not.toHaveTextContent('<p>');
    });

    it('opens customer context without losing the reply', () => {
        useMobileChatMock.mockReturnValue({ ...state(), newMessage: 'Keep this draft' });
        render(<MemoryRouter><MobileChat /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Customer details and recent orders' }));
        expect(screen.getByRole('dialog', { name: 'Customer details' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(screen.getByRole('textbox', { name: 'Reply message' })).toHaveValue('Keep this draft');
    });
});
