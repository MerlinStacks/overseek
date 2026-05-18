import { lazy, Suspense } from 'react';
import { useAccount } from '../../context/AccountContext';

const EmailDesignEditorV2 = lazy(() => import('./EmailDesignEditorV2').then((module) => ({ default: module.EmailDesignEditorV2 })));
const EmailDesignEditorLegacy = lazy(() => import('./EmailDesignEditor').then((module) => ({ default: module.EmailDesignEditor })));

interface Props {
    initialDesign?: unknown;
    onSave: (html: string, design: unknown) => void;
    onCancel: () => void;
}

export function MarketingEmailDesigner(props: Props) {
    const { currentAccount } = useAccount();
    const flag = currentAccount?.features?.find((feature) => feature.featureKey === 'EMAIL_DESIGNER_V2');
    const useV2 = flag?.isEnabled === true;

    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-500">Loading email editor...</div>}>
            {useV2 ? <EmailDesignEditorV2 {...props} /> : <EmailDesignEditorLegacy {...props} />}
        </Suspense>
    );
}
