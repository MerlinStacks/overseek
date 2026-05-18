import type { PaletteItem, PaletteKey } from './blockFactory';

export function PaletteGrid({ items, onAdd }: { items: PaletteItem[]; onAdd: (key: PaletteKey) => void }) {
    return (
        <div className="grid grid-cols-4 gap-3">
            {items.map((item) => {
                const Icon = item.icon;
                return (
                    <button
                        key={item.key}
                        draggable
                        onDragStart={(event) => {
                            event.dataTransfer.setData('application/x-overseek-block', item.key);
                            event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => onAdd(item.key)}
                        className="group flex min-h-[66px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-400 bg-white px-2 py-2 text-center text-xs text-slate-500 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-indigo-950/30"
                        title={`Drag ${item.label} into the email`}
                    >
                        <Icon size={26} className="mb-1 text-slate-400 group-hover:text-indigo-500" />
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
