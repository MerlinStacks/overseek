import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Save, ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { generateId } from './invoiceUtils';
import { DesignerSidebar } from './DesignerSidebar';
import { DesignerCanvas } from './DesignerCanvas';
import { DesignerProperties } from './DesignerProperties';

export function InvoiceDesigner() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentAccount } = useAccount();
    const { token } = useAuth();

    const [name, setName] = useState('New Invoice Template');
    const [layout, setLayout] = useState<any[]>([]);
    const [items, setItems] = useState<any[]>([]); // Store component config (e.g. text content)
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Initial Load
    useEffect(() => {
        const fetchTemplate = async () => {
            if (id && currentAccount) {
                try {
                    setIsLoading(true);
                    const template: any = await api.get(`/api/invoices/templates/${id}`, token, currentAccount.id);
                    if (template) {
                        setName(template.name);
                        let layoutData = template.layout;
                        // Handle potential double-serialization or stringified JSON
                        if (typeof layoutData === 'string') {
                            try {
                                layoutData = JSON.parse(layoutData);
                            } catch (e) {
                                console.error('Failed to parse layout string', e);
                            }
                        }

                        if (layoutData) {
                            setLayout(layoutData.grid || []);
                            setItems(layoutData.items || []);
                        }
                    }
                } catch (err) {
                    console.error("Failed to load template", err);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        fetchTemplate();
    }, [id, currentAccount, token]);

    const addItem = (type: string) => {
        const newItemId = generateId();
        const newItem = {
            i: newItemId,
            x: 0,
            y: Infinity, // puts it at the bottom
            w: type === 'order_table' ? 12 : 6,
            h: type === 'order_table' ? 4 : 2,
            minW: 2,
            minH: 1
        };

        setLayout(prev => [...prev, newItem]);
        setItems(prev => [...prev, { id: newItemId, type, content: type === 'text' ? 'Double click to edit' : '' }]);
    };

    const updateContent = (newContent: string) => {
        setItems(prev => prev.map(i => i.id === selectedId ? { ...i, content: newContent } : i));
    };

    const deleteItem = () => {
        setLayout(prev => prev.filter(l => l.i !== selectedId));
        setItems(prev => prev.filter(i => i.id !== selectedId));
        setSelectedId(null);
    };

    const saveTemplate = async () => {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            const payload = {
                name,
                layout: {
                    grid: layout,
                    items: items
                }
            };

            if (id) {
                await api.put(`/api/invoices/templates/${id}`, payload, token, currentAccount.id);
            } else {
                const newTemplate: any = await api.post(`/api/invoices/templates`, payload, token, currentAccount.id);
                if (newTemplate && newTemplate.id) {
                    navigate(`/invoices/templates/${newTemplate.id}`, { replace: true });
                }
            }
        } catch (err) {
            console.error('Failed to save template', err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col bg-gray-100">
            {/* Header */}
            <div className="bg-white border-b px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <label className="block text-xs text-gray-400 font-medium">Template Name</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="font-bold text-lg text-gray-800 border-none p-0 focus:ring-0 placeholder-gray-300"
                        />
                    </div>
                </div>
                <button onClick={saveTemplate} disabled={isLoading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {isLoading ? 'Saving...' : 'Save Template'}
                </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                <DesignerSidebar onAddItem={addItem} />

                <DesignerCanvas
                    layout={layout}
                    items={items}
                    selectedId={selectedId}
                    onLayoutChange={setLayout}
                    onSelect={setSelectedId}
                />

                {selectedId && (
                    <DesignerProperties
                        items={items}
                        selectedId={selectedId}
                        onUpdateContent={updateContent}
                        onDeleteItem={deleteItem}
                        onClose={() => setSelectedId(null)}
                    />
                )}
            </div>
        </div>
    );
}
