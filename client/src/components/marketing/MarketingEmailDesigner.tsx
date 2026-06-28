import { lazy, Suspense, useEffect } from 'react';

const EmailDesignEditorV2 = lazy(() => import('./EmailDesignEditorV2').then((module) => ({ default: module.EmailDesignEditorV2 })));

interface Props {
    initialDesign?: unknown;
    initialSubject?: string;
    initialPreviewText?: string;
    onSave: (html: string, design: unknown, meta?: { subject: string; previewText: string; autosave?: boolean }) => void | Promise<void>;
    onCancel: () => void;
}

export function MarketingEmailDesigner(props: Props) {
    useEffect(() => {
        localStorage.removeItem('overseek-email-builder-draft');
        localStorage.removeItem('overseek-email-builder-v2-draft');
    }, []);

    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-500">Loading email editor...</div>}>
            <EmailDesignEditorV2 {...props} />
        </Suspense>
    );
}
