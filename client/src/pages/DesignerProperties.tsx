
interface DesignerPropertiesProps {
    items: any[];
    selectedId: string | null;
    onUpdateContent: (newContent: string) => void;
    onDeleteItem: () => void;
    onClose: () => void;
}

export function DesignerProperties({ items, selectedId, onUpdateContent, onDeleteItem, onClose }: DesignerPropertiesProps) {
    const selectedItem = items.find(i => i.id === selectedId);
    if (!selectedItem) return null;

    return (
        <div className="w-80 bg-white border-l p-4 overflow-y-auto shadow-xl z-20">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-700">Properties</h3>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    &times;
                </button>
            </div>

            <div className="space-y-4">
                <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-2">
                    Type: {selectedItem.type}
                </div>

                {selectedItem.type === 'text' && (
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Content</label>
                        <textarea
                            className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            rows={4}
                            value={selectedItem.content}
                            onChange={e => onUpdateContent(e.target.value)}
                        />
                    </div>
                )}

                {selectedItem.type === 'image' && (
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Image URL</label>
                        <input
                            type="text"
                            className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            placeholder="https://..."
                            value={selectedItem.content}
                            onChange={e => onUpdateContent(e.target.value)}
                        />
                        <p className="text-xs text-gray-400 mt-1">Enter a direct link to an image.</p>
                    </div>
                )}

                {selectedItem.type === 'order_table' && (
                    <div className="p-3 bg-yellow-50 text-yellow-800 text-xs rounded">
                        Table columns usually auto-configured.
                    </div>
                )}

                <div className="pt-4 border-t mt-4">
                    <button
                        onClick={onDeleteItem}
                        className="w-full py-2 px-4 bg-red-50 text-red-600 rounded hover:bg-red-100 text-sm font-medium transition-colors"
                    >
                        Delete Item
                    </button>
                </div>
            </div>
        </div>
    );
}
