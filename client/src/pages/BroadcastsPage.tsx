import { CampaignsList } from '../components/marketing/CampaignsList';
import { MarketingEmailDesigner } from '../components/marketing/MarketingEmailDesigner';
import { useCampaignEmailEditor } from '../components/marketing/useCampaignEmailEditor';

export function BroadcastsPage() {
    const editor = useCampaignEmailEditor();
    if (editor.isOpen) {
        return (
            <>
                {(editor.loading || editor.error) ? (
                    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white dark:bg-slate-950 dark:text-white">
                        <p role={editor.error ? 'alert' : 'status'}>{editor.error || 'Loading saved broadcast design...'}</p>
                        {editor.error && <button onClick={() => editor.item && void editor.open(editor.item.id, editor.item.name, editor.item.subject)}>Retry</button>}
                        <button onClick={editor.close}>Back to broadcasts</button>
                    </div>
                ) : (
                <MarketingEmailDesigner
                    key={editor.item?.id}
                    storageScope={`campaign:${editor.item?.id}`}
                    initialHtml={editor.item?.content}
                    previewOrderMode="none"
                    initialDesign={editor.item?.designJson}
                    initialSubject={editor.item?.subject}
                    onSave={editor.save}
                    onCancel={editor.close}
                />
                )}
            </>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Broadcasts</h1>
                <p className="text-gray-500">Manage and send email broadcasts to your customers.</p>
            </div>

            <div className="py-4">
                <CampaignsList onEdit={editor.open} />
            </div>
        </div>
    );
}
