/** Reuse the account-isolated settings editor rather than maintaining a second mutation path. */
import { Modal } from '../ui/Modal';
import { CannedResponsesSettings } from '../settings/CannedResponsesSettings';

interface CannedResponsesManagerProps {
    isOpen: boolean;
    onClose: () => void;
    onUpdate?: () => void;
}

export function CannedResponsesManager({ isOpen, onClose, onUpdate }: CannedResponsesManagerProps) {
    return <Modal isOpen={isOpen} onClose={onClose} title="Manage canned responses" maxWidth="max-w-2xl">
        <CannedResponsesSettings onUpdate={onUpdate} />
    </Modal>;
}
