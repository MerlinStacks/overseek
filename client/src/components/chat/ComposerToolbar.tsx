/**
 * ComposerToolbar - Inline action controls for the inbox rich text toolbar.
 * Provides AI draft, canned response trigger, attachment, signature, send, and schedule controls.
 */
import { Send, Loader2, Zap, Paperclip, FileSignature, Sparkles, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';
import type { ConversationChannel } from './ChannelSelector';

interface ComposerToolbarProps {
    input: string;
    isInternal: boolean;
    isSending: boolean;
    showCanned: boolean;
    pendingSend: unknown | null;
    recipientEmail?: string;
    signatureEnabled: boolean;
    onSignatureChange: (value: boolean) => void;
    isGeneratingDraft: boolean;
    onGenerateAIDraft: () => void;
    isUploading: boolean;
    onInputChange: (value: string) => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    stagedAttachments: File[];
    selectedChannel: ConversationChannel;
    isSmsTooLong: boolean;
    plainTextLength: number;
    maxSmsLength: number;
    onSend: (e?: React.FormEvent, channel?: ConversationChannel) => void;
    onOpenSchedule: () => void;
}

/**
 * Renders the compose-area toolbar with action buttons and send controls.
 */
export function ComposerToolbar({
    input,
    isInternal,
    isSending,
    showCanned,
    pendingSend,
    recipientEmail,
    signatureEnabled,
    onSignatureChange,
    isGeneratingDraft,
    onGenerateAIDraft,
    isUploading,
    onInputChange,
    fileInputRef,
    onFileUpload,
    stagedAttachments,
    selectedChannel,
    isSmsTooLong,
    plainTextLength,
    maxSmsLength,
    onSend,
    onOpenSchedule
}: ComposerToolbarProps) {
    const { user } = useAuth();
    const hasTextContent = input.replace(/<[^>]*>/g, '').trim().length > 0;
    const isSendDisabled = !hasTextContent || isSending || showCanned || !!pendingSend || isSmsTooLong;

    return (
        <>
            <div className="flex items-center gap-1 pr-1 border-r border-gray-200">
                <button
                    type="button"
                    onClick={onGenerateAIDraft}
                    disabled={isGeneratingDraft}
                    className="p-2 rounded-sm hover:bg-purple-50 text-purple-500 hover:text-purple-600 transition-colors disabled:opacity-50"
                    title="Generate AI Draft Reply"
                    aria-label="Generate AI draft reply"
                >
                    {isGeneratingDraft ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                </button>
                <button
                    type="button"
                    onClick={() => onInputChange('/')}
                    className="p-2 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Canned Responses"
                    aria-label="Insert canned response"
                >
                    <Zap size={18} />
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={onFileUpload}
                    className="hidden"
                    accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                    multiple
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={cn(
                        "p-2 rounded-sm transition-colors disabled:opacity-50",
                        stagedAttachments.length > 0
                            ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                            : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                    )}
                    title="Attach File"
                    aria-label="Attach file"
                >
                    {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                </button>
                {/* Email Signature Toggle */}
                {recipientEmail && (
                    <button
                        type="button"
                        onClick={() => onSignatureChange(!signatureEnabled)}
                        className={cn(
                            "p-2 rounded-sm transition-colors",
                            signatureEnabled && user?.emailSignature
                                ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                                : "text-gray-400 hover:bg-gray-100 hover:text-gray-600",
                            !user?.emailSignature && "opacity-50 cursor-not-allowed"
                        )}
                        title={!user?.emailSignature
                            ? "No signature configured - set one in your profile"
                            : signatureEnabled
                                ? "Signature enabled (click to disable)"
                                : "Enable email signature"
                        }
                        disabled={!user?.emailSignature}
                    >
                        <FileSignature size={18} />
                    </button>
                )}
            </div>

            {selectedChannel === 'SMS' && (
                <div className={cn("text-xs px-1", isSmsTooLong ? "text-red-600 font-medium" : "text-gray-400")}>
                    {plainTextLength}/{maxSmsLength}
                </div>
            )}

            <div className="relative flex">
                <button
                    onClick={() => onSend(undefined, selectedChannel)}
                    disabled={isSendDisabled}
                    className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-l-lg font-medium text-sm transition-colors",
                        isInternal
                            ? "bg-yellow-500 text-white hover:bg-yellow-600"
                            : "bg-blue-600 text-white hover:bg-blue-700",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                >
                    {isSending ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <>
                            Send
                            <Send size={14} />
                        </>
                    )}
                </button>
                {!isInternal && (
                    <button
                        onClick={onOpenSchedule}
                        disabled={isSendDisabled}
                        className={cn(
                            "px-2 py-2 rounded-r-lg font-medium text-sm transition-colors border-l border-blue-700",
                            "bg-blue-600 text-white hover:bg-blue-700",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                        title="Schedule for later"
                    >
                        <ChevronDown size={14} />
                    </button>
                )}
            </div>
        </>
    );
}
