/**
 * ChatComposer - Message composition area with toolbar and canned responses.
 * Handles the reply/private note toggle, channel selector, and send controls.
 */
import { useState, memo } from 'react';
import { Paperclip, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { InboxRichTextEditor } from './InboxRichTextEditor';
import { ChannelSelector, ConversationChannel } from './ChannelSelector';
import { CannedResponse } from '../../hooks/useCannedResponses';
import { ComposerToolbar } from './ComposerToolbar';
import type { OutboundSafetyIssue } from '../../utils/outboundSafety';

interface ChannelOption {
    channel: ConversationChannel;
    identifier: string;
    available: boolean;
}

interface EmailAccountOption {
    id: string;
    name: string;
    email: string;
}

interface ChatComposerProps {
    conversationId: string;
    recipientEmail?: string;
    // Input state
    input: string;
    onInputChange: (value: string) => void;
    // Internal note toggle
    isInternal: boolean;
    onInternalChange: (value: boolean) => void;
    // Send controls
    isSending: boolean;
    onSend: (e?: React.FormEvent, channel?: ConversationChannel) => void;
    pendingSend: { content: string; timeout: NodeJS.Timeout } | null;
    onCancelSend: () => void;
    UNDO_DELAY_MS: number;
    // Signature
    signatureEnabled: boolean;
    onSignatureChange: (value: boolean) => void;
    // Quote reply
    quotedMessage: { id: string; content: string; senderType: string } | null;
    onClearQuote: () => void;
    recipientName?: string;
    // Canned responses
    showCanned: boolean;
    filteredCanned: CannedResponse[];
    cannedResponses: CannedResponse[];
    onSelectCanned: (response: CannedResponse) => void;
    onOpenCannedManager: () => void;
    // AI Draft
    isGeneratingDraft: boolean;
    onGenerateAIDraft: () => void;
    // File upload
    isUploading: boolean;
    uploadProgress?: number;
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    // Staged attachments
    stagedAttachments?: File[];
    onRemoveAttachment?: (index: number) => void;
    /** Error from file staging (size/count limit exceeded) */
    attachmentError?: string | null;
    // Scheduling
    onOpenSchedule: () => void;
    // Channel selection
    availableChannels?: ChannelOption[];
    currentChannel?: ConversationChannel;
    // Email account selection (From dropdown)
    emailAccounts?: EmailAccountOption[];
    selectedEmailAccountId?: string;
    onEmailAccountChange?: (accountId: string) => void;
    // Collision-safety draft presence
    activeDraftingAgents?: Array<{ id: string; name: string; avatarUrl?: string | null }>;
    // Outbound safety gate
    safetyIssues?: OutboundSafetyIssue[];
    requiresSafetyApproval?: boolean;
    onApproveSafetySend?: (channel?: ConversationChannel) => void;
    onDismissSafetyWarnings?: () => void;
}

/**
 * Renders the message composition area including toolbar and controls.
 */
export const ChatComposer = memo(function ChatComposer({
    recipientEmail,
    input,
    onInputChange,
    isInternal,
    onInternalChange,
    isSending,
    onSend,
    pendingSend,
    onCancelSend: _onCancelSend,
    UNDO_DELAY_MS: _UNDO_DELAY_MS,
    signatureEnabled,
    onSignatureChange,
    quotedMessage,
    onClearQuote,
    recipientName,
    showCanned,
    filteredCanned,
    cannedResponses,
    onSelectCanned,
    onOpenCannedManager,
    isGeneratingDraft,
    onGenerateAIDraft,
    isUploading,
    uploadProgress = 0,
    onFileUpload,
    fileInputRef,
    stagedAttachments = [],
    onRemoveAttachment,
    attachmentError,
    onOpenSchedule,
    availableChannels,
    currentChannel,
    emailAccounts,
    selectedEmailAccountId,
    onEmailAccountChange,
    activeDraftingAgents = [],
    safetyIssues = [],
    requiresSafetyApproval = false,
    onApproveSafetySend,
    onDismissSafetyWarnings
}: ChatComposerProps) {
    const [selectedChannel, setSelectedChannel] = useState<ConversationChannel>(currentChannel || 'CHAT');

    const MAX_SMS_LENGTH = 1600;
    const plainTextLength = input.replace(/<[^>]*>/g, '').length;
    const isSmsTooLong = selectedChannel === 'SMS' && plainTextLength > MAX_SMS_LENGTH;

    return (
        <div className="border-t border-gray-200 bg-white">
            {/* Canned Responses Dropdown */}
            {showCanned && (
                <div className="border-b border-gray-200 bg-white max-h-48 overflow-y-auto">
                    <div className="p-2 text-xs text-gray-500 border-b bg-gray-50 flex items-center justify-between">
                        <span>Canned Responses (type to filter)</span>
                        <button
                            onClick={() => {
                                onOpenCannedManager();
                                onInputChange('');
                            }}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                        >
                            <span className="sr-only">Manage</span>
                            Manage
                        </button>
                    </div>
                    {filteredCanned.length > 0 ? (
                        filteredCanned.map(r => (
                            <button
                                key={r.id}
                                onClick={() => onSelectCanned(r)}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                            >
                                <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded-sm text-gray-600">
                                    /{r.shortcut}
                                </span>
                                <p className="text-sm text-gray-700 mt-1 line-clamp-1">{r.content}</p>
                            </button>
                        ))
                    ) : (
                        <div className="px-3 py-4 text-center text-gray-500 text-sm">
                            {cannedResponses.length === 0 ? (
                                <>No canned responses yet. <button onClick={onOpenCannedManager} className="text-blue-600 hover:underline">Add one</button></>
                            ) : (
                                'No matches found'
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Reply Mode Toggle */}
            <div className="flex border-b border-gray-100">
                <button
                    onClick={() => onInternalChange(false)}
                    className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                        !isInternal
                            ? "border-blue-600 text-blue-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                    )}
                >
                    Reply
                </button>
                <button
                    onClick={() => onInternalChange(true)}
                    className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                        isInternal
                            ? "border-yellow-500 text-yellow-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                    )}
                >
                    Private Note
                </button>
            </div>

            {/* Quote Reply Preview */}
            {quotedMessage && (
                <div className="px-4 py-2 border-b border-gray-100 bg-blue-50 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="text-xs text-blue-600 font-medium mb-0.5">
                            Replying to {quotedMessage.senderType === 'AGENT' ? 'yourself' : (recipientName || 'customer')}
                        </div>
                        <div className="text-sm text-gray-600 truncate">
                            {quotedMessage.content.replace(/<[^>]*>/g, '').substring(0, 80)}
                            {quotedMessage.content.length > 80 ? '...' : ''}
                        </div>
                    </div>
                    <button
                        onClick={onClearQuote}
                        className="p-1 rounded-sm hover:bg-blue-100 text-blue-400"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Channel Selector for replies */}
            {!isInternal && availableChannels && availableChannels.length > 0 && (
                <div className="px-4 py-2 border-b border-gray-100">
                    <ChannelSelector
                        channels={availableChannels}
                        selectedChannel={selectedChannel}
                        onChannelChange={setSelectedChannel}
                        disabled={isSending}
                    />
                </div>
            )}

            {/* From field (Email Account Selector) - show when using EMAIL channel */}
            {!isInternal && recipientEmail && emailAccounts && emailAccounts.length > 1 && (
                <div className="px-4 py-2 border-b border-gray-100 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-12">FROM</span>
                        <select
                            value={selectedEmailAccountId}
                            onChange={(e) => onEmailAccountChange?.(e.target.value)}
                            className="flex-1 text-gray-700 bg-transparent border-none outline-none cursor-pointer hover:text-blue-600 text-sm"
                        >
                            {emailAccounts.map(account => (
                                <option key={account.id} value={account.id}>
                                    {account.name} ({account.email})
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* Fallback: Simple TO field when no channel options */}
            {!isInternal && (!availableChannels || availableChannels.length === 0) && recipientEmail && (
                <div className="px-4 py-2 border-b border-gray-100 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-12">TO</span>
                        <span className="text-gray-700">{recipientEmail}</span>
                    </div>
                </div>
            )}

            {/* Compose Area */}
            <div className={cn("p-4", isInternal && "bg-yellow-50")}>
                {activeDraftingAgents.length > 0 && !isInternal && (
                    <div className="mb-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs">
                        {activeDraftingAgents.length === 1
                            ? `${activeDraftingAgents[0].name} is drafting a reply in this conversation.`
                            : `${activeDraftingAgents.length} teammates are drafting replies in this conversation.`}
                    </div>
                )}
                {safetyIssues.length > 0 && !isInternal && (
                    <div className="mb-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs">
                        <div className="font-semibold mb-1">Outbound safety check</div>
                        {safetyIssues.slice(0, 3).map((issue) => (
                            <div key={issue.code}>• {issue.message}</div>
                        ))}
                        <div className="mt-2 flex items-center gap-2">
                            {requiresSafetyApproval && onApproveSafetySend && (
                                <button
                                    type="button"
                                    onClick={() => onApproveSafetySend(selectedChannel)}
                                    className="px-2.5 py-1 rounded bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700"
                                >
                                    Approve And Send
                                </button>
                            )}
                            {onDismissSafetyWarnings && (
                                <button
                                    type="button"
                                    onClick={onDismissSafetyWarnings}
                                    className="px-2.5 py-1 rounded bg-white border border-red-200 text-red-700 text-[11px] font-semibold hover:bg-red-100"
                                >
                                    Dismiss
                                </button>
                            )}
                        </div>
                    </div>
                )}
                <InboxRichTextEditor
                    value={input}
                    onChange={onInputChange}
                    onSubmit={() => {
                        if (!showCanned) {
                            onSend(undefined, selectedChannel);
                        } else if (filteredCanned.length > 0) {
                            onSelectCanned(filteredCanned[0]);
                        }
                    }}
                    placeholder={isInternal
                        ? "Add a private note (only visible to team)..."
                        : "Type your reply... (/ for canned responses)"}
                    isInternal={isInternal}
                    cannedPickerOpen={showCanned}
                    toolbarRightSlot={(
                        <ComposerToolbar
                            input={input}
                            isInternal={isInternal}
                            isSending={isSending}
                            showCanned={showCanned}
                            pendingSend={pendingSend}
                            recipientEmail={recipientEmail}
                            signatureEnabled={signatureEnabled}
                            onSignatureChange={onSignatureChange}
                            isGeneratingDraft={isGeneratingDraft}
                            onGenerateAIDraft={onGenerateAIDraft}
                            isUploading={isUploading}
                            onInputChange={onInputChange}
                            fileInputRef={fileInputRef}
                            onFileUpload={onFileUpload}
                            stagedAttachments={stagedAttachments}
                            selectedChannel={selectedChannel}
                            isSmsTooLong={isSmsTooLong}
                            plainTextLength={plainTextLength}
                            maxSmsLength={MAX_SMS_LENGTH}
                            onSend={onSend}
                            onOpenSchedule={onOpenSchedule}
                        />
                    )}
                />

                {/* Staged Attachments Pills */}
                {stagedAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2 px-1">
                        {stagedAttachments.map((file, index) => (
                            <div
                                key={`${file.name}-${index}`}
                                className="group inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-white border border-blue-200 rounded-full text-sm shadow-sm"
                            >
                                <Paperclip size={14} className="text-blue-500" />
                                <span className="text-gray-700 max-w-[150px] truncate">{file.name}</span>
                                <span className="text-xs text-gray-400">
                                    ({(file.size / 1024).toFixed(0)}KB)
                                </span>
                                {onRemoveAttachment && (
                                    <button
                                        type="button"
                                        onClick={() => onRemoveAttachment(index)}
                                        disabled={isUploading}
                                        className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                                        title="Remove attachment"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Attachment Error */}
                {attachmentError && (
                    <div className="mt-2 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg">
                        ⚠️ {attachmentError}
                    </div>
                )}

                {/* Upload Progress Bar */}
                {isUploading && uploadProgress > 0 && (
                    <div className="mt-2 px-1 space-y-1">
                        <div className="flex items-center justify-between text-xs text-gray-600">
                            <span>Uploading attachments...</span>
                            <span className="font-medium">{uploadProgress}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-200"
                                style={{ width: `${uploadProgress}%` }}
                            />
                        </div>
                    </div>
                )}

                <div className="mt-2 text-[11px] text-gray-400">
                    Ctrl/Cmd + Enter to send • Type / for canned responses
                </div>
            </div>
        </div >
    );
});
