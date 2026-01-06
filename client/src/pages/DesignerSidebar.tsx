import { Type, Image as ImageIcon, Table, DollarSign } from 'lucide-react';
import { TOOLBOX_ITEMS } from './invoiceUtils';

interface DesignerSidebarProps {
    onAddItem: (type: string) => void;
}

const ICONS: Record<string, any> = {
    text: Type,
    image: ImageIcon,
    order_table: Table,
    totals: DollarSign
};

export function DesignerSidebar({ onAddItem }: DesignerSidebarProps) {
    return (
        <div className="w-64 bg-white border-r p-4 overflow-y-auto">
            <h3 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wider">Components</h3>
            <div className="space-y-3">
                {TOOLBOX_ITEMS.map(item => {
                    const Icon = ICONS[item.type] || Type;
                    return (
                        <div
                            key={item.id}
                            className="flex items-center gap-3 p-3 bg-white border rounded-lg shadow-sm cursor-pointer hover:border-blue-500 hover:shadow-md transition-all group"
                            onClick={() => onAddItem(item.type)}
                            draggable={true}
                            onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", item.type);
                            }}
                        >
                            <div className="p-2 bg-gray-100 rounded-md text-gray-600 group-hover:bg-blue-50 group-hover:text-blue-600">
                                <Icon size={18} />
                            </div>
                            <span className="text-sm font-medium text-gray-700">{item.label}</span>
                        </div>
                    );
                })}
            </div>

            <div className="mt-8 p-4 bg-blue-50 rounded-lg text-xs text-blue-800">
                <p className="font-semibold mb-1">Tip:</p>
                Click items to add them to the canvas. Drag to reorder or resize.
            </div>
        </div>
    );
}
