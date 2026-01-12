import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * PageTransition - Animated wrapper for page transitions.
 * 
 * Uses CSS animations for smooth page enter/exit effects.
 * Lightweight alternative to framer-motion.
 */

interface PageTransitionProps {
    children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
    const location = useLocation();
    const [displayLocation, setDisplayLocation] = useState(location);
    const [transitionStage, setTransitionStage] = useState<'entering' | 'entered' | 'exiting'>('entered');

    useEffect(() => {
        if (location.pathname !== displayLocation.pathname) {
            setTransitionStage('exiting');
        }
    }, [location, displayLocation]);

    const handleAnimationEnd = () => {
        if (transitionStage === 'exiting') {
            setDisplayLocation(location);
            setTransitionStage('entering');
        } else if (transitionStage === 'entering') {
            setTransitionStage('entered');
        }
    };

    const getAnimationClass = () => {
        switch (transitionStage) {
            case 'entering':
                return 'animate-page-enter';
            case 'exiting':
                return 'animate-page-exit';
            default:
                return '';
        }
    };

    return (
        <div
            className={`${getAnimationClass()}`}
            onAnimationEnd={handleAnimationEnd}
        >
            {children}
        </div>
    );
}

/**
 * FadeSlide - Simple fade + slide animation for page content.
 * 
 * Wraps page content with a fade-in animation on mount.
 */
export function FadeSlide({ children }: { children: ReactNode }) {
    return (
        <div className="animate-fade-slide-up">
            {children}
        </div>
    );
}

/**
 * StaggeredList - Staggers children for list animations.
 * 
 * Each child appears with a slight delay for a cascading effect.
 */
interface StaggeredListProps {
    children: ReactNode[];
    staggerDelay?: number;
}

export function StaggeredList({ children, staggerDelay = 50 }: StaggeredListProps) {
    return (
        <>
            {children.map((child, index) => (
                <div
                    key={index}
                    className="animate-fade-slide-up"
                    style={{ animationDelay: `${index * staggerDelay}ms` }}
                >
                    {child}
                </div>
            ))}
        </>
    );
}
