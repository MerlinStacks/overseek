/**
 * ChatModals - Wrapper component for all chat modals.
 * Groups snooze, assign, merge, schedule, lightbox, and canned manager modals.
 */
import { CannedResponsesManager } from './CannedResponsesManager';
import { SnoozeModal } from './SnoozeModal';
import { AssignModal } from './AssignModal';
import { MergeModal } from './MergeModal';
import { ImageLightbox } from './ImageLightbox';
import { SchedulePickerModal } from './SchedulePickerModal';
import { Modal } from '../ui/Modal';

interface ChatModalsProps {
    conversationId: string;
    assigneeId?: string;
    // Canned manager
    showCannedManager: boolean;
    onCloseCannedManager: () => void;
    onCannedUpdate: () => void;
    // Snooze
    showSnoozeModal: boolean;
    onCloseSnooze: () => void;
    onSnooze: (snoozeUntil: Date) => Promise<void>;
    // Assign
    showAssignModal: boolean;
    onCloseAssign: () => void;
    onAssign?: (userId: string) => Promise<void>;
    // Merge
    showMergeModal: boolean;
    onCloseMerge: () => void;
    onMerge?: (targetId: string) => Promise<void>;
    // Lightbox
    lightboxImage: string | null;
    onCloseLightbox: () => void;
    // Schedule
    showScheduleModal: boolean;
    onCloseSchedule: () => void;
    onSchedule: (scheduledFor: Date) => Promise<void>;
    isScheduling: boolean;
}

/**
 * Renders all chat-related modals.
 * Keeps ChatWindow clean by extracting modal JSX.
 */
export function ChatModals({
    conversationId,
    assigneeId,
    showCannedManager,
    onCloseCannedManager,
    onCannedUpdate,
    showSnoozeModal,
    onCloseSnooze,
    onSnooze,
    showAssignModal,
    onCloseAssign,
    onAssign,
    showMergeModal,
    onCloseMerge,
    onMerge,
    lightboxImage,
    onCloseLightbox,
    showScheduleModal,
    onCloseSchedule,
    onSchedule,
    isScheduling
}: ChatModalsProps) {
    return (
        <>
            {/* Canned Responses Manager Modal */}
            <CannedResponsesManager
                isOpen={showCannedManager}
                onClose={onCloseCannedManager}
                onUpdate={onCannedUpdate}
            />

            {/* Snooze Modal */}
            <SnoozeModal
                key={`snooze-${conversationId}`}
                isOpen={showSnoozeModal}
                onClose={onCloseSnooze}
                onSnooze={onSnooze}
            />

            {/* Assign Modal */}
            {onAssign ? <AssignModal
                key={`assign-${conversationId}`}
                isOpen={showAssignModal}
                onClose={onCloseAssign}
                onAssign={onAssign}
                currentAssigneeId={assigneeId}
            /> : <Modal isOpen={showAssignModal} onClose={onCloseAssign} title="Assignment unavailable">
                <p>Conversation assignment is not available in this view.</p>
            </Modal>}

            {/* Merge Modal */}
            {onMerge ? <MergeModal
                isOpen={showMergeModal}
                onClose={onCloseMerge}
                onMerge={onMerge}
                currentConversationId={conversationId}
            /> : <Modal isOpen={showMergeModal} onClose={onCloseMerge} title="Merge unavailable">
                <p>Conversation merging is not available in this view.</p>
            </Modal>}

            {/* Image Lightbox */}
            {lightboxImage && (
                <ImageLightbox
                    src={lightboxImage}
                    onClose={onCloseLightbox}
                />
            )}

            {/* Schedule Message Modal */}
            <SchedulePickerModal
                isOpen={showScheduleModal}
                onClose={onCloseSchedule}
                onSchedule={onSchedule}
                isLoading={isScheduling}
            />
        </>
    );
}
