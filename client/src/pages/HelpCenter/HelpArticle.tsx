import { useParams, useNavigate } from 'react-router-dom';
import { getArticleBySlug } from '../../data/helpContent';
import { ArrowLeft, Calendar, User, Share2, Printer } from 'lucide-react';

function SimpleMarkdown({ content }: { content: string }) {
    if (!content) return null;

    const lines = content.split('\n');

    return (
        <div className="space-y-4 text-gray-700 leading-relaxed">
            {lines.map((line, i) => {
                if (line.startsWith('### ')) return <h3 key={i} className="text-xl font-bold text-gray-900 mt-8 mb-3">{line.replace('### ', '')}</h3>;
                if (line.startsWith('## ')) return <h2 key={i} className="text-2xl font-bold text-gray-900 mt-10 mb-5 pb-2 border-b border-gray-100">{line.replace('## ', '')}</h2>;
                if (line.startsWith('# ')) return <h1 key={i} className="text-3xl font-bold text-gray-900 mt-10 mb-6">{line.replace('# ', '')}</h1>;
                if (line.startsWith('- ')) return <div key={i} className="flex gap-3 ml-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2.5 shrink-0"></div><p className="flex-1">{line.replace('- ', '')}</p></div>;
                if (line.trim() === '') return <div key={i} className="h-2"></div>;

                // Handle bolding
                const parts = line.split(/(\*\*.*?\*\*)/g);
                return (
                    <p key={i} className="text-base text-gray-600">
                        {parts.map((part, j) => {
                            if (part.startsWith('**') && part.endsWith('**')) {
                                return <strong key={j} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
                            }
                            return part;
                        })}
                    </p>
                );
            })}
        </div>
    );
}

export function HelpArticle() {
    const { slug } = useParams();
    const navigate = useNavigate();

    // Get article from static content - no API call needed
    const article = slug ? getArticleBySlug(slug) : null;

    if (!article) {
        return (
            <div className="max-w-3xl mx-auto py-20 text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h2>
                <p className="text-gray-500 mb-6">Article not found or unavailable.</p>
                <button onClick={() => navigate('/help')} className="text-blue-600 hover:text-blue-700 font-medium flex items-center justify-center gap-2 mx-auto">
                    <ArrowLeft size={16} /> Back to Help Center
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <button
                onClick={() => navigate('/help')}
                className="group flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-8 transition-colors"
            >
                <div className="p-1 rounded-full bg-gray-100 group-hover:bg-gray-200 transition-colors">
                    <ArrowLeft size={14} />
                </div>
                Back to Help Center
            </button>

            <article className="bg-white rounded-2xl shadow-xs border border-gray-100 overflow-hidden">
                {/* Article Header */}
                <div className="p-8 md:p-12 border-b border-gray-50 bg-linear-to-b from-white to-gray-50/20">
                    <div className="flex items-center gap-2 mb-6">
                        <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold tracking-wide uppercase">
                            {article.collection?.title || 'Guide'}
                        </span>
                        <span className="text-gray-400 text-xs">•</span>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Calendar size={12} />
                            {new Date(article.updatedAt).toLocaleDateString()}
                        </div>
                    </div>

                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6 leading-tight">
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
                            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors" title="Print">
                                <Printer size={18} />
                            </button>
                            <button className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Share">
                                <Share2 size={18} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-8 md:p-12">
                    <SimpleMarkdown content={article.content} />
                </div>

                {/* Feedback Footer */}
                <div className="bg-gray-50 p-8 text-center border-t border-gray-100">
                    <p className="text-gray-900 font-medium mb-4">Was this article helpful?</p>
                    <div className="flex justify-center gap-4">
                        <button className="px-6 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all shadow-xs">
                            Yes, thanks!
                        </button>
                        <button className="px-6 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all shadow-xs">
                            Not really
                        </button>
                    </div>
                </div>
            </article>
        </div>
    );
}
