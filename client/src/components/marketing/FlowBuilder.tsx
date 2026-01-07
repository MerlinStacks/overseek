/**
 * FlowBuilder - Visual automation flow builder using ReactFlow.
 * n8n/FunnelKit-style canvas with draggable triggers, actions, delays, and conditions.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { NodeConfigPanel } from './NodeConfigPanel';
import { ChevronDown, ChevronRight } from 'lucide-react';

// Define Node Types
const nodeTypes: NodeTypes = {
    trigger: TriggerNode,
    action: ActionNode,
    delay: DelayNode,
    condition: ConditionNode,
};

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

// Toolbox item component
interface ToolboxItemProps {
    label: string;
    nodeType: string;
    config?: any;
    colorClass: string;
    icon: string;
}

const ToolboxItem: React.FC<ToolboxItemProps> = ({ label, nodeType, config, colorClass, icon }) => (
    <div
        className={`p-2.5 bg-white border ${colorClass} rounded cursor-grab shadow-sm flex items-center gap-2 hover:shadow-md transition-shadow text-sm`}
        onDragStart={(event) => {
            event.dataTransfer.setData('application/reactflow', nodeType);
            event.dataTransfer.setData('application/label', label);
            event.dataTransfer.setData('application/config', JSON.stringify(config || {}));
            event.dataTransfer.effectAllowed = 'move';
        }}
        draggable
    >
        <span>{icon}</span>
        <span className="font-medium text-gray-700">{label}</span>
    </div>
);

// Collapsible section component
interface ToolboxSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

const ToolboxSection: React.FC<ToolboxSectionProps> = ({ title, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="mb-3">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-1 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 hover:text-gray-700"
            >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {title}
            </button>
            {isOpen && <div className="space-y-2">{children}</div>}
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
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const { screenToFlowPosition } = useReactFlow();

    // Load initial flow - start with empty canvas if no existing flow
    useEffect(() => {
        if (initialFlow && initialFlow.nodes && initialFlow.nodes.length > 0) {
            setNodes(initialFlow.nodes);
            setEdges(initialFlow.edges || []);
        } else {
            // Empty canvas - user drags trigger first
            setNodes([]);
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

    // Handle node click to open config panel
    const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
        setSelectedNode(node);
    }, []);

    // Handle pane click to close config panel
    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    // Update node data from config panel
    const updateNodeData = useCallback((nodeId: string, newData: any) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === nodeId) {
                    return { ...node, data: newData };
                }
                return node;
            })
        );
        // Update selected node reference
        setSelectedNode((prev) => prev?.id === nodeId ? { ...prev, data: newData } : prev);
    }, [setNodes]);

    // Delete node from config panel
    const deleteNode = useCallback((nodeId: string) => {
        setNodes((nds) => nds.filter((node) => node.id !== nodeId));
        setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
        setSelectedNode(null);
    }, [setNodes, setEdges]);

    return (
        <div className="flex h-full w-full">
            {/* Sidebar Toolbox */}
            <aside className="w-56 bg-gray-50 border-r p-3 flex flex-col overflow-y-auto z-10">
                <div className="font-bold text-sm border-b pb-2 mb-3 text-gray-800">Toolbox</div>
                <p className="text-xs text-gray-500 mb-4">Drag nodes to the canvas to build your flow</p>

                <ToolboxSection title="Triggers" defaultOpen={true}>
                    <ToolboxItem
                        label="Order Created"
                        nodeType="trigger"
                        config={{ triggerType: 'ORDER_CREATED' }}
                        colorClass="border-blue-300 hover:border-blue-400"
                        icon="🛒"
                    />
                    <ToolboxItem
                        label="Order Completed"
                        nodeType="trigger"
                        config={{ triggerType: 'ORDER_COMPLETED' }}
                        colorClass="border-blue-300 hover:border-blue-400"
                        icon="✅"
                    />
                    <ToolboxItem
                        label="Abandoned Cart"
                        nodeType="trigger"
                        config={{ triggerType: 'ABANDONED_CART' }}
                        colorClass="border-blue-300 hover:border-blue-400"
                        icon="🛒"
                    />
                    <ToolboxItem
                        label="Review Left"
                        nodeType="trigger"
                        config={{ triggerType: 'REVIEW_LEFT' }}
                        colorClass="border-blue-300 hover:border-blue-400"
                        icon="⭐"
                    />
                    <ToolboxItem
                        label="Manual Entry"
                        nodeType="trigger"
                        config={{ triggerType: 'MANUAL' }}
                        colorClass="border-blue-300 hover:border-blue-400"
                        icon="👤"
                    />
                </ToolboxSection>

                <ToolboxSection title="Actions" defaultOpen={true}>
                    <ToolboxItem
                        label="Send Email"
                        nodeType="action"
                        config={{ actionType: 'SEND_EMAIL' }}
                        colorClass="border-green-300 hover:border-green-400"
                        icon="✉️"
                    />
                    <ToolboxItem
                        label="Send SMS"
                        nodeType="action"
                        config={{ actionType: 'SEND_SMS' }}
                        colorClass="border-green-300 hover:border-green-400"
                        icon="📱"
                    />
                    <ToolboxItem
                        label="Add Tag"
                        nodeType="action"
                        config={{ actionType: 'ADD_TAG' }}
                        colorClass="border-green-300 hover:border-green-400"
                        icon="🏷️"
                    />
                    <ToolboxItem
                        label="Webhook"
                        nodeType="action"
                        config={{ actionType: 'WEBHOOK' }}
                        colorClass="border-green-300 hover:border-green-400"
                        icon="🔗"
                    />
                </ToolboxSection>

                <ToolboxSection title="Timing" defaultOpen={true}>
                    <ToolboxItem
                        label="Wait 1 Hour"
                        nodeType="delay"
                        config={{ duration: 1, unit: 'hours' }}
                        colorClass="border-yellow-300 hover:border-yellow-400"
                        icon="⏱️"
                    />
                    <ToolboxItem
                        label="Wait 1 Day"
                        nodeType="delay"
                        config={{ duration: 1, unit: 'days' }}
                        colorClass="border-yellow-300 hover:border-yellow-400"
                        icon="📅"
                    />
                    <ToolboxItem
                        label="Wait 3 Days"
                        nodeType="delay"
                        config={{ duration: 3, unit: 'days' }}
                        colorClass="border-yellow-300 hover:border-yellow-400"
                        icon="📅"
                    />
                </ToolboxSection>

                <ToolboxSection title="Logic" defaultOpen={false}>
                    <ToolboxItem
                        label="Condition"
                        nodeType="condition"
                        config={{}}
                        colorClass="border-orange-300 hover:border-orange-400"
                        icon="❓"
                    />
                </ToolboxSection>
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
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    nodeTypes={nodeTypes}
                    fitView
                    defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
                    snapToGrid
                >
                    <Controls />
                    <Background color="#e2e8f0" gap={16} />
                    <Panel position="top-right">
                        <FlowControls
                            onSave={(n, e) => onSave({ nodes: n, edges: e })}
                            onCancel={onCancel}
                        />
                    </Panel>

                    {/* Empty state hint */}
                    {nodes.length === 0 && (
                        <Panel position="top-center">
                            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded-lg text-sm mt-4 shadow-sm">
                                👈 Drag a <strong>Trigger</strong> from the toolbox to start building your flow
                            </div>
                        </Panel>
                    )}
                </ReactFlow>
            </div>

            {/* Node Configuration Panel */}
            {selectedNode && (
                <NodeConfigPanel
                    node={selectedNode}
                    onClose={() => setSelectedNode(null)}
                    onUpdate={updateNodeData}
                    onDelete={deleteNode}
                />
            )}
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
