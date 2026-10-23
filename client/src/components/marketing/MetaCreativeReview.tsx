import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import type { CreativeReview } from './metaCreativeTypes';

interface Props {
    adAccountId: string;
    adsetId: string;
    creativeId: string;
    days: number;
    hasImages: boolean;
}

/** Explicitly requested and read-only; never changes a live ad or creates drafts remotely. */
export function MetaCreativeReview({ adAccountId, adsetId, creativeId, days, hasImages }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [includeVisuals, setIncludeVisuals] = useState(false);
    const [review, setReview] = useState<CreativeReview | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const activeRequest = useRef<AbortController | null>(null);

    useEffect(() => () => activeRequest.current?.abort(), []);

    async function analyze() {
        activeRequest.current?.abort();
        const controller = new AbortController();
        activeRequest.current = controller;
        setLoading(true);
        setError(null);
        setReview(null);
        try {
            const response = await fetch(`/api/ads/${adAccountId}/creative-review`, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' },
                body: JSON.stringify({ adsetId, creativeId, days, includeVisuals: includeVisuals && hasImages })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Creative review could not be completed');
            if (!controller.signal.aborted) setReview(data);
        } catch (err) {
            if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Creative review could not be completed');
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }

    return (
        <section aria-label="AI creative review" className="rounded-xl border border-[var(--brand-border)] p-4 bg-[var(--brand-subtle)] space-y-3">
            <h4 className="font-semibold flex items-center gap-2"><Sparkles size={18} className="text-[var(--brand-text)]" />AI creative review</h4>
            <p className="text-sm text-slate-600 dark:text-slate-400">Review copy, performance and optional preview images using your configured AI model. Generates test ideas, not automatic ad changes.</p>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeVisuals} disabled={!hasImages || loading} onChange={event => setIncludeVisuals(event.target.checked)} />
                Include available images / video thumbnails (up to 4)
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">Clicking Analyze sends this creative’s copy and metrics, plus comparison metrics from this ad set, to your configured OpenRouter provider. Images are sent only when checked. Provider charges may apply. Full videos and audio are not reviewed.</p>
        <button type="button" onClick={() => void analyze()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary-color)] text-[var(--primary-foreground)] px-4 py-2 text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{loading ? 'Analyzing creative...' : 'Analyze creative'}
            </button>
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            {review && <div className="space-y-4 text-sm" aria-live="polite">
                <p className="text-xs text-slate-500 dark:text-slate-400">{review.model} · {review.visualReview.imagesProvided > 0 ? `${review.visualReview.imagesProvided} preview image(s) supplied` : 'Text and metrics only'} · Draft advice for human review</p>
                <p>{review.summary}</p>
                {[
                    { title: 'Strengths', values: review.strengths },
                    { title: 'Concerns and hypotheses', values: review.concerns },
                    { title: 'Review limitations', values: review.caveats }
                ].map(({ title, values }) => values.length > 0 && <div key={title}><h5 className="font-semibold mb-1">{title}</h5><ul className="list-disc pl-5 space-y-1">{values.map((value, index) => <li key={index}>{value}</li>)}</ul></div>)}
                <div className="space-y-3">
                    <h5 className="font-semibold">Suggested creative tests</h5>
                    {review.tests.map((test, index) => <article key={index} className="p-3 bg-white dark:bg-slate-800 border border-[var(--brand-border)] rounded-lg space-y-2">
                        <h6 className="font-semibold">Test {index + 1}: {test.hypothesis}</h6>
                        <p className="whitespace-pre-wrap"><strong>Primary text:</strong> {test.primaryText}</p>
                        <p><strong>Headline:</strong> {test.headline}</p>
                        <p><strong>Visual brief:</strong> {test.visualBrief}</p>
                    </article>)}
                </div>
            </div>}
        </section>
    );
}
