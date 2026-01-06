import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Layout, Image as ImageIcon } from 'lucide-react';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DesignerCanvasProps {
    layout: any[];
    items: any[];
    selectedId: string | null;
    onLayoutChange: (layout: any) => void;
    onSelect: (id: string | null) => void;
}

export function DesignerCanvas({ layout, items, selectedId, onLayoutChange, onSelect }: DesignerCanvasProps) {

    const renderItemContent = (itemConfig: any) => {
        if (!itemConfig) return <div className="p-2 text-red-500">Error: Item config missing</div>;

        switch (itemConfig.type) {
            case 'text':
                return <div className="p-2 h-full overflow-hidden">
                    <p className="whitespace-pre-wrap">{itemConfig.content || 'Text Block'}</p>
                </div>;
            case 'image':
                return <div className="w-full h-full flex items-center justify-center overflow-hidden bg-gray-50">
                    {itemConfig.content ? (
                        <img src={itemConfig.content} alt="Invoice" className="w-full h-full object-contain" />
                    ) : (
                        <div className="text-gray-400 flex flex-col items-center">
                            <ImageIcon size={24} />
                            <span className="text-xs mt-1">No Image</span>
                        </div>
                    )}
                </div>;
            case 'order_table':
                return <div className="p-2 h-full bg-gray-50 flex items-center justify-center border-2 border-dashed border-gray-300">
                    <span className="text-gray-500">Order Items Table Preview</span>
                </div>;
            case 'totals':
                return <div className="p-2 h-full bg-gray-50 flex flex-col items-end justify-center border-2 border-dashed border-gray-300">
                    <div className="w-1/2 h-2 bg-gray-200 mb-1"></div>
                    <div className="w-1/3 h-2 bg-gray-200"></div>
                </div>;
            default:
                return <div className="p-2">{itemConfig.type}</div>;
        }
    };

    return (
        <div className="flex-1 overflow-y-auto p-8 relative">
            <div className="max-w-[210mm] mx-auto min-h-[297mm] bg-white shadow-xl relative scale-100 origin-top">
                <ResponsiveGridLayout
                    className="layout"
                    layouts={{ lg: layout }}
                    breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                    cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                    rowHeight={30}
                    width={794}
                    onLayoutChange={onLayoutChange}
                    isDroppable={true}
                >
                    {layout.map(l => {
                        const itemConfig = items.find(i => i.id === l.i);
                        const isSelected = selectedId === l.i;
                        if (!itemConfig) return <div key={l.i}></div>;

                        return (
                            <div
                                key={l.i}
                                className={`bg-white border group relative ${isSelected ? 'border-blue-600 ring-1 ring-blue-600 z-10' : 'hover:border-blue-400'}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect(l.i);
                                }}
                            >
                                {/* Drag Handle */}
                                <div className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 cursor-move bg-gray-100 z-10">
                                    <Layout size={12} />
                                </div>
                                {renderItemContent(itemConfig)}
                            </div>
                        );
                    })}
                </ResponsiveGridLayout>
            </div>
        </div>
    );
}
