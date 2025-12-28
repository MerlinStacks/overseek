import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
    addEdge,
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    MarkerType,
    useReactFlow,
    ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { toast, Toaster } from 'sonner';
import {
    Save, ArrowLeft, LayoutGrid, Mail, Upload, Zap, Clock, GitBranch, Percent, XCircle, X
} from 'lucide-react';
import dagre from 'dagre';

// Components
import {
    TriggerNode, ActionNode, ConditionNode, WaitNode, SplitNode, EndNode
} from '../components/FlowNodes';
import { CustomAddEdge } from '../components/FlowEdges';
import StepSelectionModal from '../components/StepSelectionModal';
import EmailDesigner from '../components/EmailDesigner/EmailDesigner';

import './EmailFlowBuilder.css';

// --- Layout Helper ---
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
    const isHorizontal = direction === 'LR';
    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: 280, height: 100 });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.targetPosition = isHorizontal ? 'left' : 'top';
        node.sourcePosition = isHorizontal ? 'right' : 'bottom';

        // Shift slightly to center
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - 140,
                y: nodeWithPosition.y - 50,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};

// --- Node Types Definition ---
const nodeTypes = {
    trigger: TriggerNode,
    action: ActionNode,
    condition: ConditionNode,
    wait: WaitNode,
    split: SplitNode,
    end: EndNode
};

const defaultEdgeOptions = {
    type: 'customAdd',
    markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#64748b',
    },
    style: {
        strokeWidth: 2,
        stroke: '#64748b',
    },
};

// --- Constants ---
const TRIGGERS = [
    { value: 'woocommerce_order_created', label: 'Order Created' },
    { value: 'woocommerce_order_status_processing', label: 'Order Status Changed: Processing' },
    { value: 'woocommerce_order_status_completed', label: 'Order Status Changed: Completed' },
    { value: 'woocommerce_order_status_refunded', label: 'Order Status Changed: Refunded' },
    { value: 'woocommerce_order_status_failed', label: 'Order Status Changed: Failed' },
    { value: 'woocommerce_order_status_on-hold', label: 'Order Status Changed: On-Hold' },
    { value: 'woocommerce_subscription_status_active', label: 'Subscription Active' },
    { value: 'woocommerce_subscription_status_cancelled', label: 'Subscription Cancelled' },
    { value: 'woocommerce_subscription_renewal_payment_failed', label: 'Subscription Renewal Failed' },
    { value: 'customer_created', label: 'Customer Registered' },
    { value: 'review_posted', label: 'Product Review Posted' }
];

// --- Main Component ---
const EmailFlowBuilderContent = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const reactFlowWrapper = useRef(null);

    // DB Query
    const existing = useLiveQuery(() => id ? db.automations.get(parseInt(id)) : null, [id]);

    // Flow State
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [selectedNode, setSelectedNode] = useState(null);
    const [isDesignerOpen, setIsDesignerOpen] = useState(false);

    // Modal State
    const [modalOpen, setModalOpen] = useState(false);
    const [addEdgeContext, setAddEdgeContext] = useState(null); // { edgeId, source, target }

    const edgeTypes = useMemo(() => ({
        customAdd: CustomAddEdge
    }), []);

    const handleEdgeAddClick = useCallback((edgeId, source, target) => {
        setAddEdgeContext({ edgeId, source, target });
        setModalOpen(true);
    }, []);

    // 1. Load Flow Data
    useEffect(() => {
        if (existing) {
            // Restore saved flow
            const savedNodes = existing.conditions && existing.conditions.nodes ? existing.conditions.nodes : (Array.isArray(existing.conditions) ? existing.conditions : []);

            if (savedNodes.length > 0) {
                setNodes(savedNodes);
                if (existing.conditions?.edges) {
                    // Restore edges, ensure they have the custom handler
                    const restoredEdges = existing.conditions.edges.map(e => ({
                        ...e,
                        type: 'customAdd', // Force type
                        data: { ...e.data, onAdd: handleEdgeAddClick }
                    }));
                    setEdges(restoredEdges);
                } else if (existing.edges) {
                    const restoredEdges = existing.edges.map(e => ({
                        ...e,
                        type: 'customAdd',
                        data: { ...e.data, onAdd: handleEdgeAddClick }
                    }));
                    setEdges(restoredEdges);
                } else {
                    // Fallback: If no edges saved, try to connect linearly if straightforward, else empty
                    // For now, let's just initialize empty if complex data missing, or try linear link
                    if (savedNodes.length > 1) {
                        const linearEdges = [];
                        for (let i = 0; i < savedNodes.length - 1; i++) {
                            linearEdges.push({
                                id: `e-${savedNodes[i].id}-${savedNodes[i + 1].id}`,
                                source: savedNodes[i].id,
                                target: savedNodes[i + 1].id,
                                type: 'customAdd',
                                data: { onAdd: handleEdgeAddClick }
                            });
                        }
                        setEdges(linearEdges);
                    } else {
                        setEdges([]);
                    }
                }
            }
        } else if (!id) {
            // New Flow Template
            const initialNodes = [
                {
                    id: 'start',
                    type: 'trigger',
                    position: { x: 250, y: 50 },
                    data: {
                        label: 'Order Created',
                        triggerValue: 'woocommerce_order_created'
                    }
                },
                { id: 'end', type: 'end', position: { x: 250, y: 350 }, data: { label: 'End Automation' } }
            ];
            const initialEdges = [
                { id: 'e1', source: 'start', target: 'end', type: 'customAdd', data: { onAdd: handleEdgeAddClick } }
            ];
            setNodes(initialNodes);
            setEdges(initialEdges);
        }
    }, [existing, id, handleEdgeAddClick, setNodes, setEdges]);


    // 2. Handlers
    const handleLayout = (direction) => {
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            nodes,
            edges,
            direction
        );
        setNodes([...layoutedNodes]);
        setEdges([...layoutedEdges]);
    };

    const saveFlow = async () => {
        const flowData = {
            name: existing?.name || 'Untitled Flow',
            active: true,
            conditions: { nodes, edges }, // Save both!
            updated_at: new Date()
        };

        if (id) {
            await db.automations.update(parseInt(id), flowData);
            toast.success('Flow updated!');
        } else {
            const newId = await db.automations.add(flowData);
            navigate(`/automations/${newId}`);
            toast.success('Flow created!');
        }
    };

    const handleNodeClick = (e, node) => {
        if (node.type === 'end') return;
        setSelectedNode(node);
    };

    const handlePaneClick = () => {
        setSelectedNode(null);
    };

    const handleTriggerChange = (e) => {
        const newVal = e.target.value;
        const triggerObj = TRIGGERS.find(t => t.value === newVal);
        const newLabel = triggerObj ? triggerObj.label : 'Unknown Trigger';

        setNodes(nds => nds.map(n =>
            n.id === selectedNode.id
                ? { ...n, data: { ...n.data, triggerValue: newVal, label: newLabel } }
                : n
        ));

        // Update local selection to reflect change immediately in Side Panel
        setSelectedNode(prev => ({
            ...prev,
            data: { ...prev.data, triggerValue: newVal, label: newLabel }
        }));
    };

    // 3. Add Step Logic (Insert between nodes)
    const handleAddStep = (stepType) => {
        if (!addEdgeContext) return;
        const { source, target } = addEdgeContext;

        const newNodeId = `node_${Date.now()}`;
        const newNode = {
            id: newNodeId,
            type: stepType.type,
            position: { x: 250, y: 0 },
            data: {
                label: stepType.label,
                subType: stepType.subType,
                actionType: stepType.label
            }
        };

        // Construct new state
        const newNodes = [...nodes, newNode];

        const filteredEdges = edges.filter(e => e.source !== source || e.target !== target);
        const newEdge1 = {
            id: `e_${source}_${newNodeId}`,
            source: source,
            target: newNodeId,
            type: 'customAdd',
            data: { onAdd: handleEdgeAddClick }
        };
        const newEdge2 = {
            id: `e_${newNodeId}_${target}`,
            source: newNodeId,
            target: target,
            type: 'customAdd',
            data: { onAdd: handleEdgeAddClick }
        };
        const newEdges = [...filteredEdges, newEdge1, newEdge2];

        // Apply Layout immediately on the new structure to avoid stale state issues and layout jumps
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            newNodes,
            newEdges,
            'TB'
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        setModalOpen(false);
        setAddEdgeContext(null);
    };

    // Sidebar Items Helper (Removed, but keeping logic if needed)

    return (
        <div className="flow-builder-container">
            <Toaster position="top-center" theme="dark" />

            {/* Header */}
            <div className="flow-header">
                <div className="flow-header-left">
                    <button onClick={() => navigate('/automations')} className="btn-icon">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flow-header-title">
                        <input defaultValue={existing?.name || 'Untitled Flow'} />
                    </div>
                </div>
                <div className="flow-header-actions">
                    <button className="btn btn-secondary" onClick={() => handleLayout('TB')}>
                        <LayoutGrid size={16} /> Auto Layout
                    </button>
                    <button className="btn btn-primary" onClick={saveFlow}>
                        <Save size={16} /> Save Flow
                    </button>
                </div>
            </div>

            <div className="flow-main">
                {/* Main Canvas */}
                <div className="flow-canvas-area" ref={reactFlowWrapper}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeClick={handleNodeClick}
                        onPaneClick={handlePaneClick}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        defaultEdgeOptions={defaultEdgeOptions}
                        fitView
                        minZoom={0.2}
                        attributionPosition="bottom-right"
                    >
                        <Background color="#334155" gap={20} />
                        <Controls />
                    </ReactFlow>
                </div>

                {/* Properties Panel (Inspector) */}
                {selectedNode && (
                    <div className="side-panel">
                        <div className="panel-header">
                            <span className="panel-title">Configuration</span>
                            <button className="panel-close" onClick={() => setSelectedNode(null)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="panel-content">

                            {/* Trigger Specific */}
                            {selectedNode.type === 'trigger' ? (
                                <div className="config-group">
                                    <label>Trigger Event</label>
                                    <select
                                        className="config-select"
                                        value={selectedNode.data.triggerValue || 'woocommerce_order_created'}
                                        onChange={handleTriggerChange}
                                    >
                                        {TRIGGERS.map(t => (
                                            <option key={t.value} value={t.value}>{t.label}</option>
                                        ))}
                                    </select>
                                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                                        This flow will start when this event occurs.
                                    </p>
                                </div>
                            ) : (
                                /* Generic Label for non-triggers */
                                <div className="config-group">
                                    <label>Label</label>
                                    <input
                                        className="config-input"
                                        value={selectedNode.data.label}
                                        onChange={(e) => {
                                            setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, label: e.target.value } } : n));
                                        }}
                                    />
                                </div>
                            )}

                            {/* Email Specific */}
                            {selectedNode.type === 'action' && selectedNode.data.subType === 'email' && (
                                <div className="config-group">
                                    <label>Email Template</label>
                                    <button className="btn btn-save-config" onClick={() => setIsDesignerOpen(true)}>
                                        Open Email Designer
                                    </button>
                                </div>
                            )}

                            {/* Wait Specific */}
                            {selectedNode.type === 'wait' && (
                                <div className="config-group">
                                    <label>Wait Duration</label>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <input type="number" className="config-input" defaultValue={1} />
                                        <select className="config-select">
                                            <option>Hours</option>
                                            <option>Days</option>
                                            <option>Minutes</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* Split Specific */}
                            {selectedNode.type === 'split' && (
                                <div className="config-group">
                                    <label>Split Percentage (Path A)</label>
                                    <input
                                        type="range"
                                        min="0" max="100"
                                        value={selectedNode.data.splitRatio || 50}
                                        onChange={(e) => {
                                            setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, splitRatio: parseInt(e.target.value) } } : n));
                                        }}
                                        style={{ width: '100%' }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8' }}>
                                        <span>A: {selectedNode.data.splitRatio || 50}%</span>
                                        <span>B: {100 - (selectedNode.data.splitRatio || 50)}%</span>
                                    </div>
                                </div>
                            )}

                            <div style={{ marginTop: 'auto' }}>
                                <button className="btn-save-config" onClick={() => setSelectedNode(null)}>
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Step Selection Modal */}
            <StepSelectionModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                onSelect={handleAddStep}
            />

            {/* Email Designer Modal */}
            {isDesignerOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'black' }}>
                    <EmailDesigner
                        initialContent={null}
                        onSave={(content) => {
                            console.log('Saved', content);
                            setIsDesignerOpen(false);
                            // Optionally update node data with content summary
                        }}
                        onClose={() => setIsDesignerOpen(false)}
                    />
                </div>
            )}
        </div>
    );
};

// Wrapper for ReactFlow Provider
export default function EmailFlowBuilder() {
    return (
        <ReactFlowProvider>
            <EmailFlowBuilderContent />
        </ReactFlowProvider>
    );
}
