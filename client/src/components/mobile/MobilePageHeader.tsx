import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

interface MobilePageHeaderProps {
    title: string;
    description?: string;
    onBack?: () => void;
    actions?: ReactNode;
}

/** Shared title hierarchy for companion screens, independent of account branding. */
export function MobilePageHeader({ title, description, onBack, actions }: MobilePageHeaderProps) {
    return (
        <header className="flex items-center gap-3">
            {onBack && <button type="button" onClick={onBack} aria-label="Go back" className="mobile-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"><ChevronLeft size={22} /></button>}
            <div className="min-w-0 flex-1">
                <h1 className="break-words text-2xl font-semibold tracking-tight text-white">{title}</h1>
                {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
    );
}
