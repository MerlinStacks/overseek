import { useEffect, useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { searchArticles } from '../../data/helpContent';

export function HelpSearch() {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const listId = useId();
    const navigate = useNavigate();
    const search = query.trim();
    const results = useMemo(() => search.length > 2 ? searchArticles(search).slice(0, 10) : [], [search]);
    const open = isOpen && search.length > 2;
    useEffect(() => {
        if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [open, active, listId]);
    const selectArticle = (slug: string) => {
        setIsOpen(false);
        setActive(-1);
        setQuery('');
        navigate(`/help/article/${slug}`);
    };

    return (
        <div className="relative w-full max-w-2xl mx-auto z-50">
            <div className="relative group">
                <Search aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                <input
                    type="text" role="combobox" aria-label="Search help articles" aria-autocomplete="list"
                    aria-expanded={open} aria-controls={open && results.length > 0 ? listId : undefined}
                    aria-activedescendant={open && active >= 0 && active < results.length ? `${listId}-${active}` : undefined}
                    autoComplete="off" placeholder="Search for help..."
                    className="w-full pl-12 pr-4 py-4 bg-white/50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-gray-900 dark:text-slate-100 placeholder-gray-500 dark:placeholder-slate-400 backdrop-blur-xs transition-all shadow-xs hover:shadow-md"
                    value={query}
                    onChange={event => { setQuery(event.target.value); setIsOpen(event.target.value.trim().length > 2); setActive(-1); }}
                    onFocus={() => setIsOpen(search.length > 2)}
                    onBlur={() => { setIsOpen(false); setActive(-1); }}
                    onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Escape') { setIsOpen(false); setActive(-1); }
                        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
                            event.preventDefault(); setIsOpen(true);
                            setActive(index => !open || index < 0
                                ? event.key === 'ArrowDown' ? 0 : results.length - 1
                                : (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
                        }
                        if (event.key === 'Enter' && open && results.length) {
                            event.preventDefault(); selectArticle(results[active >= 0 ? active : 0].slug);
                        }
                    }}
                />
            </div>
            {open && results.length > 0 && (
                <ul id={listId} role="listbox" aria-label="Help articles"
                    className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl shadow-2xl max-h-96 overflow-y-auto z-50">
                    {results.map((article, index) => (
                        <li id={`${listId}-${index}`} role="option" aria-selected={active === index} key={article.id}
                            className={`p-4 cursor-pointer border-b border-gray-100 dark:border-slate-700 last:border-0 transition-colors text-left ${active === index ? 'bg-blue-50 dark:bg-slate-700' : 'hover:bg-gray-50 dark:hover:bg-slate-700'}`}
                            onPointerDown={event => event.preventDefault()}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => selectArticle(article.slug)}>
                            <h4 className="text-gray-900 dark:text-slate-100 font-medium text-sm mb-1">{article.title}</h4>
                            <p className="text-gray-500 dark:text-slate-400 text-xs line-clamp-1">{article.excerpt || article.content?.substring(0, 100)}</p>
                            <span className="inline-block mt-2 text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded-full font-semibold">{article.collection?.title}</span>
                        </li>
                    ))}
                </ul>
            )}
            {open && results.length === 0 && (
                <div role="status" className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl shadow-2xl z-50 p-4 text-center text-gray-500 dark:text-slate-400 text-sm">
                    No articles found for "{search}"
                </div>
            )}
        </div>
    );
}
