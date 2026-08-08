/**
 * useAttachments - Manages file staging and upload for messages
 * 
 * Handles staging files before send, upload progress, and attachment removal.
 * Extracted from ChatWindow.tsx for improved modularity.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import type { ConversationChannel } from '../components/chat/ChannelSelector';
import type { MessageSendResponse, SendMessageHandler } from '../types/inbox';

interface UseAttachmentsOptions {
    conversationId: string;
    onSendMessage: SendMessageHandler;
}

/** 10 MB per file — matches inbox relay limit. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** Maximum files that can be staged at once. */
const MAX_FILE_COUNT = 10;

interface UseAttachmentsResult {
    stagedAttachments: File[];
    isUploading: boolean;
    uploadProgress: number;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    /** Error message from last file staging attempt, if any. */
    attachmentError: string | null;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleRemoveAttachment: (index: number) => void;
    sendMessageWithAttachments: (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccountId?: string, clientRequestId?: string) => Promise<void>;
    clearAttachments: () => void;
}

/**
 * Manages file staging, upload progress, and attachment handling.
 */
export function useAttachments({ conversationId, onSendMessage }: UseAttachmentsOptions): UseAttachmentsResult {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [stagedAttachments, setStagedAttachments] = useState<File[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const activeUploadRef = useRef<XMLHttpRequest | null>(null);
    const requestSequenceRef = useRef(0);
    const identityRef = useRef({ conversationId, accountId: currentAccount?.id });
    identityRef.current = { conversationId, accountId: currentAccount?.id };

    // Clear staged attachments when switching conversations
    useEffect(() => {
        requestSequenceRef.current += 1;
        activeUploadRef.current?.abort();
        activeUploadRef.current = null;
        setStagedAttachments([]);
        setIsUploading(false);
        setUploadProgress(0);
        setAttachmentError(null);
        return () => {
            requestSequenceRef.current += 1;
            activeUploadRef.current?.abort();
            activeUploadRef.current = null;
        };
    }, [conversationId, currentAccount?.id]);

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setAttachmentError(null);

        const incoming = Array.from(files);

        // Validate file sizes
        const oversized = incoming.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length > 0) {
            const names = oversized.map(f => f.name).join(', ');
            setAttachmentError(`File(s) exceed 10 MB limit: ${names}`);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        // Validate total count
        setStagedAttachments(prev => {
            if (prev.length + incoming.length > MAX_FILE_COUNT) {
                setAttachmentError(`Maximum ${MAX_FILE_COUNT} attachments allowed`);
                return prev;
            }
            return [...prev, ...incoming];
        });

        // Reset input so same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const handleRemoveAttachment = useCallback((index: number) => {
        setStagedAttachments(prev => prev.filter((_, i) => i !== index));
    }, []);

    const clearAttachments = useCallback(() => {
        setStagedAttachments([]);
        setUploadProgress(0);
    }, []);

    const sendMessageWithAttachments = useCallback(async (
        content: string,
        type: 'AGENT' | 'SYSTEM',
        isInternal: boolean,
        channel?: ConversationChannel,
        emailAccId?: string,
        clientRequestId?: string
    ) => {
        // If no staged attachments, use normal send
        if (stagedAttachments.length === 0) {
            return onSendMessage(content, type, isInternal, channel, emailAccId, clientRequestId);
        }
        if (!token || !currentAccount) return;

        const requestConversationId = conversationId;
        const requestAccountId = currentAccount.id;
        const requestSequence = ++requestSequenceRef.current;

        // Upload attachments with message content
        setIsUploading(true);
        setUploadProgress(0);
        setAttachmentError(null);

        try {
            const formData = new FormData();
            formData.append('content', content);
            formData.append('type', type);
            formData.append('isInternal', String(isInternal));
            if (channel) formData.append('channel', channel);
            if (emailAccId) formData.append('emailAccountId', emailAccId);
            if (clientRequestId) formData.append('clientRequestId', clientRequestId);

            stagedAttachments.forEach(file => {
                formData.append('attachments', file);
            });

            const xhr = new XMLHttpRequest();
            activeUploadRef.current = xhr;

            await new Promise<void>((resolve, reject) => {
                xhr.upload.onprogress = (event) => {
                    if (requestSequence === requestSequenceRef.current && event.lengthComputable) {
                        setUploadProgress(Math.round((event.loaded / event.total) * 100));
                    }
                };

                xhr.onload = async () => {
                    let data: MessageSendResponse = {};
                    try {
                        data = JSON.parse(xhr.responseText) as MessageSendResponse;
                    } catch {
                        // Some successful responses may not include JSON.
                    }

                    if (data.message) {
                        try {
                            await onSendMessage(content, type, isInternal, channel, emailAccId, clientRequestId, data.message);
                        } catch (error) {
                            reject(error);
                            return;
                        }
                    }
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error(data.error || data.message?.deliveryError || 'Failed to send message with attachments'));
                    }
                };

                xhr.onerror = () => reject(new Error('Network error'));
                xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));

                xhr.open('POST', `/api/chat/${requestConversationId}/message-with-attachments`);
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.setRequestHeader('x-account-id', requestAccountId);
                xhr.send(formData);
            });

            if (identityRef.current.conversationId !== requestConversationId || identityRef.current.accountId !== requestAccountId) return;
            // Clear staged attachments on success
            clearAttachments();
            setAttachmentError(null);
        } catch (error) {
            if (requestSequence !== requestSequenceRef.current || (error instanceof DOMException && error.name === 'AbortError')) return;
            Logger.error('Failed to send message with attachments', { error });
            const message = error instanceof Error ? error.message : 'Failed to send message with attachments';
            setAttachmentError(message);
            throw error;
        } finally {
            if (requestSequence === requestSequenceRef.current) {
                activeUploadRef.current = null;
                setIsUploading(false);
            }
        }
    }, [stagedAttachments, onSendMessage, conversationId, token, currentAccount?.id, clearAttachments]);

    return {
        stagedAttachments,
        isUploading,
        uploadProgress,
        fileInputRef,
        attachmentError,
        handleFileUpload,
        handleRemoveAttachment,
        sendMessageWithAttachments,
        clearAttachments
    };
}
