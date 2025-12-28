import React from 'react';
import { Handle, Position } from 'reactflow';
import { Mail, Zap, GitBranch, Clock, Percent, X, Tag, Send, UserPlus, MoreHorizontal, Flag } from 'lucide-react';

// New Card Style
const NodeCard = ({ children, selected, icon: Icon, color, title, label, stats }) => (
    <div className={`flow-node-card ${selected ? 'selected' : ''}`}>
        <div className="node-card-content">
            <div className="node-icon" style={{ background: color + '22', color: color }}>
                {Icon && <Icon size={20} />}
            </div>
            <div className="node-details">
                <span className="node-type">{title}</span>
                <span className="node-label">{label}</span>
            </div>
            <div className="node-menu">
                <MoreHorizontal size={16} />
            </div>
        </div>
        {(stats || title === 'Email') && (
            <div className="node-stats-bar">
                <div className="stat-pill success">
                    <span>Active</span>
                    <strong>{stats?.active || 0}</strong>
                </div>
                <div className="stat-divider"></div>
                <div className="stat-pill">
                    <span>Completed</span>
                    <strong>{stats?.completed || 0}</strong>
                </div>
            </div>
        )}
        {children}
    </div>
);

export const TriggerNode = ({ data, selected }) => (
    <div className="node-wrapper-trigger">
        <NodeCard selected={selected} icon={Zap} color="#ec4899" title="Trigger" label={data.label}>
            <Handle type="source" position={Position.Bottom} className="flow-handle" />
        </NodeCard>
    </div>
);

export const ActionNode = ({ data, selected }) => {
    let Icon = Mail;
    let color = '#60a5fa'; // Blue
    if (data.subType === 'tag') { Icon = Tag; color = '#a78bfa'; }
    if (data.subType === 'webhook') { Icon = Send; color = '#fbbf24'; }
    if (data.subType === 'user') { Icon = UserPlus; color = '#34d399'; }

    return (
        <div className="node-wrapper">
            <Handle type="target" position={Position.Top} className="flow-handle" />
            <NodeCard selected={selected} icon={Icon} color={color} title={data.actionType || 'Action'} label={data.label} stats={data.stats} />
            <Handle type="source" position={Position.Bottom} className="flow-handle" />
        </div>
    );
};

export const ConditionNode = ({ data, selected }) => (
    <div className="node-wrapper">
        <Handle type="target" position={Position.Top} className="flow-handle" />
        <NodeCard selected={selected} icon={GitBranch} color="#ec4899" title="Condition" label={data.label} />

        {/* Branch Labels */}
        <div className="branch-label yes">Yes</div>
        <Handle type="source" position={Position.Bottom} id="true" className="flow-handle handle-yes" style={{ left: '30%' }} />

        <div className="branch-label no">No</div>
        <Handle type="source" position={Position.Bottom} id="false" className="flow-handle handle-no" style={{ left: '70%' }} />
    </div>
);

export const WaitNode = ({ data, selected }) => (
    <div className="node-wrapper">
        <Handle type="target" position={Position.Top} className="flow-handle" />
        <NodeCard selected={selected} icon={Clock} color="#fbbf24" title="Delay" label={data.label} />
        <Handle type="source" position={Position.Bottom} className="flow-handle" />
    </div>
);

export const SplitNode = ({ data, selected }) => (
    <div className="node-wrapper">
        <Handle type="target" position={Position.Top} className="flow-handle" />
        <NodeCard selected={selected} icon={Percent} color="#818cf8" title="Split" label={data.label} />

        <div className="branch-label yes">A</div>
        <Handle type="source" position={Position.Bottom} id="a" className="flow-handle handle-a" style={{ left: '30%' }} />

        <div className="branch-label no">B</div>
        <Handle type="source" position={Position.Bottom} id="b" className="flow-handle handle-b" style={{ left: '70%' }} />
    </div>
);

export const EndNode = ({ data, selected }) => (
    <div className="node-wrapper end-node-wrapper">
        <Handle type="target" position={Position.Top} className="flow-handle" />
        <div className={`end-node-pill ${selected ? 'selected' : ''}`}>
            End Automation
        </div>
    </div>
);

