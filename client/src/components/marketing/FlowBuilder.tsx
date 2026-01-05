
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    useNodesState,
    useEdgesState,
    Controls,
    Background,
    Connection,
    Edge,
    Node,
    Panel,
    useReactFlow,
    NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TriggerNode, ActionNode, DelayNode, ConditionNode } from './FlowNodes';

// Define Node Types
const nodeTypes: NodeTypes = {
    trigger: TriggerNode,
    action: ActionNode,
    delay: DelayNode,
    condition: ConditionNode,
};

const initialDefaultNodes: Node[] = [
    {
        id: 'trigger-1',
        type: 'trigger',
        data: { label: 'Order Created', type: 'TRIGGER' },
        position: { x: 250, y: 50 },
    },
];

let id = 0;
const getId = () => `node_${Date.now()}_${id++}`;

interface ControlsProps {
    onSave: (nodes: Node[], edges: Edge[]) => void;
    onCancel: () => void;
}

const FlowControls: React.FC<ControlsProps> = ({ onSave, onCancel }) => {
    const { getNodes, getEdges } = useReactFlow();

    return (
        <div className="flex gap-2 bg-white p-2 rounded shadow-sm border">
            <button
                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
                onClick={onCancel}
            >
                Cancel
            </button>
            <button
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                onClick={() => onSave(getNodes(), getEdges())}
            >
                Save Flow
            </button>
        </div>
    );
};

interface Props {
    initialFlow?: { nodes: Node[], edges: Edge[] } | null;
    onSave: (flow: { nodes: Node[], edges: Edge[] }) => void;
    onCancel: () => void;
}

const FlowBuilderContent: React.FC<Props> = ({ initialFlow, onSave, onCancel }) => {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const { screenToFlowPosition, setViewport } = useReactFlow();

    // Load initial flow
    useEffect(() => {
        if (initialFlow && initialFlow.nodes && initialFlow.nodes.length > 0) {
            setNodes(initialFlow.nodes);
            setEdges(initialFlow.edges || []);
        } else {
            setNodes(initialDefaultNodes);
            setEdges([]);
        }
    }, [initialFlow, setNodes, setEdges]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
    );

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/reactflow');
            const label = event.dataTransfer.getData('application/label');
            const configJson = event.dataTransfer.getData('application/config');

            if (typeof type === 'undefined' || !type) {
                return;
            }

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            const newNode: Node = {
                id: getId(),
                type,
                position,
                data: {
                    label: label || `${type} node`,
                    config: configJson ? JSON.parse(configJson) : {},
                },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [screenToFlowPosition, setNodes],
    );

    return (
        <div className="flex h-full w-full">
            {/* Sidebar */}
            <aside className="w-64 bg-gray-50 border-r p-4 flex flex-col gap-4 z-10">
                <div className="font-bold border-b pb-2 mb-2 text-gray-700">Toolbox</div>
                <p className="text-xs text-gray-500 mb-2">Drag components to the canvas</p>

                <div
                    className="p-3 bg-white border border-green-200 rounded cursor-grab shadow-sm flex items-center gap-2 hover:border-green-400"
                    onDragStart={(event) => {
                        event.dataTransfer.setData('application/reactflow', 'action');
                        event.dataTransfer.setData('application/label', 'Send Email');
                        event.dataTransfer.setData('application/config', JSON.stringify({ actionType: 'SEND_EMAIL' }));
                        event.dataTransfer.effectAllowed = 'move';
                    }}
                    draggable
                >
                    ✉️ Send Email
                </div>

                <div
                    className="p-3 bg-white border border-yellow-200 rounded cursor-grab shadow-sm flex items-center gap-2 hover:border-yellow-400"
                    onDragStart={(event) => {
                        event.dataTransfer.setData('application/reactflow', 'delay');
                        event.dataTransfer.setData('application/label', 'Wait 1 Hour');
                        event.dataTransfer.setData('application/config', JSON.stringify({ duration: 1, unit: 'hours' }));
                        event.dataTransfer.effectAllowed = 'move';
                    }}
                    draggable
                >
                    ⏱️ Wait 1 Hour
                </div>

                <div
                    className="p-3 bg-white border border-orange-200 rounded cursor-grab shadow-sm flex items-center gap-2 hover:border-orange-400"
                    onDragStart={(event) => {
                        event.dataTransfer.setData('application/reactflow', 'condition');
                        event.dataTransfer.setData('application/label', 'Check Condition');
                        event.dataTransfer.effectAllowed = 'move';
                    }}
                    draggable
                >
                    ❓ Condition
                </div>
            </aside>

            {/* Canvas */}
            <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    nodeTypes={nodeTypes}
                    fitView
                    defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
                    snapToGrid
                >
                    <Controls />
                    <Background color="#f1f5f9" gap={16} />
                    <Panel position="top-right">
                        <FlowControls
                            onSave={(n, e) => onSave({ nodes: n, edges: e })}
                            onCancel={onCancel}
                        />
                    </Panel>
                </ReactFlow>
            </div>
        </div>
    );
};

export const FlowBuilder: React.FC<Props> = (props) => {
    return (
        <ReactFlowProvider>
            <FlowBuilderContent {...props} />
        </ReactFlowProvider>
    );
};
