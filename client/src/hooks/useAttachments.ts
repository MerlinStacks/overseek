/**
 * useAttachments - Manages file staging and upload for messages
 * 
 * Handles staging files before send, upload progress, and attachment removal.
 * Extracted from ChatWindow.tsx for improved modularity.
 */

import { useState, useRef, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import type { ConversationChannel } from '../components/chat/ChannelSelector';

interface UseAttachmentsOptions {
    conversationId: string;
    onSendMessage: (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccountId?: string) => Promise<void>;
}

interface UseAttachmentsResult {
    stagedAttachments: File[];
    isUploading: boolean;
    uploadProgress: number;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleRemoveAttachment: (index: number) => void;
    sendMessageWithAttachments: (content: string, type: 'AGENT' | 'SYSTEM', isInternal: boolean, channel?: ConversationChannel, emailAccountId?: string) => Promise<void>;
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

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        // Stage files locally - they will be uploaded when user sends the message
        setStagedAttachments(prev => [...prev, ...Array.from(files)]);

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
        emailAccId?: string
    ) => {
        // If no staged attachments, use normal send
        if (stagedAttachments.length === 0) {
            return onSendMessage(content, type, isInternal, channel, emailAccId);
        }

        // Upload attachments with message content
        setIsUploading(true);
        setUploadProgress(0);

        try {
            const formData = new FormData();
            formData.append('content', content);
            formData.append('type', type);
            formData.append('isInternal', String(isInternal));
            if (channel) formData.append('channel', channel);
            if (emailAccId) formData.append('emailAccountId', emailAccId);

            stagedAttachments.forEach(file => {
                formData.append('attachments', file);
            });

            const xhr = new XMLHttpRequest();

            await new Promise<void>((resolve, reject) => {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        setUploadProgress(Math.round((event.loaded / event.total) * 100));
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            reject(new Error(data.error || 'Failed to send message with attachments'));
                        } catch {
                            reject(new Error('Failed to send'));
                        }
                    }
                };

                xhr.onerror = () => reject(new Error('Network error'));

                xhr.open('POST', `/api/chat/${conversationId}/message-with-attachments`);
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.setRequestHeader('x-account-id', currentAccount?.id || '');
                xhr.send(formData);
            });

            // Clear staged attachments on success
            clearAttachments();
        } catch (error) {
            Logger.error('Failed to send message with attachments', { error });
            throw error;
        } finally {
            setIsUploading(false);
        }
    }, [stagedAttachments, onSendMessage, conversationId, token, currentAccount?.id, clearAttachments]);

    return {
        stagedAttachments,
        isUploading,
        uploadProgress,
        fileInputRef,
        handleFileUpload,
        handleRemoveAttachment,
        sendMessageWithAttachments,
        clearAttachments
    };
}
