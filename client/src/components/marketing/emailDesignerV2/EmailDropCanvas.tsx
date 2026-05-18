import { useState, type CSSProperties, type DragEvent } from 'react';
import { Copy, GripVertical, Settings, Trash2 } from 'lucide-react';
import type { EmailBlock, EmailDesignTheme, EmailSection } from '../../../lib/emailDesignerV2';
import { LiveBlock } from './LiveBlock';

interface Props {
    theme: EmailDesignTheme;
    previewMode: 'desktop' | 'mobile';
    sections: EmailSection[];
    selectedSectionId: string;
    selectedBlockId: string | null;
    onSelectSection: (id: string) => void;
    onSelectBlock: (id: string) => void;
    onUpdateBlock: (id: string, updater: (block: EmailBlock) => void) => void;
    onDuplicateBlock: (id: string) => void;
    onDeleteBlock: (id: string) => void;
    onOpenSettings: () => void;
    onDropOnSection: (event: DragEvent, sectionId: string, insertIndex?: number, columnId?: string) => void;
    onDropStructure: (event: DragEvent, insertIndex: number) => void;
}

export function EmailDropCanvas({ theme, previewMode, sections, selectedSectionId, selectedBlockId, onSelectSection, onSelectBlock, onUpdateBlock, onDuplicateBlock, onDeleteBlock, onOpenSettings, onDropOnSection, onDropStructure }: Props) {
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [sectionDropIndex, setSectionDropIndex] = useState<number | null>(null);
    const canvasStyle: CSSProperties = { background: theme.backgroundColor, fontFamily: theme.fontFamily, color: theme.textColor };
    const emailStyle: CSSProperties = { maxWidth: previewMode === 'mobile' ? 390 : theme.contentWidth, background: theme.contentBackgroundColor, borderRadius: theme.borderRadius };

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

    return (
        <div className={`mx-auto rounded-3xl p-4 shadow-2xl transition-all ${previewMode === 'mobile' ? 'max-w-[430px] border-[10px] border-slate-900 shadow-slate-900/30' : 'max-w-5xl'}`} style={canvasStyle}>
            <div className="mx-auto overflow-hidden shadow-xl" style={emailStyle}>
                {sections.map((section, sectionIndex) => {
                    const sectionStyle: CSSProperties = { background: section.backgroundColor || theme.contentBackgroundColor, padding: section.padding || '0' };
                    return (
                        <div key={section.id}>
                            <div onDragOver={(event) => handleStructureDragOver(event, sectionIndex)} onDragLeave={() => setSectionDropIndex(null)} onDrop={(event) => handleStructureDrop(event, sectionIndex)} className="py-3">
                                <div className={`h-1 rounded-full transition ${sectionDropIndex === sectionIndex ? 'bg-indigo-500' : 'bg-transparent'}`} />
                            </div>
                            <section onDragOver={(event) => handleSectionDragOver(event, sectionIndex)} onDrop={(event) => handleSectionDrop(event, sectionIndex, section.id)} onClick={() => onSelectSection(section.id)} className={`group/section relative transition ${selectedSectionId === section.id ? 'outline outline-2 outline-indigo-400' : 'outline outline-1 outline-transparent hover:outline-indigo-200'}`} style={sectionStyle}>
                                <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 opacity-0 shadow-sm transition group-hover/section:opacity-100">{section.name || 'Section'}</div>
                                <div className="flex gap-3">
                                    {section.columns.map((column) => (
                                        <div key={column.id} style={{ width: `${column.width}%` }} onDragOver={(event) => handleSectionDragOver(event, sectionIndex)} onDrop={(event) => handleSectionDrop(event, sectionIndex, section.id, column.id)} className="min-h-16 rounded-lg border border-dashed border-slate-200 p-2">
                                            {column.blocks.length === 0 && <div className="flex min-h-16 items-center justify-center rounded-md text-xs text-slate-400">Drop here</div>}
                                            {column.blocks.map((block, index) => (
                                                <div key={block.id} className="group/block relative" draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-overseek-existing-block', block.id); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={(event) => { if (isStructureDrag(event)) handleSectionDragOver(event, sectionIndex); else { event.preventDefault(); setDropTarget(`${column.id}:${index}`); } }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => { if (event.dataTransfer.getData('application/x-overseek-structure')) handleSectionDrop(event, sectionIndex, section.id, column.id); else { setDropTarget(null); onDropOnSection(event, section.id, index, column.id); } }} onClick={(event) => { event.stopPropagation(); onSelectSection(section.id); onSelectBlock(block.id); }}>
                                                    <div className={`h-1 rounded-full transition ${dropTarget === `${column.id}:${index}` ? 'bg-indigo-500' : 'bg-transparent'}`} />
                                                    <div className={`relative transition ${selectedBlockId === block.id ? 'ring-2 ring-indigo-500 ring-offset-2' : 'hover:ring-2 hover:ring-indigo-200 hover:ring-offset-2'}`}>
                                                        <div className="absolute right-2 top-2 z-20 hidden rounded-lg border border-slate-200 bg-white/95 p-1 shadow-lg group-hover/block:flex">
                                                            <button type="button" title="Move" className="cursor-grab rounded-md p-1 text-slate-500 hover:bg-slate-100"><GripVertical size={14} /></button>
                                                            <button type="button" title="Duplicate" onClick={(event) => { event.stopPropagation(); onDuplicateBlock(block.id); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"><Copy size={14} /></button>
                                                            {block.type !== 'text' && <button type="button" title="Settings" onClick={(event) => { event.stopPropagation(); onSelectBlock(block.id); onOpenSettings(); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"><Settings size={14} /></button>}
                                                            <button type="button" title="Delete" onClick={(event) => { event.stopPropagation(); onDeleteBlock(block.id); }} className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
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
                <div onDragOver={(event) => handleStructureDragOver(event, sections.length)} onDragLeave={() => setSectionDropIndex(null)} onDrop={(event) => handleStructureDrop(event, sections.length)} className="py-3">
                    <div className={`h-1 rounded-full transition ${sectionDropIndex === sections.length ? 'bg-indigo-500' : 'bg-transparent'}`} />
                </div>
            </div>
        </div>
    );
}
