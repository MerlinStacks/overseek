import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Folder, FileText, Plus, Pencil, Trash } from 'lucide-react';
import { cn } from '../../utils/cn';

interface HelpCollection {
    id: string;
    title: string;
    slug: string;
    articles: HelpArticle[];
}

interface HelpArticle {
    id: string;
    title: string;
    slug: string;
}

export function AdminHelpCenterPage() {
    const { token } = useAuth();
    const [collections, setCollections] = useState<HelpCollection[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchCollections = () => {
        fetch('/api/help/collections')
            .then(res => res.json())
            .then(data => {
                setCollections(data);
                setLoading(false);
            })
            .catch(console.error);
    };

    useEffect(() => {
        fetchCollections();
    }, []);

    // Placeholder for CRUD actions (requires dedicated Modals)
    const handleEdit = (id: string, type: 'collection' | 'article') => {
        alert(`Edit ${type} ${id} - Implementation would open a modal here`);
    };

    if (loading) return <div>Loading help center...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-slate-800">Manage Help Center</h1>
                <button
                    onClick={() => alert('Add Collection Modal')}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                    <Plus size={16} /> New Collection
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {collections.map(collection => (
                    <div key={collection.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                    <Folder size={20} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">{collection.title}</h3>
                                    <p className="text-xs text-slate-500">/{collection.slug}</p>
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <button onClick={() => handleEdit(collection.id, 'collection')} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                                    <Pencil size={14} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 space-y-2 mb-4">
                            {collection.articles.map(article => (
                                <div key={article.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 group border border-transparent hover:border-slate-100">
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <FileText size={14} className="text-slate-400" />
                                        <span className="truncate max-w-[180px]">{article.title}</span>
                                    </div>
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                        <button onClick={() => handleEdit(article.id, 'article')} className="p-1 text-slate-400 hover:text-blue-600">
                                            <Pencil size={12} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {collection.articles.length === 0 && (
                                <p className="text-xs text-slate-400 italic p-2">No articles yet</p>
                            )}
                        </div>

                        <button
                            onClick={() => alert(`Add Article to ${collection.title} Modal`)}
                            className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-sm hover:bg-slate-50 hover:text-blue-600 hover:border-blue-300 transition-all flex items-center justify-center gap-2"
                        >
                            <Plus size={14} /> Add Article
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
