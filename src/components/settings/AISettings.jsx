import React, { useState, useEffect } from 'react';
import { Key, ChevronRight, Search, RefreshCw, Check } from 'lucide-react';
import { toast } from 'sonner';

const AISettings = ({ settings, updateSettings }) => {
    const [formData, setFormData] = useState({
        aiApiKey: '',
        aiModel: 'google/gemini-2.0-flash-exp:free'
    });

    const [isSaving, setIsSaving] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [modelSearch, setModelSearch] = useState('');
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [showModelList, setShowModelList] = useState(false);

    useEffect(() => {
        setFormData({
            aiApiKey: settings.aiApiKey || '',
            aiModel: settings.aiModel || 'google/gemini-2.0-flash-exp:free'
        });
    }, [settings]);

    useEffect(() => {
        // Load cached models instantly
        const cached = localStorage.getItem('openrouter_models');
        if (cached) {
            setAvailableModels(JSON.parse(cached));
        } else {
            setAvailableModels([
                { id: 'google/gemini-2.0-flash-exp:free', name: 'Google Gemini 2.0 Flash (Free)' },
                { id: 'google/gemini-flash-1.5', name: 'Google Gemini 1.5 Flash' },
                { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
                { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Meta Llama 3.1 70B' },
                { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic Claude 3.5 Sonnet' }
            ]);
        }
        fetchModels();
    }, []);

    const fetchModels = async () => {
        if (isLoadingModels) return;
        setIsLoadingModels(true);
        try {
            const headers = {
                'HTTP-Referer': window.location.origin,
                'X-Title': 'OverSeek'
            };
            // Use API key if available
            if (formData.aiApiKey) {
                headers['Authorization'] = `Bearer ${formData.aiApiKey}`;
            } else if (settings.aiApiKey) {
                headers['Authorization'] = `Bearer ${settings.aiApiKey}`;
            }

            const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
            const data = await res.json();

            if (data.data) {
                const models = data.data.map(m => ({
                    id: m.id,
                    name: m.name || m.id,
                    context: m.context_length
                })).sort((a, b) => a.name.localeCompare(b.name));

                setAvailableModels(models);
                localStorage.setItem('openrouter_models', JSON.stringify(models));
            }
        } catch (e) {
            console.error("Failed to fetch models", e);
        } finally {
            setIsLoadingModels(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await updateSettings(formData);
            toast.success('AI Settings Saved');
        } catch (error) {
            toast.error('Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    return (
    return (
        <form onSubmit={handleSubmit} className="fade-in">
            <div className="settings-content-header">
                <h2 className="settings-title">Intelligence Engine</h2>
                <p className="settings-subtitle">Connect OpenRouter to enable the AI Store Assistant.</p>
            </div>

            <div className="glass-card">
                <div className="form-group">
                    <label className="form-label">OpenRouter API Key</label>
                    <div className="input-wrapper">
                        <input type="password" name="aiApiKey" value={formData.aiApiKey} onChange={handleChange} placeholder="sk-or-..." className="form-input font-mono" />
                        <Key className="input-icon" size={16} />
                    </div>
                    <p className="help-text">Get a key from <a href="https://openrouter.ai" target="_blank" className="link" rel="noreferrer">openrouter.ai</a></p>
                </div>

                <div className="form-group" style={{ position: 'relative' }}>
                    <label className="form-label">AI Model</label>
                    <div className="input-wrapper">
                        <div
                            className="form-input"
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                            onClick={() => setShowModelList(!showModelList)}
                        >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {availableModels.find(m => m.id === formData.aiModel)?.name || formData.aiModel}
                            </span>
                            <ChevronRight size={16} style={{ transform: showModelList ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                        </div>
                    </div>

                    {showModelList && (
                        <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0,
                            background: '#1e293b', border: '1px solid var(--border-glass)',
                            borderRadius: '8px', marginTop: '4px', zIndex: 50,
                            maxHeight: '300px', display: 'flex', flexDirection: 'column',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
                        }}>
                            <div style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '8px' }}>
                                <div style={{ position: 'relative', flex: 1 }}>
                                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                                    <input
                                        autoFocus
                                        placeholder="Search models..."
                                        value={modelSearch}
                                        onChange={e => setModelSearch(e.target.value)}
                                        style={{
                                            width: '100%', background: 'rgba(0,0,0,0.2)', border: 'none',
                                            borderRadius: '4px', padding: '6px 6px 6px 30px', color: 'white', fontSize: '0.9rem'
                                        }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        toast.info("Refreshing models...");
                                        fetchModels();
                                    }}
                                    disabled={isLoadingModels}
                                    className="btn-icon"
                                    title="Refresh Models List"
                                    style={{ width: '30px', height: '30px', background: 'rgba(255,255,255,0.1)' }}
                                >
                                    <RefreshCw size={14} className={isLoadingModels ? 'animate-spin' : ''} />
                                </button>
                            </div>
                            <div style={{ overflowY: 'auto', flex: 1, maxHeight: '200px' }}>
                                {isLoadingModels && <div style={{ padding: '10px', textAlign: 'center', fontSize: '0.8rem', opacity: 0.7 }}>Fetching latest models...</div>}
                                {availableModels.filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase())).map(model => (
                                    <button
                                        key={model.id}
                                        type="button"
                                        onClick={() => {
                                            setFormData(prev => ({ ...prev, aiModel: model.id }));
                                            setShowModelList(false);
                                        }}
                                        style={{
                                            padding: '8px 12px', width: '100%', textAlign: 'left', background: 'transparent',
                                            border: 'none', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            borderBottom: '1px solid rgba(255,255,255,0.02)'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <div>
                                            <div>{model.name}</div>
                                            <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>{model.id}</div>
                                        </div>
                                        {formData.aiModel === model.id && <Check size={14} color="#10b981" />}
                                    </button>
                                ))}
                                {availableModels.length === 0 && <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5, fontSize: '0.9rem' }}>No models found. Click refresh.</div>}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="form-actions mt-6 flex justify-end">
                <button type="submit" disabled={isSaving} className="btn btn-primary min-w-[140px]">Save AI Settings</button>
            </div>
        </form>
    );
};

export default AISettings;
