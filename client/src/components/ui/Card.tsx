import * as React from 'react';
import { cn } from '../../utils/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** @deprecated Retained for compatibility; cards always use opaque surfaces. */
    glass?: boolean;
    /** Show a restrained brand border at the top. */
    accent?: boolean;
    /** @deprecated Cards no longer lift on hover. */
    noHover?: boolean;
}

/**
 * Card - Opaque, bordered workspace surface. Legacy appearance props remain compatible.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, glass: _glass, accent, noHover: _noHover, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "rounded-xl border bg-white text-slate-900 overflow-hidden border-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 shadow-xs",
                accent && "border-t-2 border-t-[var(--brand-border)]",
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

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h3
            ref={ref}
            className={cn(
                "text-base font-semibold leading-snug",
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
                "border-t border-slate-100 dark:border-slate-700 mt-4 pt-4",
                className
            )}
            {...props}
        />
    )
);
CardFooter.displayName = "CardFooter";
