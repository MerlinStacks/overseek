import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { searchArticles } from '../../data/helpContent';

export function HelpSearch() {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const navigate = useNavigate();

    // Client-side search - instant results, no API delay
    const results = useMemo(() => {
        if (query.length > 2) {
            return searchArticles(query);
        }
        return [];
    }, [query]);

    return (
        <div className="relative w-full max-w-2xl mx-auto z-50">
            <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                <input
                    type="text"
                    placeholder="Search for help..."
                    className="w-full pl-12 pr-4 py-4 bg-white/50 border border-gray-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-gray-900 placeholder-gray-500 backdrop-blur-xs transition-all shadow-xs hover:shadow-md"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => { if (query.length > 2) setIsOpen(true); }}
                    onBlur={() => setTimeout(() => setIsOpen(false), 200)}
                />
            </div>

            {isOpen && results.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-2xl overflow-hidden z-50">
                    {results.map((article) => (
                        <div
                            key={article.id}
                            className="p-4 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0 transition-colors flex flex-col items-start text-left"
                            onMouseDown={() => {
                                navigate(`/help/article/${article.slug}`);
                                setIsOpen(false);
                                setQuery('');
                            }}
                        >
                            <h4 className="text-gray-900 font-medium text-sm mb-1">{article.title}</h4>
                            <p className="text-gray-500 text-xs line-clamp-1 w-full">{article.excerpt || article.content?.substring(0, 100)}</p>
                            <span className="inline-block mt-2 text-[10px] uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-semibold">
                                {article.collection?.title}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {isOpen && query.length > 2 && results.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-2xl overflow-hidden z-50 p-4 text-center text-gray-500 text-sm">
                    No articles found for "{query}"
                </div>
            )}
        </div>
    );
}
