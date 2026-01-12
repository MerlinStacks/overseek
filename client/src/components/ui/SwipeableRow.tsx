import { ReactNode, useRef, useState } from 'react';

/**
 * SwipeableRow - Touch swipe gesture component for list items.
 * 
 * Features:
 * - Left/Right swipe actions
 * - Haptic feedback on action trigger
 * - Smooth animations
 * - Customizable threshold
 */

interface SwipeAction {
    icon: ReactNode;
    color: string;
    onAction: () => void;
}

interface SwipeableRowProps {
    children: ReactNode;
    leftAction?: SwipeAction;
    rightAction?: SwipeAction;
    threshold?: number;
}

export function SwipeableRow({
    children,
    leftAction,
    rightAction,
    threshold = 80
}: SwipeableRowProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [startX, setStartX] = useState(0);
    const [currentX, setCurrentX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);

    const handleTouchStart = (e: React.TouchEvent) => {
        setStartX(e.touches[0].clientX);
        setIsDragging(true);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging) return;
        const diff = e.touches[0].clientX - startX;

        // Limit swipe distance and only allow valid directions
        if (diff > 0 && leftAction) {
            setCurrentX(Math.min(diff, threshold + 40));
        } else if (diff < 0 && rightAction) {
            setCurrentX(Math.max(diff, -(threshold + 40)));
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);

        // Trigger action if threshold reached
        if (currentX > threshold && leftAction) {
            triggerHaptic();
            setIsRemoving(true);
            setTimeout(() => {
                leftAction.onAction();
                setIsRemoving(false);
                setCurrentX(0);
            }, 200);
        } else if (currentX < -threshold && rightAction) {
            triggerHaptic();
            setIsRemoving(true);
            setTimeout(() => {
                rightAction.onAction();
                setIsRemoving(false);
                setCurrentX(0);
            }, 200);
        } else {
            setCurrentX(0);
        }
    };

    const triggerHaptic = () => {
        if ('vibrate' in navigator) {
            navigator.vibrate(15);
        }
    };

    const leftProgress = Math.min(currentX / threshold, 1);
    const rightProgress = Math.min(Math.abs(currentX) / threshold, 1);

    return (
        <div
            ref={containerRef}
            className={`relative overflow-hidden rounded-2xl ${isRemoving ? 'animate-out slide-out-to-right duration-200' : ''}`}
        >
            {/* Left Action Background */}
            {leftAction && (
                <div
                    className={`absolute inset-y-0 left-0 flex items-center justify-start pl-6 ${leftAction.color}`}
                    style={{
                        width: Math.max(currentX, 0),
                        opacity: leftProgress
                    }}
                >
                    <div style={{ transform: `scale(${0.5 + leftProgress * 0.5})` }}>
                        {leftAction.icon}
                    </div>
                </div>
            )}

            {/* Right Action Background */}
            {rightAction && (
                <div
                    className={`absolute inset-y-0 right-0 flex items-center justify-end pr-6 ${rightAction.color}`}
                    style={{
                        width: Math.max(Math.abs(currentX), 0),
                        opacity: rightProgress
                    }}
                >
                    <div style={{ transform: `scale(${0.5 + rightProgress * 0.5})` }}>
                        {rightAction.icon}
                    </div>
                </div>
            )}

            {/* Content */}
            <div
                className="relative bg-white"
                style={{
                    transform: `translateX(${currentX}px)`,
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out'
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {children}
            </div>
        </div>
    );
}
