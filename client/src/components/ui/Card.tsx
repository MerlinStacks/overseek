import * as React from 'react';
import { cn } from '../../utils/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Enable glass morphism effect */
    glass?: boolean;
    /** Show gradient accent bar at top */
    accent?: boolean;
    /** Disable hover lift effect */
    noHover?: boolean;
}

/**
 * Card - Premium card component with glassmorphism and hover effects.
 * Use `glass` prop for translucent glass effect, `accent` for gradient top bar.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, glass, accent, noHover, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                // Base styles
                "rounded-2xl border text-card-foreground overflow-hidden",
                // Light mode
                "bg-white border-slate-200/80",
                // Dark mode
                "dark:bg-slate-800/90 dark:border-slate-700/50",
                // Shadow & transitions
                "shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)]",
                "transition-all duration-300 ease-out",
                // Hover effect (unless disabled)
                !noHover && "hover:shadow-[0_10px_40px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)] hover:-translate-y-0.5",
                !noHover && "dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3),0_4px_12px_rgba(0,0,0,0.2)]",
                // Glass effect
                glass && "bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl border-white/40 dark:border-slate-600/40",
                // Accent bar
                accent && "relative before:absolute before:top-0 before:left-0 before:right-0 before:h-1 before:bg-gradient-to-r before:from-blue-500 before:to-violet-500 before:rounded-t-2xl",
                className
            )}
            {...props}
        />
    )
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn("flex flex-col space-y-1.5 p-6", className)}
            {...props}
        />
    )
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h3
            ref={ref}
            className={cn(
                "text-xl font-semibold leading-none tracking-tight",
                "text-slate-900 dark:text-slate-100",
                className
            )}
            {...props}
        />
    )
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
    ({ className, ...props }, ref) => (
        <p
            ref={ref}
            className={cn("text-sm text-slate-500 dark:text-slate-400", className)}
            {...props}
        />
    )
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
    )
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "flex items-center p-6 pt-0",
                "border-t border-slate-100 dark:border-slate-700/50 mt-4 pt-4",
                className
            )}
            {...props}
        />
    )
);
CardFooter.displayName = "CardFooter";
