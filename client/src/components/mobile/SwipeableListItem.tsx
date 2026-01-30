import { useState, useRef, ReactNode } from 'react';
import { Trash2, Archive, MoreHorizontal } from 'lucide-react';

/**
 * SwipeableListItem - Touch-friendly swipeable list item for mobile.
 * 
 * Features:
 * - Swipe left to reveal actions
 * - Smooth spring animation
 * - Haptic feedback
 * - Customizable action buttons
 */

interface SwipeAction {
    icon: ReactNode;
    label: string;
    color: string;
    onClick: () => void;
}

interface SwipeableListItemProps {
    children: ReactNode;
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    leftActions?: SwipeAction[];
    rightActions?: SwipeAction[];
    className?: string;
}

export function SwipeableListItem({
    children,
    leftActions = [],
    rightActions = [
        { icon: <Archive size={20} />, label: 'Archive', color: 'bg-blue-500', onClick: () => { } },
        { icon: <Trash2 size={20} />, label: 'Delete', color: 'bg-rose-500', onClick: () => { } }
    ],
    className = ''
}: SwipeableListItemProps) {
    const [translateX, setTranslateX] = useState(0);
    const [isOpen, setIsOpen] = useState<'left' | 'right' | null>(null);
    const startX = useRef(0);
    const currentX = useRef(0);
    const isDragging = useRef(false);

    const ACTION_WIDTH = 72;
    const maxSwipeLeft = -rightActions.length * ACTION_WIDTH;
    const maxSwipeRight = leftActions.length * ACTION_WIDTH;

    const handleTouchStart = (e: React.TouchEvent) => {
        startX.current = e.touches[0].clientX;
        currentX.current = translateX;
        isDragging.current = true;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging.current) return;

        const deltaX = e.touches[0].clientX - startX.current;
        let newX = currentX.current + deltaX;

        // Apply elastic resistance at boundaries
        if (newX > maxSwipeRight) {
            newX = maxSwipeRight + (newX - maxSwipeRight) * 0.2;
        } else if (newX < maxSwipeLeft) {
            newX = maxSwipeLeft + (newX - maxSwipeLeft) * 0.2;
        }

        setTranslateX(newX);
    };

    const handleTouchEnd = () => {
        isDragging.current = false;

        // Snap to open or closed state
        const threshold = ACTION_WIDTH / 2;

        if (translateX < -threshold && rightActions.length > 0) {
            setTranslateX(maxSwipeLeft);
            setIsOpen('right');
            if ('vibrate' in navigator) navigator.vibrate(5);
        } else if (translateX > threshold && leftActions.length > 0) {
            setTranslateX(maxSwipeRight);
            setIsOpen('left');
            if ('vibrate' in navigator) navigator.vibrate(5);
        } else {
            setTranslateX(0);
            setIsOpen(null);
        }
    };

    const handleClose = () => {
        setTranslateX(0);
        setIsOpen(null);
    };

    const handleActionClick = (action: SwipeAction) => {
        if ('vibrate' in navigator) navigator.vibrate(10);
        action.onClick();
        handleClose();
    };

    return (
        <div className={`relative overflow-hidden ${className}`}>
            {/* Left Actions (revealed on swipe right) */}
            {leftActions.length > 0 && (
                <div
                    className="absolute left-0 top-0 bottom-0 flex"
                    style={{ width: leftActions.length * ACTION_WIDTH }}
                >
                    {leftActions.map((action, index) => (
                        <button
                            key={index}
                            onClick={() => handleActionClick(action)}
                            className={`flex-1 flex flex-col items-center justify-center ${action.color} text-white active:opacity-80 transition-opacity`}
                        >
                            {action.icon}
                            <span className="text-[10px] mt-1 font-medium">{action.label}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Right Actions (revealed on swipe left) */}
            {rightActions.length > 0 && (
                <div
                    className="absolute right-0 top-0 bottom-0 flex"
                    style={{ width: rightActions.length * ACTION_WIDTH }}
                >
                    {rightActions.map((action, index) => (
                        <button
                            key={index}
                            onClick={() => handleActionClick(action)}
                            className={`flex-1 flex flex-col items-center justify-center ${action.color} text-white active:opacity-80 transition-opacity`}
                        >
                            {action.icon}
                            <span className="text-[10px] mt-1 font-medium">{action.label}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Main Content */}
            <div
                className="relative bg-slate-800/50 backdrop-blur-sm border border-white/10 transition-transform duration-200 ease-out"
                style={{
                    transform: `translateX(${translateX}px)`,
                    transitionDuration: isDragging.current ? '0ms' : '200ms'
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {children}

                {/* Close hint when open */}
                {isOpen && (
                    <button
                        onClick={handleClose}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 active:bg-white/20"
                    >
                        <MoreHorizontal size={16} className="text-slate-400" />
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * Simple swipe detection hook
 */
export function useSwipeGesture(
    onSwipeLeft?: () => void,
    onSwipeRight?: () => void,
    threshold = 50
) {
    const startX = useRef(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        startX.current = e.touches[0].clientX;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const endX = e.changedTouches[0].clientX;
        const deltaX = endX - startX.current;

        if (Math.abs(deltaX) > threshold) {
            if (deltaX > 0 && onSwipeRight) {
                onSwipeRight();
            } else if (deltaX < 0 && onSwipeLeft) {
                onSwipeLeft();
            }
        }
    };

    return { handleTouchStart, handleTouchEnd };
}
