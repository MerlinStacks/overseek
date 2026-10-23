import { useState, type DragEvent } from 'react';
import { Copy, GripVertical, Layers, LayoutPanelTop, Trash2 } from 'lucide-react';
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
    onReorderSection: (sectionId: string, targetIndex: number) => void;
    onRelocateBlock: (blockId: string, sectionId: string, columnId: string, targetIndex: number) => void;
    onStepBlock: (blockId: string, direction: -1 | 1) => void;
    onCloneSection: (sectionId: string) => void;
    onDeleteSection: (sectionId: string) => void;
    onCloneBlock: (blockId: string) => void;
    onDeleteBlock: (blockId: string) => void;
}

type DraggedLayer = { kind: 'section' | 'block'; id: string };
const LAYER_DRAG_TYPE = 'application/x-overseek-layer';
const BLOCK_DRAG_TYPE = 'application/x-overseek-existing-block';

/** Keep hidden content in the outline so it remains selectable on any device. */
export function EmailLayersPanel({ sections, selectedSectionId, selectedBlockId, onSelect, onReorderSection, onRelocateBlock, onStepBlock, onCloneSection, onDeleteSection, onCloneBlock, onDeleteBlock }: Props) {
    const [dragging, setDragging] = useState<DraggedLayer | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const selectedStyle = 'bg-[var(--brand-subtle)] text-[var(--brand-text)] ring-1 ring-inset ring-[var(--brand-border)]';
    const actionStyle = 'shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-[var(--brand-text)] focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] dark:text-slate-400 dark:hover:bg-slate-800';
    const finishDrag = () => { setDragging(null); setDropTarget(null); };
    const startDrag = (event: DragEvent, layer: DraggedLayer) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(LAYER_DRAG_TYPE, JSON.stringify(layer));
        if (layer.kind === 'block') event.dataTransfer.setData(BLOCK_DRAG_TYPE, layer.id);
        setDragging(layer);
    };
    const readDrag = (event: DragEvent): DraggedLayer | null => {
        try {
            const layer = JSON.parse(event.dataTransfer.getData(LAYER_DRAG_TYPE) || 'null');
            if (layer && ['section', 'block'].includes(layer.kind) && typeof layer.id === 'string') return layer;
        } catch { /* Canvas block drags use their own existing-block type. */ }
        const id = event.dataTransfer.getData(BLOCK_DRAG_TYPE);
        return id ? { kind: 'block', id } : null;
    };
    const dragOver = (event: DragEvent, target: string) => {
        if (!Array.from(event.dataTransfer.types).some(type => [LAYER_DRAG_TYPE, BLOCK_DRAG_TYPE].includes(type))) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(target);
    };
    const after = (event: DragEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY > rect.top + rect.height / 2;
    };
    const dropBlock = (event: DragEvent, sectionId: string, columnId: string, index: number) => {
        const layer = readDrag(event);
        if (layer?.kind !== 'block') return;
        event.preventDefault(); event.stopPropagation();
        onRelocateBlock(layer.id, sectionId, columnId, index);
        finishDrag();
    };
    return <nav aria-label="Email layers" className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-4" onDragEnd={finishDrag} onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);
    }}>
        <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">Layers</p>
        <p className="sr-only">Drag layer handles to rearrange. Focus a handle and press Alt plus Up or Down to move a layer with the keyboard.</p>
        {sections.length === 0 && <p className="text-sm text-slate-500">Add a structure to start your email.</p>}
        {sections.map((section, index) => <div key={section.id} aria-label={`Section layer ${section.name || index + 1}`} className="relative rounded-lg border border-slate-200 dark:border-slate-700" onDragOver={event => {
            if (dragging?.kind === 'section') dragOver(event, `section:${index + (after(event) ? 1 : 0)}`);
            else if (section.columns[0]) dragOver(event, `column:${section.columns[0].id}`);
        }} onDrop={event => {
            const layer = readDrag(event);
            if (layer?.kind === 'section') {
                event.preventDefault(); event.stopPropagation();
                onReorderSection(layer.id, index + (after(event) ? 1 : 0));
                finishDrag();
            } else if (section.columns[0]) dropBlock(event, section.id, section.columns[0].id, section.columns[0].blocks.length);
        }}>
            {dropTarget === `section:${index}` && <span className="pointer-events-none absolute inset-x-0 -top-1 h-0.5 bg-[var(--primary-color)]" />}
            {dropTarget === `section:${index + 1}` && <span className="pointer-events-none absolute inset-x-0 -bottom-1 h-0.5 bg-[var(--primary-color)]" />}
            <div className="flex items-center gap-1 rounded-t-lg px-1 py-1">
                <button type="button" draggable aria-label={`Drag section ${section.name || index + 1}`} title="Drag to reorder; Alt+↑/↓ to move" className={`${actionStyle} cursor-grab active:cursor-grabbing`} onDragStart={event => startDrag(event, { kind: 'section', id: section.id })} onKeyDown={event => {
                    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onReorderSection(section.id, Math.max(0, Math.min(sections.length, index + (event.key === 'ArrowUp' ? -1 : 2)))); }
                }}><GripVertical size={13} /></button>
                <button type="button" title={section.name || `Section ${index + 1}`} aria-label={`Select section ${section.name || index + 1}`} aria-pressed={selectedSectionId === section.id && !selectedBlockId} onClick={() => onSelect(section.id)} className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-2 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] ${selectedSectionId === section.id && !selectedBlockId ? selectedStyle : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
                    <LayoutPanelTop size={13} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{section.name || `Section ${index + 1}`}{section.visibility && section.visibility !== 'all' && <span className="block text-[10px] font-normal">{section.visibility} only</span>}</span>
                </button>
                <button type="button" aria-label={`Clone section ${section.name || index + 1}`} title="Clone section" className={actionStyle} onClick={() => onCloneSection(section.id)}><Copy size={13} /></button>
                <button type="button" aria-label={`Delete section ${section.name || index + 1}`} title="Delete section" className={`${actionStyle} hover:text-red-600`} onClick={() => onDeleteSection(section.id)}><Trash2 size={13} /></button>
            </div>
            <div className="space-y-1 p-1">
                {section.columns.map((column, columnIndex) => <div key={column.id} aria-label={`Column ${columnIndex + 1} in ${section.name || `section ${index + 1}`}`} className={`space-y-1 rounded ${dropTarget === `column:${column.id}` ? 'ring-2 ring-[var(--primary-color)]' : ''}`} onDragOver={event => { if (dragging?.kind !== 'section') dragOver(event, `column:${column.id}`); }} onDrop={event => dropBlock(event, section.id, column.id, column.blocks.length)}>
                    {section.columns.length > 1 && <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Column {columnIndex + 1}</p>}
                    {column.blocks.length === 0 && <p className="px-2 py-1 text-xs text-slate-400">Empty column</p>}
                    {column.blocks.map((block, blockIndex) => {
                        const summary = blockSummary(block);
                        const label = `${getEmailDesignV2BlockLabel(block)}: ${summary}`;
                        return <div key={block.id} aria-label={`Block layer ${label}`} className="relative flex items-center gap-0.5 rounded-md" onDragOver={event => { if (dragging?.kind !== 'section') dragOver(event, `block:${column.id}:${blockIndex + (after(event) ? 1 : 0)}`); }} onDrop={event => dropBlock(event, section.id, column.id, blockIndex + (after(event) ? 1 : 0))}>
                            {dropTarget === `block:${column.id}:${blockIndex}` && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-[var(--primary-color)]" />}
                            {dropTarget === `block:${column.id}:${blockIndex + 1}` && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-[var(--primary-color)]" />}
                            <button type="button" draggable aria-label={`Drag ${label}`} title="Drag to reorder; Alt+↑/↓ to move" className={`${actionStyle} cursor-grab active:cursor-grabbing`} onDragStart={event => startDrag(event, { kind: 'block', id: block.id })} onKeyDown={event => {
                                if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onStepBlock(block.id, event.key === 'ArrowUp' ? -1 : 1); }
                            }}><GripVertical size={13} /></button>
                            <button type="button" title={summary} aria-label={`Select ${label}`} aria-pressed={selectedBlockId === block.id} onClick={() => onSelect(section.id, block.id)} className={`flex min-w-0 flex-1 items-start gap-1 rounded-md px-1 py-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] ${selectedBlockId === block.id ? selectedStyle : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                                <Layers size={12} className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-xs">{summary}</span><span className="block truncate text-[10px] opacity-70">{getEmailDesignV2BlockLabel(block)}{block.visibility && block.visibility !== 'all' ? ` · ${block.visibility} only` : ''}</span></span>
                            </button>
                            <button type="button" aria-label={`Clone ${label}`} title="Clone block" className={actionStyle} onClick={() => onCloneBlock(block.id)}><Copy size={13} /></button>
                            <button type="button" aria-label={`Delete ${label}`} title="Delete block" className={`${actionStyle} hover:text-red-600`} onClick={() => onDeleteBlock(block.id)}><Trash2 size={13} /></button>
                        </div>;
                    })}
                </div>)}
            </div>
        </div>)}
    </nav>;
}
