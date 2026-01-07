import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    Sparkles,
    Save,
    Loader2,
    Check,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    Info
} from 'lucide-react';

interface AIPrompt {
    id: string;
    name: string;
    description: string;
    content: string;
    updatedAt: string;
}

interface PromptConfig {
    id: string;
    name: string;
    description: string;
    placeholder: string;
    helpText?: string;
}

/**
 * Defines all available AI prompt configurations.
 * Add new prompts here as needed in the future.
 */
const PROMPT_CONFIGS: PromptConfig[] = [
    {
        id: 'product_description',
        name: 'Product Description Generator',
        description: 'Generate compelling product descriptions for WooCommerce products',
        placeholder: 'You are a skilled copywriter. Generate a compelling product description for the following product:\n\nProduct Name: {{product_name}}\nCategory: {{category}}\nKey Features: {{features}}\n\nWrite a description that is:\n- Engaging and persuasive\n- SEO-friendly\n- 150-200 words',
        helpText: 'Available variables: {{product_name}}, {{category}}, {{features}}, {{price}}'
    },
    {
        id: 'customer_email',
        name: 'Customer Email Response',
        description: 'Draft professional email responses to customer inquiries',
        placeholder: 'You are a helpful customer service representative. Draft a professional response to the following customer inquiry:\n\nCustomer Message: {{message}}\nOrder Details: {{order_details}}\n\nBe:\n- Polite and empathetic\n- Clear and concise\n- Solution-oriented',
        helpText: 'Available variables: {{message}}, {{order_details}}, {{customer_name}}'
    },
    {
        id: 'review_reply',
        name: 'Review Reply Generator',
        description: 'Generate thoughtful replies to customer reviews',
        placeholder: 'You are responding to a customer review on behalf of the store. Generate a professional and warm reply:\n\nReview Rating: {{rating}}/5\nReview Text: {{review_text}}\nProduct: {{product_name}}\n\nGuidelines:\n- Thank the customer\n- Address specific points mentioned\n- If negative, offer solution\n- Keep it under 100 words',
        helpText: 'Available variables: {{rating}}, {{review_text}}, {{product_name}}, {{customer_name}}'
    },
    {
        id: 'seo_meta',
        name: 'SEO Meta Generator',
        description: 'Generate SEO-optimized meta titles and descriptions',
        placeholder: 'Generate SEO meta content for the following page:\n\nPage Type: {{page_type}}\nPrimary Keyword: {{keyword}}\nContent Summary: {{summary}}\n\nProvide:\n1. Meta Title (50-60 characters)\n2. Meta Description (150-160 characters)\n\nEnsure keywords are naturally incorporated.',
        helpText: 'Available variables: {{page_type}}, {{keyword}}, {{summary}}'
    }
];

/**
 * Super Admin page for managing AI prompts across the platform.
 * Prompts are stored in the database and used by various AI features.
 */
export function AdminAIPromptsPage() {
    const { token } = useAuth();
    const [prompts, setPrompts] = useState<AIPrompt[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [formData, setFormData] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({});

    useEffect(() => {
        fetchPrompts();
        // Expand all panels by default
        const initialExpanded: Record<string, boolean> = {};
        PROMPT_CONFIGS.forEach(config => {
            initialExpanded[config.id] = true;
        });
        setExpandedPanels(initialExpanded);
    }, [token]);

    /**
     * Fetches all AI prompts from the server.
     */
    async function fetchPrompts() {
        try {
            const res = await fetch('/api/admin/ai-prompts', {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                // If endpoint doesn't exist yet, just use empty data
                setPrompts([]);
                initializeFormData([]);
                return;
            }

            const data = await res.json();
            setPrompts(data);
            initializeFormData(data);
        } catch (err) {
            console.error('Failed to fetch AI prompts:', err);
            setPrompts([]);
            initializeFormData([]);
        } finally {
            setLoading(false);
        }
    }

    /**
     * Initializes form data with existing prompts or placeholders.
     */
    function initializeFormData(existingPrompts: AIPrompt[]) {
        const initial: Record<string, string> = {};
        PROMPT_CONFIGS.forEach(config => {
            const existing = existingPrompts.find(p => p.id === config.id);
            initial[config.id] = existing?.content || '';
        });
        setFormData(initial);
    }

    /**
     * Saves a single prompt to the server.
     */
    async function handleSave(promptId: string) {
        setSaving(promptId);
        setMessage(null);

        const content = formData[promptId]?.trim();
        if (!content) {
            setMessage({ type: 'error', text: 'Prompt content cannot be empty' });
            setSaving(null);
            return;
        }

        try {
            const res = await fetch(`/api/admin/ai-prompts/${promptId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ content })
            });

            if (res.ok) {
                const config = PROMPT_CONFIGS.find(c => c.id === promptId);
                setMessage({ type: 'success', text: `${config?.name || 'Prompt'} saved successfully` });
                fetchPrompts();
            } else {
                const err = await res.json();
                setMessage({ type: 'error', text: err.error || 'Failed to save prompt' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while saving' });
        } finally {
            setSaving(null);
        }
    }

    /**
     * Resets a prompt to its default placeholder value.
     */
    function handleResetToDefault(promptId: string) {
        const config = PROMPT_CONFIGS.find(c => c.id === promptId);
        if (config) {
            setFormData(prev => ({
                ...prev,
                [promptId]: config.placeholder
            }));
        }
    }

    /**
     * Toggles panel expansion state.
     */
    function togglePanel(promptId: string) {
        setExpandedPanels(prev => ({
            ...prev,
            [promptId]: !prev[promptId]
        }));
    }

    /**
     * Gets the last updated date for a prompt.
     */
    function getLastUpdated(promptId: string): string | null {
        const prompt = prompts.find(p => p.id === promptId);
        return prompt?.updatedAt ? new Date(prompt.updatedAt).toLocaleDateString() : null;
    }

    /**
     * Checks if a prompt has been configured.
     */
    function isConfigured(promptId: string): boolean {
        return prompts.some(p => p.id === promptId);
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-gray-400" size={32} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Sparkles className="text-purple-600" size={28} />
                <h1 className="text-2xl font-bold text-slate-800">AI Prompts</h1>
            </div>

            <p className="text-slate-600 mb-6">
                Configure AI prompts used throughout the platform. These prompts define how AI generates
                content for various features like product descriptions, email responses, and more.
            </p>

            {/* Global Message */}
            {message && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}>
                    {message.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
                    {message.text}
                </div>
            )}

            {/* Prompt Panels */}
            <div className="space-y-4">
                {PROMPT_CONFIGS.map((config) => {
                    const isExpanded = expandedPanels[config.id];
                    const configured = isConfigured(config.id);
                    const lastUpdated = getLastUpdated(config.id);

                    return (
                        <div
                            key={config.id}
                            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                        >
                            {/* Panel Header - Clickable to expand/collapse */}
                            <button
                                onClick={() => togglePanel(config.id)}
                                className="w-full p-5 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white hover:from-slate-100 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <Sparkles className="text-purple-500" size={20} />
                                    <div className="text-left">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold text-slate-900">{config.name}</h3>
                                            {configured && (
                                                <span className="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full">
                                                    Configured
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-500">{config.description}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {lastUpdated && (
                                        <span className="text-xs text-slate-400">
                                            Updated: {lastUpdated}
                                        </span>
                                    )}
                                    {isExpanded ? (
                                        <ChevronUp className="text-slate-400" size={20} />
                                    ) : (
                                        <ChevronDown className="text-slate-400" size={20} />
                                    )}
                                </div>
                            </button>

                            {/* Panel Content */}
                            {isExpanded && (
                                <div className="border-t border-slate-100">
                                    <div className="p-5 space-y-4">
                                        {/* Help Text */}
                                        {config.helpText && (
                                            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                                                <Info size={16} className="mt-0.5 shrink-0" />
                                                <span>{config.helpText}</span>
                                            </div>
                                        )}

                                        {/* Prompt Textarea */}
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                                Prompt Template
                                            </label>
                                            <textarea
                                                className="w-full p-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-shadow font-mono text-sm resize-y min-h-[200px]"
                                                placeholder={config.placeholder}
                                                value={formData[config.id] || ''}
                                                onChange={e => setFormData(prev => ({
                                                    ...prev,
                                                    [config.id]: e.target.value
                                                }))}
                                                rows={8}
                                            />
                                        </div>
                                    </div>

                                    {/* Panel Actions */}
                                    <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                                        <button
                                            onClick={() => handleResetToDefault(config.id)}
                                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm"
                                        >
                                            Reset to Default
                                        </button>
                                        <button
                                            onClick={() => handleSave(config.id)}
                                            disabled={saving === config.id}
                                            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
                                        >
                                            {saving === config.id ? (
                                                <Loader2 className="animate-spin" size={16} />
                                            ) : (
                                                <Save size={16} />
                                            )}
                                            Save Prompt
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer Note */}
            <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                    <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                    <div className="text-sm text-amber-800">
                        <p className="font-medium mb-1">About AI Prompts</p>
                        <p>
                            These prompts serve as templates for AI-powered features. Use placeholders like
                            <code className="mx-1 px-1 py-0.5 bg-amber-100 rounded">{'{{variable_name}}'}</code>
                            which will be replaced with actual data when the prompt is used.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
