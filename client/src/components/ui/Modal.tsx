import React, { useEffect, useEffectEvent, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose?: () => void;
    title?: React.ReactNode;
    children: React.ReactNode;
    maxWidth?: string;
}

const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

interface BackgroundState {
    count: number;
    ariaHidden: string | null;
    inert: boolean;
}

const backgroundStates = new Map<HTMLElement, BackgroundState>();
const openDialogs: HTMLElement[] = [];
let bodyLockCount = 0;
let originalBodyOverflow = '';

function lockBackground(modalRoot: HTMLElement) {
    if (bodyLockCount === 0) {
        originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    bodyLockCount += 1;

    const backgroundElements = Array.from(document.body.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modalRoot);

    backgroundElements.forEach(element => {
        const current = backgroundStates.get(element);
        if (current) {
            current.count += 1;
            return;
        }
        backgroundStates.set(element, {
            count: 1,
            ariaHidden: element.getAttribute('aria-hidden'),
            inert: element.inert,
        });
        element.setAttribute('aria-hidden', 'true');
        element.inert = true;
    });

    return () => {
        backgroundElements.forEach(element => {
            const current = backgroundStates.get(element);
            if (!current) return;
            current.count -= 1;
            if (current.count > 0) return;

            if (current.ariaHidden === null) element.removeAttribute('aria-hidden');
            else element.setAttribute('aria-hidden', current.ariaHidden);
            element.inert = current.inert;
            backgroundStates.delete(element);
        });

        bodyLockCount -= 1;
        if (bodyLockCount === 0) document.body.style.overflow = originalBodyOverflow;
    };
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
    const modalRootRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const closeDialog = useEffectEvent(() => {
        if (!onClose) return false;
        onClose();
        return true;
    });

    useEffect(() => {
        if (!isOpen || !modalRootRef.current || !dialogRef.current) return;

        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const unlockBackground = lockBackground(modalRootRef.current);
        const dialog = dialogRef.current;
        openDialogs.push(dialog);
        const initialFocus = dialog.querySelector<HTMLElement>('[data-modal-initial-focus], [autofocus]')
            ?? dialog.querySelector<HTMLElement>(focusableSelector)
            ?? dialog;
        initialFocus.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (openDialogs[openDialogs.length - 1] !== dialog) return;
            if (event.key === 'Escape') {
                if (closeDialog()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
                .filter(element => element.getAttribute('aria-hidden') !== 'true');
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            const dialogIndex = openDialogs.indexOf(dialog);
            if (dialogIndex !== -1) openDialogs.splice(dialogIndex, 1);
            unlockBackground();
            const activeDialog = openDialogs[openDialogs.length - 1];
            if (previouslyFocused?.isConnected && (!activeDialog || activeDialog.contains(previouslyFocused))) {
                previouslyFocused.focus();
            }
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div ref={modalRootRef} className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-md"
                onClick={onClose}
            />

            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
                aria-label={title ? undefined : 'Dialog'}
                tabIndex={-1}
                className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${maxWidth} overflow-hidden border border-slate-200/80 dark:border-slate-700/50 flex flex-col max-h-[90vh] relative z-10 animate-in zoom-in-95 duration-200`}
            >
                {(title || onClose) && (
                    <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-800 dark:to-slate-800">
                        <div id={title ? titleId : undefined} className="font-bold text-slate-900 dark:text-white text-lg">
                            {title}
                        </div>
                        {onClose && (
                            <button
                                type="button"
                                aria-label="Close dialog"
                                onClick={onClose}
                                className="p-2 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-all duration-200"
                            >
                                <X size={20} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                )}

                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
