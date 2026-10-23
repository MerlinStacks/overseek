import { Layers, LayoutPanelTop } from 'lucide-react';
import { getEmailDesignV2BlockLabel, type EmailBlock, type EmailSection } from '../../../lib/emailDesignerV2';

function blockSummary(block: EmailBlock): string {
    if (block.type === 'text') return new DOMParser().parseFromString(block.props.html, 'text/html').body.textContent?.trim().slice(0, 70) || 'Text';
    if (block.type === 'image' || block.type === 'siteLogo') return block.props.alt || getEmailDesignV2BlockLabel(block);
    if (block.type === 'button' || block.type === 'cartLink') return block.props.label || getEmailDesignV2BlockLabel(block);
    return getEmailDesignV2BlockLabel(block);
}

interface Props {
    sections: EmailSection[];
    selectedSectionId: string;
    selectedBlockId: string | null;
    onSelect: (sectionId: string, blockId?: string) => void;
}

/** Keep hidden content in the outline so it remains selectable on any device. */
export function EmailLayersPanel({ sections, selectedSectionId, selectedBlockId, onSelect }: Props) {
    const selectedStyle = 'bg-[var(--brand-subtle)] text-[var(--brand-text)] ring-1 ring-inset ring-[var(--brand-border)]';
    return <nav aria-label="Email layers" className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-4">
        <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">Layers</p>
        {sections.length === 0 && <p className="text-sm text-slate-500">Add a structure to start your email.</p>}
        {sections.map((section, index) => <div key={section.id} className="rounded-lg border border-slate-200 dark:border-slate-700">
            <button type="button" aria-label={`Select section ${section.name || index + 1}`} aria-pressed={selectedSectionId === section.id && !selectedBlockId} onClick={() => onSelect(section.id)} className={`flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] ${selectedSectionId === section.id && !selectedBlockId ? selectedStyle : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
                <LayoutPanelTop size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{section.name || `Section ${index + 1}`}</span>
                {section.visibility && section.visibility !== 'all' && <span className="text-[10px] font-normal">{section.visibility} only</span>}
            </button>
            <div className="space-y-1 p-2">
                {section.columns.map((column, columnIndex) => <div key={column.id} className="space-y-1">
                    {section.columns.length > 1 && <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Column {columnIndex + 1}</p>}
                    {column.blocks.length === 0 && <p className="px-2 py-1 text-xs text-slate-400">Empty column</p>}
                    {column.blocks.map(block => <button key={block.id} type="button" aria-label={`Select ${getEmailDesignV2BlockLabel(block)}: ${blockSummary(block)}`} aria-pressed={selectedBlockId === block.id} onClick={() => onSelect(section.id, block.id)} className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] ${selectedBlockId === block.id ? selectedStyle : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                        <Layers size={13} className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-xs">{blockSummary(block)}</span><span className="block text-[10px] opacity-70">{getEmailDesignV2BlockLabel(block)}{block.visibility && block.visibility !== 'all' ? ` · ${block.visibility} only` : ''}</span></span>
                    </button>)}
                </div>)}
            </div>
        </div>)}
    </nav>;
}
