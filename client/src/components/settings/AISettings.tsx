import { useState, useEffect, useRef } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { Save, Loader2, Bot, Key, Search, ChevronDown, Check, Sparkles } from 'lucide-react';

// Available embedding models from OpenRouter
const EMBEDDING_MODELS = [
    { id: 'openai/text-embedding-3-small', name: 'OpenAI Text Embedding 3 Small', desc: 'Fast, cost-effective' },
    { id: 'openai/text-embedding-3-large', name: 'OpenAI Text Embedding 3 Large', desc: 'Higher quality' },
    { id: 'openai/text-embedding-ada-002', name: 'OpenAI Ada 002', desc: 'Legacy, widely used' },
    { id: 'voyage/voyage-large-2', name: 'Voyage Large 2', desc: 'High quality alternative' },
    { id: 'cohere/embed-english-v3.0', name: 'Cohere Embed English v3', desc: 'English optimized' },
];

export function AISettings() {
    const { currentAccount, refreshAccounts } = useAccount();
    const { token } = useAuth();

    const [apiKey, setApiKey] = useState('');
    const [selectedModel, setSelectedModel] = useState('mistralai/mistral-7b-instruct');
    const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState('openai/text-embedding-3-small');
    const [models, setModels] = useState<any[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isEmbeddingOpen, setIsEmbeddingOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const embeddingDropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                // Revert to selected model name on close
                if (selectedModel) {
                    const name = selectedModel === 'mistralai/mistral-7b-instruct'
                        ? 'Mistral 7B Instruct'
                        : (models.find(m => m.id === selectedModel)?.name || selectedModel);
                    setSearchQuery(name);
                }
            }
            if (embeddingDropdownRef.current && !embeddingDropdownRef.current.contains(event.target as Node)) {
                setIsEmbeddingOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [selectedModel, models]);

    const filteredModels = models.filter(model =>
        model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        model.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    useEffect(() => {
        const name = selectedModel === 'mistralai/mistral-7b-instruct'
            ? 'Mistral 7B Instruct'
            : (models.find(m => m.id === selectedModel)?.name || selectedModel);
        setSearchQuery(name);
    }, [selectedModel, models]);



    useEffect(() => {
        if (currentAccount) {
            setApiKey(currentAccount.openRouterApiKey || '');
            if (currentAccount.aiModel) {
                setSelectedModel(currentAccount.aiModel);
            }
            if (currentAccount.embeddingModel) {
                setSelectedEmbeddingModel(currentAccount.embeddingModel);
            }
        }
    }, [currentAccount]);

    useEffect(() => {
        const fetchModels = async () => {
            if (!currentAccount || !token) return;
            // Only fetch if we have a key saved (or maybe standard list?)
            // If the user hasn't saved a key yet, we might not get models unless we use a default key on backend.
            // But let's try fetching anyway.
            setIsLoadingModels(true);
            try {
                const res = await fetch('/api/ai/models', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        const sorted = data.sort((a: any, b: any) => a.id.localeCompare(b.id));
                        setModels(sorted);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch models", e);
            } finally {
                setIsLoadingModels(false);
            }
        };

        // Fetch on mount
        fetchModels();
    }, [currentAccount?.id, token]); // Only re-fetch if account changes

    const handleSave = async () => {
        if (!currentAccount || !token) return;
        setIsSaving(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    openRouterApiKey: apiKey,
                    aiModel: selectedModel,
                    embeddingModel: selectedEmbeddingModel
                })
            });

            if (!res.ok) throw new Error('Failed to save');

            await refreshAccounts();
            alert('AI Settings Saved');

        } catch (e) {
            console.error(e);
            alert('Failed to save');
        } finally {
            setIsSaving(false);
        }
    };

    const getEmbeddingModelName = () => {
        const model = EMBEDDING_MODELS.find(m => m.id === selectedEmbeddingModel);
        return model?.name || selectedEmbeddingModel;
    };

    return (
        <div className="space-y-6">
            <div className="grid gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        <Key size={16} /> OpenRouter API Key
                    </label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden font-mono text-sm"
                        placeholder="sk-or-v1-..."
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Get your key from <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">openrouter.ai</a>
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        <Bot size={16} /> AI Chat Model
                    </label>
                    <div className="relative" ref={dropdownRef}>
                        <div className="relative">
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    if (!isOpen) setIsOpen(true);
                                }}
                                onFocus={() => setIsOpen(true)}
                                disabled={isLoadingModels}
                                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden transition-colors pr-10 ${isOpen ? 'border-blue-500' : 'border-gray-300'
                                    } ${isLoadingModels ? 'opacity-50 cursor-not-allowed' : ''}`}
                                placeholder="Select or search model..."
                            />

                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                {isLoadingModels ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                )}
                            </div>
                        </div>

                        {isOpen && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-[300px] flex flex-col overflow-hidden">
                                <div className="overflow-y-auto flex-1 p-1">
                                    <div
                                        onClick={() => {
                                            setSelectedModel('mistralai/mistral-7b-instruct');
                                            setIsOpen(false);
                                        }}
                                        className={`px-3 py-2 text-sm rounded-md cursor-pointer flex items-center justify-between group ${selectedModel === 'mistralai/mistral-7b-instruct' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                                            }`}
                                    >
                                        <div className="flex flex-col">
                                            <span className="font-medium">Mistral 7B Instruct</span>
                                            <span className="text-xs opacity-70">Default</span>
                                        </div>
                                        {selectedModel === 'mistralai/mistral-7b-instruct' && <Check size={14} />}
                                    </div>

                                    {filteredModels.map(model => (
                                        <div
                                            key={model.id}
                                            onClick={() => {
                                                setSelectedModel(model.id);
                                                setIsOpen(false);
                                            }}
                                            className={`px-3 py-2 text-sm rounded-md cursor-pointer flex items-center justify-between group ${selectedModel === model.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                                                }`}
                                        >
                                            <div className="flex flex-col truncate pr-2">
                                                <span className="font-medium truncate">{model.name}</span>
                                                <span className="text-xs opacity-60 font-mono truncate">{model.id}</span>
                                            </div>
                                            {selectedModel === model.id && <Check size={14} className="shrink-0" />}
                                        </div>
                                    ))}

                                    {filteredModels.length === 0 && (
                                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                                            No models found matching "{searchQuery}"
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Embedding Model Selector */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        <Sparkles size={16} /> Embedding Model
                        <span className="text-xs font-normal text-gray-400">(for semantic search)</span>
                    </label>
                    <div className="relative" ref={embeddingDropdownRef}>
                        <button
                            type="button"
                            onClick={() => setIsEmbeddingOpen(!isEmbeddingOpen)}
                            className={`w-full px-4 py-2 border rounded-lg text-left flex items-center justify-between transition-colors ${isEmbeddingOpen ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-300'}`}
                        >
                            <span>{getEmbeddingModelName()}</span>
                            <ChevronDown size={16} className={`text-gray-400 transition-transform ${isEmbeddingOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isEmbeddingOpen && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                                <div className="p-1">
                                    {EMBEDDING_MODELS.map(model => (
                                        <div
                                            key={model.id}
                                            onClick={() => {
                                                setSelectedEmbeddingModel(model.id);
                                                setIsEmbeddingOpen(false);
                                            }}
                                            className={`px-3 py-2 text-sm rounded-md cursor-pointer flex items-center justify-between ${selectedEmbeddingModel === model.id ? 'bg-purple-50 text-purple-700' : 'hover:bg-gray-50 text-gray-700'}`}
                                        >
                                            <div className="flex flex-col">
                                                <span className="font-medium">{model.name}</span>
                                                <span className="text-xs opacity-60">{model.desc}</span>
                                            </div>
                                            {selectedEmbeddingModel === model.id && <Check size={14} />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        Used for semantic product search and finding similar items
                    </p>
                </div>
            </div>

            <div className="flex justify-end pt-4">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    {isSaving ? 'Saving...' : 'Save AI Settings'}
                </button>
            </div>
        </div>
    );
}

