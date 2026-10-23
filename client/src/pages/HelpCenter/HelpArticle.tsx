import { useState, type ReactNode } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getArticleBySlug } from '../../data/helpContent';
import { ArrowLeft, Calendar, User, Share2, Printer } from 'lucide-react';

function SimpleMarkdown({ content }: { content: string }) {
    if (!content) return null;

    const lines = content.split('\n');
    const inline = (text: string) => text.split(/(\*\*.*?\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
    const blocks: ReactNode[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line.startsWith('- ')) {
            const items = [];
            const start = index;
            while (index < lines.length && lines[index].startsWith('- ')) {
                items.push(<li key={index}>{inline(lines[index].slice(2))}</li>);
                index++;
            }
            index--;
            blocks.push(<ul key={start} className="list-disc pl-6 space-y-2">{items}</ul>);
        } else if (line.startsWith('### ')) blocks.push(<h3 key={index} className="text-xl font-bold mt-8">{inline(line.slice(4))}</h3>);
        else if (line.startsWith('## ')) blocks.push(<h2 key={index} className="text-2xl font-bold mt-10">{inline(line.slice(3))}</h2>);
        else if (line.startsWith('# ')) blocks.push(<h2 key={index} className="text-3xl font-bold mt-10">{inline(line.slice(2))}</h2>);
        else if (line.trim()) blocks.push(<p key={index}>{inline(line)}</p>);
    }

    return (
        <div className="space-y-4 text-gray-700 dark:text-slate-200 leading-relaxed">
            {blocks}
        </div>
    );
}

export function HelpArticle() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const [shareResult, setShareResult] = useState<{ slug: string | undefined; message: string; failed?: boolean } | null>(null);

    // Get article from static content - no API call needed
    const article = slug ? getArticleBySlug(slug) : null;
    const share = async () => {
        if (!article) return;
        const url = window.location.href;
        try {
            if (navigator.share) {
                await navigator.share({ title: article.title, url });
                setShareResult({ slug, message: 'Article shared.' });
            } else {
                await navigator.clipboard.writeText(url);
                setShareResult({ slug, message: 'Article link copied.' });
            }
        } catch (error) {
            if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
            setShareResult({ slug, message: 'Could not share automatically. Copy the link below.', failed: true });
        }
    };

    if (!article) {
        return (
            <div className="max-w-3xl mx-auto py-20 text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h2>
                <p className="text-gray-500 mb-6">Article not found or unavailable.</p>
                    <button type="button" onClick={() => navigate('/help')} className="text-[var(--brand-text)] hover:underline font-medium flex items-center justify-center gap-2 mx-auto">
                    <ArrowLeft size={16} /> Back to Help Center
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <button
                type="button"
                onClick={() => navigate('/help')}
                className="group flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-8 transition-colors"
            >
                <div className="p-1 rounded-full bg-gray-100 group-hover:bg-gray-200 transition-colors">
                    <ArrowLeft size={14} />
                </div>
                Back to Help Center
            </button>

            <article className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Article Header */}
                <div className="p-6 md:p-12 border-b border-gray-50 dark:border-slate-700 bg-linear-to-b from-white to-gray-50/20 dark:from-slate-800 dark:to-slate-800">
                    <div className="flex items-center gap-2 mb-6">
                            <span className="px-2.5 py-1 rounded-md bg-[var(--brand-subtle)] text-[var(--brand-text)] text-xs font-medium">
                            {article.collection?.title || 'Guide'}
                        </span>
                        <span className="text-gray-400 text-xs">•</span>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Calendar size={12} />
                            {new Date(article.updatedAt).toLocaleDateString()}
                        </div>
                    </div>

                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-slate-100 mb-6 leading-tight">
                        {article.title}
                    </h1>

                    {article.excerpt && (
                        <p className="text-xl text-gray-500 leading-relaxed font-light">
                            {article.excerpt}
                        </p>
                    )}

                    <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                    <User size={14} />
                                </div>
                                <div className="text-xs">
                                    <p className="text-gray-900 font-medium">Overseek Team</p>
                                    <p className="text-gray-400">Author</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={() => window.print()} aria-label="Print article" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors" title="Print">
                                <Printer size={18} />
                            </button>
                        <button type="button" onClick={() => void share()} aria-label="Share article" className="p-2 text-gray-400 hover:text-[var(--brand-text)] hover:bg-[var(--brand-subtle)] rounded-lg transition-colors" title="Share">
                                <Share2 size={18} />
                            </button>
                        </div>
                    </div>
                    {shareResult && shareResult.slug === slug && <div className="mt-4">
                        <p role={shareResult.failed ? 'alert' : 'status'}>{shareResult.message}</p>
                        {shareResult.failed && <input aria-label="Article link" readOnly value={window.location.href} onFocus={event => event.target.select()} className="w-full mt-2 p-2 border rounded-lg dark:bg-slate-900" />}
                    </div>}
                </div>

                {/* Content */}
                <div className="p-8 md:p-12">
                    <SimpleMarkdown content={article.content} />
                </div>

                <div className="bg-gray-50 dark:bg-slate-900 p-8 text-center border-t border-gray-100 dark:border-slate-700">
                    <p className="text-gray-900 dark:text-slate-100 font-medium mb-4">Need more help?</p>
                    <Link to="/help" className="text-[var(--brand-text)] underline">Browse the Help Center for related guides</Link>
                </div>
            </article>
        </div>
    );
}
