import { useState } from 'react';
import { validLabelColor } from './cannedResponseValues';

export interface CannedResponseLabel { id: string; name: string; color: string }
interface Props {
    labels: CannedResponseLabel[]; editingLabelId: string | null; newLabelName: string; newLabelColor: string;
    onLabelsChange: (labels: CannedResponseLabel[]) => void; onEditingLabelIdChange: (id: string | null) => void;
    onNewLabelNameChange: (name: string) => void; onNewLabelColorChange: (color: string) => void;
    onCreateLabel: () => void; onUpdateLabel: (id: string, name: string, color: string) => void; onDeleteLabel: (id: string) => void; onRefreshLabels: () => void;
}
const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];
export function CannedResponseLabelManager(props: Props) {
    const valid = !!props.newLabelName.trim() && validLabelColor(props.newLabelColor);
    return <section aria-label="Response labels" className="p-4 space-y-4 rounded-xl border bg-indigo-50 dark:bg-slate-800 border-indigo-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"><h3>Labels</h3>
        {!props.labels.length && <p>No labels yet. Create one below.</p>}
        {props.labels.map(label => props.editingLabelId === label.id ? <LabelDraft key={`edit:${label.id}`} label={label} save={props.onUpdateLabel} cancel={() => props.onEditingLabelIdChange(null)} /> : <div key={label.id} className="flex flex-wrap items-center gap-3">
            <span aria-hidden="true" className="w-4 h-4 rounded-full" style={{ backgroundColor: validLabelColor(label.color) ? label.color : undefined }} /><span>{label.name}</span>
            <button type="button" aria-label={`Edit label ${label.name}`} onClick={() => props.onEditingLabelIdChange(label.id)}>Edit</button><button type="button" aria-label={`Delete label ${label.name}`} onClick={() => props.onDeleteLabel(label.id)}>Delete</button>
        </div>)}
        <div className="flex flex-wrap gap-3 items-end">
            <label>New label color<input className="block" type="color" value={validLabelColor(props.newLabelColor) ? props.newLabelColor : '#6366f1'} onChange={event => props.onNewLabelColorChange(event.target.value)} /></label>
            <div role="group" aria-label="Preset label colors" className="flex flex-wrap gap-2">{colors.map(color => <button key={color} type="button" aria-label={`Use color ${color}`} aria-pressed={props.newLabelColor.toLowerCase() === color} onClick={() => props.onNewLabelColorChange(color)} className="w-6 h-6 border rounded-full focus-visible:outline-2 focus-visible:outline-indigo-600" style={{ backgroundColor: color }} />)}</div>
            <label>New label name<input className="block p-2 border rounded-lg bg-white dark:bg-slate-900" value={props.newLabelName} onChange={event => props.onNewLabelNameChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (valid) props.onCreateLabel(); } }} /></label>
            <button type="button" disabled={!valid} onClick={() => { if (valid) props.onCreateLabel(); }}>Add</button>
        </div>
    </section>;
}
function LabelDraft({ label, save, cancel }: { label: CannedResponseLabel; save: Props['onUpdateLabel']; cancel: () => void }) {
    const [name, setName] = useState(label.name); const [color, setColor] = useState(label.color);
    return <div className="flex flex-wrap gap-3 items-end"><label>Label name<input className="block p-2 border rounded-lg bg-white dark:bg-slate-900" value={name} onChange={event => setName(event.target.value)} /></label><label>Label color<input className="block" type="color" value={validLabelColor(color) ? color : '#6366f1'} onChange={event => setColor(event.target.value)} /></label><button type="button" aria-label={`Save label ${label.name}`} disabled={!name.trim() || !validLabelColor(color)} onClick={() => save(label.id, name.trim(), color)}>Save</button><button type="button" aria-label={`Cancel editing label ${label.name}`} onClick={cancel}>Cancel</button></div>;
}
