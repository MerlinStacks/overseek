/**
 * FlowBuilder - Visual automation flow builder using ReactFlow.
 * Popup-driven canvas experience with modal selectors for triggers, steps, and actions.
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
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Custom edge styles for solid connected lines
const defaultEdgeOptions = {
    type: 'smoothstep',
    animated: false,
    style: { stroke: '#3b82f6', strokeWidth: 2 },
    markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#3b82f6',
        width: 20,
        height: 20,
    },
};
import { TriggerNode, ActionNode, DelayNode, ConditionNode } from './FlowNodes';
import { NodeConfigPanel } from './NodeConfigPanel';
import {
    StartingPointCard,
    EventSelectorModal,
    StepTypePopup,
    ActionSelectorModal,
    RecipeSelectorModal,
    StepType,
    AutomationRecipe,
} from './flow';

// Define Node Types - Cast needed for React 19 compatibility with @xyflow/react types
const nodeTypes = {
    trigger: TriggerNode,
    action: ActionNode,
    delay: DelayNode,
    condition: ConditionNode,
} as NodeTypes;

let id = 0;
const getId = () => `node_${Date.now()}_${id++}`;

interface ControlsProps {
    onSave: (nodes: Node[], edges: Edge[]) => void;
    onCancel: () => void;
}

const FlowControls: React.FC<ControlsProps> = ({ onSave, onCancel }) => {
    const { getNodes, getEdges } = useReactFlow();

    return (
        <div className="flex gap-2 bg-white p-2 rounded-sm shadow-xs border">
            <button
                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-sm hover:bg-gray-200"
                onClick={onCancel}
            >
                Cancel
            </button>
            <button
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-sm hover:bg-blue-700"
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
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const { getViewport } = useReactFlow();

    // Modal states
    const [showEventSelector, setShowEventSelector] = useState(false);
    const [showStepPopup, setShowStepPopup] = useState(false);
    const [showActionSelector, setShowActionSelector] = useState(false);
    const [showRecipeSelector, setShowRecipeSelector] = useState(false);
    const [stepPopupPosition, setStepPopupPosition] = useState({ x: 0, y: 0 });
    const [pendingNodeParent, setPendingNodeParent] = useState<string | null>(null);


    // Stable callback refs for node operations (to avoid circular deps in node data)
    const copyNodeRef = useRef<(nodeId: string) => void>(() => { });
    const deleteNodeRef = useRef<(nodeId: string) => void>(() => { });

    // Load initial flow - start with empty canvas if no existing flow
    useEffect(() => {
        if (initialFlow && initialFlow.nodes && initialFlow.nodes.length > 0) {
            setNodes(initialFlow.nodes);
            setEdges(initialFlow.edges || []);
        } else {
            // Empty canvas - show starting point card
            setNodes([]);
            setEdges([]);
        }
    }, [initialFlow, setNodes, setEdges]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
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

    // --- Node Copy/Move Operations ---
    const [clipboard, setClipboard] = useState<Node | null>(null);

    const handleCopyNode = useCallback((nodeId: string) => {
        const nodeToCopy = nodes.find(n => n.id === nodeId);
        if (nodeToCopy) {
            // Deep clone the node with a new ID
            setClipboard({
                ...nodeToCopy,
                id: getId(),
                data: { ...nodeToCopy.data }
            });
        }
    }, [nodes]);

    const handleDeleteNode = useCallback((nodeId: string) => {
        if (confirm('Delete this node?')) {
            deleteNode(nodeId);
        }
    }, [deleteNode]);

    // Keep refs in sync with callbacks
    useEffect(() => {
        copyNodeRef.current = handleCopyNode;
        deleteNodeRef.current = handleDeleteNode;
    }, [handleCopyNode, handleDeleteNode]);

    // Wrapper functions that use refs (stable references for node data)
    const onNodeCopy = useCallback((nodeId: string) => copyNodeRef.current(nodeId), []);
    const onNodeDelete = useCallback((nodeId: string) => deleteNodeRef.current(nodeId), []);

    // --- Event (Trigger) Selection ---
    const handleEventSelect = useCallback((event: { triggerType: string; label: string }) => {
        const viewport = getViewport();
        const newNode: Node = {
            id: getId(),
            type: 'trigger',
            position: { x: 250, y: 100 },
            data: {
                label: event.label,
                config: { triggerType: event.triggerType },
                onAddStep: handleOpenStepPopup,
                onCopy: onNodeCopy,
                onDelete: onNodeDelete,
            },
        };
        setNodes([newNode]);
        setEdges([]);
    }, [setNodes, setEdges, getViewport]);

    // --- Step Type Selection (+ button) ---
    const handleOpenStepPopup = useCallback((nodeId: string, buttonPosition: { x: number; y: number }) => {
        setPendingNodeParent(nodeId);
        setStepPopupPosition(buttonPosition);
        setShowStepPopup(true);
    }, []);

    // --- Recipe Selection ---
    const handleRecipeSelect = useCallback((recipe: AutomationRecipe) => {
        // Generate positions for nodes
        const nodesWithPositions = recipe.nodes.map((node, index) => ({
            ...node,
            id: `recipe_${node.id}_${getId()}`,
            position: { x: 250, y: 100 + index * 180 },
            data: {
                ...node.data,
                onAddStep: handleOpenStepPopup,
                onCopy: onNodeCopy,
                onDelete: onNodeDelete,
            },
        }));

        // Update edge references to new node IDs
        const edgesWithIds = recipe.edges.map((edge, index) => {
            const sourceNode = nodesWithPositions.find(n => n.id.includes(`_${edge.source}_`));
            const targetNode = nodesWithPositions.find(n => n.id.includes(`_${edge.target}_`));
            return {
                ...edge,
                id: `recipe_edge_${index}_${getId()}`,
                source: sourceNode?.id || edge.source,
                target: targetNode?.id || edge.target,
            };
        });

        setNodes(nodesWithPositions);
        setEdges(edgesWithIds);
    }, [setNodes, setEdges, handleOpenStepPopup, onNodeCopy, onNodeDelete]);

    const handleStepSelect = useCallback((stepType: StepType) => {
        if (!pendingNodeParent) return;

        // Find parent node to position new node below it
        const parentNode = nodes.find(n => n.id === pendingNodeParent);
        if (!parentNode) return;

        const newPosition = {
            x: parentNode.position.x,
            y: parentNode.position.y + 200,
        };

        if (stepType === 'action') {
            // Open action selector for action type
            setShowActionSelector(true);
        } else if (stepType === 'delay') {
            // Add delay node directly
            const newNode: Node = {
                id: getId(),
                type: 'delay',
                position: newPosition,
                data: {
                    label: 'Delay',
                    config: { duration: 1, unit: 'hours' },
                    onAddStep: handleOpenStepPopup,
                    onCopy: onNodeCopy,
                    onDelete: onNodeDelete,
                },
            };
            addNodeAndConnect(newNode, pendingNodeParent);
        } else if (stepType === 'condition') {
            // Add condition node
            const newNode: Node = {
                id: getId(),
                type: 'condition',
                position: newPosition,
                data: {
                    label: 'Condition',
                    config: {},
                    onAddStep: handleOpenStepPopup,
                    onCopy: onNodeCopy,
                    onDelete: onNodeDelete,
                },
            };
            addNodeAndConnect(newNode, pendingNodeParent);
        } else if (stepType === 'goal') {
            // Goal node - track when contact reaches a goal
            const newNode: Node = {
                id: getId(),
                type: 'action',
                position: newPosition,
                data: {
                    label: 'Goal',
                    config: { actionType: 'GOAL', goalName: 'Conversion' },
                    onAddStep: handleOpenStepPopup,
                    onCopy: onNodeCopy,
                    onDelete: onNodeDelete,
                },
            };
            addNodeAndConnect(newNode, pendingNodeParent);
        } else if (stepType === 'jump') {
            // Jump to another step
            const newNode: Node = {
                id: getId(),
                type: 'action',
                position: newPosition,
                data: {
                    label: 'Jump',
                    config: { actionType: 'JUMP', targetNodeId: '' },
                    onAddStep: handleOpenStepPopup,
                    onCopy: onNodeCopy,
                    onDelete: onNodeDelete,
                },
            };
            addNodeAndConnect(newNode, pendingNodeParent);
        } else if (stepType === 'exit') {
            // Exit automation
            const newNode: Node = {
                id: getId(),
                type: 'action',
                position: newPosition,
                data: {
                    label: 'Exit',
                    config: { actionType: 'EXIT' },
                    onCopy: onNodeCopy,
                    onDelete: onNodeDelete,
                },
            };
            addNodeAndConnect(newNode, pendingNodeParent);
        }
    }, [pendingNodeParent, nodes]);

    // --- Action Selection ---
    const handleActionSelect = useCallback((action: { actionType: string; label: string }) => {
        if (!pendingNodeParent) return;

        const parentNode = nodes.find(n => n.id === pendingNodeParent);
        if (!parentNode) return;

        const newNode: Node = {
            id: getId(),
            type: 'action',
            position: {
                x: parentNode.position.x,
                y: parentNode.position.y + 200,
            },
            data: {
                label: action.label,
                config: { actionType: action.actionType },
                onAddStep: handleOpenStepPopup,
                onCopy: onNodeCopy,
                onDelete: onNodeDelete,
            },
        };
        addNodeAndConnect(newNode, pendingNodeParent);
        setShowActionSelector(false);
    }, [pendingNodeParent, nodes]);

    // Helper to add a node and connect it to parent
    const addNodeAndConnect = useCallback((newNode: Node, parentId: string) => {
        setNodes((nds) => [...nds, newNode]);
        setEdges((eds) => [
            ...eds,
            {
                id: `e_${parentId}_${newNode.id}`,
                source: parentId,
                target: newNode.id,
                ...defaultEdgeOptions,
            },
        ]);
        setPendingNodeParent(null);
    }, [setNodes, setEdges]);

    // Check if canvas is empty
    const isEmptyCanvas = nodes.length === 0;

    return (
        <div className="h-full w-full relative">
            {/* Canvas */}
            <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    nodeTypes={nodeTypes}
                    fitView
                    defaultEdgeOptions={defaultEdgeOptions}
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
                </ReactFlow>

                {/* Starting Point Card (empty canvas) */}
                {isEmptyCanvas && (
                    <StartingPointCard
                        onClick={() => setShowEventSelector(true)}
                        onRecipeClick={() => setShowRecipeSelector(true)}
                    />
                )}
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

            {/* Event Selector Modal */}
            <EventSelectorModal
                isOpen={showEventSelector}
                onClose={() => setShowEventSelector(false)}
                onSelect={handleEventSelect}
            />

            {/* Step Type Popup */}
            <StepTypePopup
                isOpen={showStepPopup}
                position={stepPopupPosition}
                onClose={() => {
                    setShowStepPopup(false);
                    setPendingNodeParent(null);
                }}
                onSelect={handleStepSelect}
            />

            {/* Action Selector Modal */}
            <ActionSelectorModal
                isOpen={showActionSelector}
                onClose={() => {
                    setShowActionSelector(false);
                    setPendingNodeParent(null);
                }}
                onSelect={handleActionSelect}
            />

            {/* Recipe Selector Modal */}
            <RecipeSelectorModal
                isOpen={showRecipeSelector}
                onClose={() => setShowRecipeSelector(false)}
                onSelect={handleRecipeSelect}
            />
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
