import { useState, type CSSProperties, type DragEvent } from 'react';
import { Copy, GripVertical, Settings, Trash2, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import type { EmailBlock, EmailDesignTheme, EmailSection } from '../../../lib/emailDesignerV2';
import { LiveBlock } from './LiveBlock';

interface Props {
    theme: EmailDesignTheme;
    previewWidth: number;
    isMobilePreview: boolean;
    sections: EmailSection[];
    selectedSectionId: string;
    selectedBlockId: string | null;
    onSelectSection: (id: string) => void;
    onSelectBlock: (id: string) => void;
    onUpdateBlock: (id: string, updater: (block: EmailBlock) => void) => void;
    onDuplicateBlock: (id: string) => void;
    onMoveBlock?: (id: string, direction: -1 | 1) => void;
    warnings?: Array<{ blockId?: string; message: string; severity: string }>;
    onDeleteBlock: (id: string) => void;
    onDeleteSection: (id: string) => void;
    onOpenSettings: () => void;
    onOpenSectionSettings: () => void;
    onDropOnSection: (event: DragEvent, sectionId: string, insertIndex?: number, columnId?: string) => void;
    onDropStructure: (event: DragEvent, insertIndex: number) => void;
}

export function EmailDropCanvas({ theme, previewWidth, isMobilePreview, sections, selectedSectionId, selectedBlockId, onSelectSection, onSelectBlock, onUpdateBlock, onDuplicateBlock, onMoveBlock, warnings = [], onDeleteBlock, onDeleteSection, onOpenSettings, onOpenSectionSettings, onDropOnSection, onDropStructure }: Props) {
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [sectionDropIndex, setSectionDropIndex] = useState<number | null>(null);
    const canvasStyle: CSSProperties = { background: theme.backgroundColor, fontFamily: theme.fontFamily, color: theme.textColor };
    const isHidden = (visibility?: string) => isMobilePreview ? visibility === 'desktop' : visibility === 'mobile';
    const emailStyle: CSSProperties = { width: isMobilePreview ? previewWidth : '100%', maxWidth: isMobilePreview ? previewWidth : theme.contentWidth, background: theme.contentBackgroundColor, borderRadius: theme.borderRadius };

    const isStructureDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('application/x-overseek-structure');
    const getSectionInsertIndex = (event: DragEvent<HTMLElement>, sectionIndex: number) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY > rect.top + rect.height / 2 ? sectionIndex + 1 : sectionIndex;
    };
    const handleStructureDragOver = (event: DragEvent, insertIndex: number) => {
        if (!isStructureDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setSectionDropIndex(insertIndex);
    };
    const handleSectionDragOver = (event: DragEvent<HTMLElement>, sectionIndex: number) => {
        if (!isStructureDrag(event)) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        setSectionDropIndex(getSectionInsertIndex(event, sectionIndex));
    };
    const handleStructureDrop = (event: DragEvent, insertIndex: number) => {
        const structureWidths = event.dataTransfer.getData('application/x-overseek-structure');
        if (!structureWidths) return;
        setSectionDropIndex(null);
        onDropStructure(event, insertIndex);
    };
    const handleSectionDrop = (event: DragEvent<HTMLElement>, sectionIndex: number, sectionId: string, columnId?: string) => {
        if (event.dataTransfer.getData('application/x-overseek-structure')) {
            handleStructureDrop(event, sectionDropIndex ?? getSectionInsertIndex(event, sectionIndex));
            return;
        }
        setDropTarget(null);
        onDropOnSection(event, sectionId, undefined, columnId);
    };
    const startBlockDrag = (event: DragEvent<HTMLElement>, blockId: string) => {
        event.stopPropagation();
        event.dataTransfer.setData('application/x-overseek-existing-block', blockId);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div className={`mx-auto rounded-xl p-4 shadow-sm transition-all ${isMobilePreview ? 'border-[10px] border-slate-900 shadow-slate-900/30' : 'max-w-5xl'}`} style={{ ...canvasStyle, maxWidth: isMobilePreview ? previewWidth + 52 : undefined }}>
            <div className="mx-auto overflow-hidden shadow-sm" style={emailStyle}>
                {sections.map((section, sectionIndex) => {
                    if (isHidden(section.visibility)) return null;
                    const stacked = isMobilePreview && section.stackMode !== 'none';
                    const radius = section.borderRadius || [0, 0, 0, 0];
                    const borderStyle = section.borderStyle || 'none';
                    const borderWidth = section.borderWidth || 0;
                    const sectionStyle: CSSProperties = {
                        background: section.backgroundColor || theme.contentBackgroundColor,
                        padding: section.padding || '0',
                        borderStyle: borderStyle === 'none' ? 'none' : borderStyle,
                        borderWidth,
                        borderColor: section.borderColor || '#e2e8f0',
                        borderRadius: `${radius[0]}px ${radius[1]}px ${radius[2]}px ${radius[3]}px`,
                    };
                    return (
                        <div key={section.id} data-email-section-id={section.id} className="relative">
                            <div aria-label="Structure insertion target" onDragOver={(event) => handleStructureDragOver(event, sectionIndex)} onDragLeave={() => setSectionDropIndex(null)} onDrop={(event) => handleStructureDrop(event, sectionIndex)} className="absolute inset-x-0 -top-2 z-30 h-4">
                                <div className={`h-1 rounded-full transition ${sectionDropIndex === sectionIndex ? 'bg-[var(--primary-color)]' : 'bg-transparent'}`} />
                            </div>
                <section onDragOver={(event) => handleSectionDragOver(event, sectionIndex)} onDrop={(event) => handleSectionDrop(event, sectionIndex, section.id)} onClick={() => { onSelectSection(section.id); onOpenSectionSettings(); }} className={`group/section relative transition ${selectedSectionId === section.id ? 'outline outline-2 outline-[var(--focus-color)]' : 'outline outline-1 outline-transparent hover:outline-[var(--focus-color)]'}`} style={sectionStyle}>
                                <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 opacity-0 shadow-sm transition group-hover/section:opacity-100">{section.name || 'Section'}</div>
                                <div className="absolute right-2 top-2 z-20 hidden rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm group-hover/section:flex">
                                    <button type="button" title="Delete section" onClick={(event) => { event.stopPropagation(); onDeleteSection(section.id); }} className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                                </div>
                                <div className="flex" style={{ flexDirection: stacked ? section.stackMode === 'reverse' ? 'column-reverse' : 'column' : 'row' }}>
                                    {section.columns.map((column) => (
                                        <div
                                            key={column.id}
                                            style={{
                                                width: stacked ? '100%' : `${column.width}%`,
                                                background: column.backgroundColor || 'transparent',
                                                padding: column.padding || '0',
                                                alignSelf: column.verticalAlign === 'bottom' ? 'flex-end' : column.verticalAlign === 'middle' ? 'center' : 'stretch',
                                            }}
                                            onDragOver={(event) => handleSectionDragOver(event, sectionIndex)}
                                            onDrop={(event) => handleSectionDrop(event, sectionIndex, section.id, column.id)}
                                            className="min-w-0 outline outline-1 outline-dashed outline-slate-200"
                                        >
                                            {column.blocks.length === 0 && <div className="flex min-h-16 items-center justify-center rounded-md text-xs text-slate-400">Drop here</div>}
                                            {column.blocks.map((block, index) => !isHidden(block.visibility) && (
                                                <div key={block.id} data-email-block-id={block.id} className="group/block relative" onDragOver={(event) => { if (isStructureDrag(event)) handleSectionDragOver(event, sectionIndex); else { event.preventDefault(); setDropTarget(`${column.id}:${index}`); } }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => { if (event.dataTransfer.getData('application/x-overseek-structure')) handleSectionDrop(event, sectionIndex, section.id, column.id); else { setDropTarget(null); onDropOnSection(event, section.id, index, column.id); } }} onClick={(event) => { event.stopPropagation(); onSelectSection(section.id); onSelectBlock(block.id); onOpenSettings(); }}>
                                                    <div aria-label="Block insertion target" className={`pointer-events-none absolute inset-x-0 top-0 z-30 h-1 rounded-full transition ${dropTarget === `${column.id}:${index}` ? 'bg-[var(--primary-color)]' : 'bg-transparent'}`} />
                                        <div className={`relative transition ${selectedBlockId === block.id ? 'ring-2 ring-[var(--focus-color)] ring-offset-2' : 'hover:ring-2 hover:ring-[var(--focus-color)] hover:ring-offset-2'}`}>
                                                        <div className="absolute right-2 top-2 z-20 hidden rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm group-hover/block:flex">
                                                            <button type="button" title="Drag to move block" aria-label="Drag to move block" draggable onDragStart={(event) => startBlockDrag(event, block.id)} onMouseDown={(event) => event.stopPropagation()} className="cursor-grab rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[var(--brand-text)] active:cursor-grabbing"><GripVertical size={14} /></button>
                                                            <button type="button" title="Duplicate" onClick={(event) => { event.stopPropagation(); onDuplicateBlock(block.id); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[var(--brand-text)]"><Copy size={14} /></button>
                                                            <button type="button" title="Settings" onClick={(event) => { event.stopPropagation(); onSelectBlock(block.id); onOpenSettings(); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[var(--brand-text)]"><Settings size={14} /></button>
                                                            <button type="button" title="Delete" onClick={(event) => { event.stopPropagation(); onDeleteBlock(block.id); }} className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                                                        </div>
                                                        <div className="absolute left-0 top-0 z-20 flex flex-wrap items-center gap-1 rounded bg-white/95 opacity-0 shadow-sm transition group-hover/block:opacity-100 group-focus-within/block:opacity-100" aria-label="Block actions">
                                                            <button type="button" aria-label={`Move ${block.type} up`} onClick={(event) => { event.stopPropagation(); onMoveBlock?.(block.id, -1); }} className="rounded p-1 text-slate-500 hover:bg-[var(--brand-subtle)]"><ArrowUp size={14} /></button>
                                                            <button type="button" aria-label={`Move ${block.type} down`} onClick={(event) => { event.stopPropagation(); onMoveBlock?.(block.id, 1); }} className="rounded p-1 text-slate-500 hover:bg-[var(--brand-subtle)]"><ArrowDown size={14} /></button>
                                                            {warnings.filter(warning => warning.blockId === block.id).map(warning => <button key={warning.message} type="button" title={warning.message} onClick={(event) => { event.stopPropagation(); onSelectBlock(block.id); onOpenSettings(); }} className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] ${warning.severity === 'blocking' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}><AlertTriangle size={12} />{warning.severity === 'blocking' ? 'Fix required' : 'Review'}</button>)}
                                                        </div>
                                                        <LiveBlock block={block} theme={theme} onUpdate={(updater) => onUpdateBlock(block.id, updater)} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    );
                })}
                <div className="relative">
                <div aria-label="Structure insertion target" onDragOver={(event) => handleStructureDragOver(event, sections.length)} onDragLeave={() => setSectionDropIndex(null)} onDrop={(event) => handleStructureDrop(event, sections.length)} className="absolute inset-x-0 -top-2 z-30 h-4">
                    <div className={`h-1 rounded-full transition ${sectionDropIndex === sections.length ? 'bg-[var(--primary-color)]' : 'bg-transparent'}`} />
                </div>
                </div>
            </div>
        </div>
    );
}
