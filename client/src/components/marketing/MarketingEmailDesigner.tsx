import { lazy, Suspense, useMemo } from 'react';
import { compileEmailDesignV2, isEmailDesignV2 } from '../../lib/emailDesignerV2';
import { importEmailHtml } from '../../lib/importEmailHtml';

const EmailDesignEditorV2 = lazy(() => import('./EmailDesignEditorV2').then((module) => ({ default: module.EmailDesignEditorV2 })));

interface Props {
    storageScope?: string;
    initialHtml?: string;
    emailCategory?: 'MARKETING' | 'TRANSACTIONAL';
    onTestSent?: (html: string, design: unknown, meta: { subject: string; previewText: string }) => void;
    initialDesign?: unknown;
    initialSubject?: string;
    initialPreviewText?: string;
    previewOrderMode?: 'latest' | 'none';
    onSave: (html: string, design: unknown, meta?: { subject: string; previewText: string; autosave?: boolean }) => void | Promise<void>;
    onCancel: () => void;
}

export function MarketingEmailDesigner(props: Props) {
    const initialDesign = useMemo(() => {
        const matchingDesign = isEmailDesignV2(props.initialDesign)
            ? compileEmailDesignV2(props.initialDesign).trim() === props.initialHtml?.trim()
            : false;
        if (props.initialHtml?.trim() && !matchingDesign) {
            return importEmailHtml(props.initialHtml, { title: props.initialSubject, previewText: props.initialPreviewText });
        }
        return props.initialDesign;
    }, [props.initialDesign, props.initialHtml, props.initialSubject, props.initialPreviewText]);

    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-500">Loading email editor...</div>}>
            <EmailDesignEditorV2 {...props} initialDesign={initialDesign} />
        </Suspense>
    );
}
