/**
 * FlowBuilder - Visual automation flow builder using ReactFlow.
 * Popup-driven canvas experience with modal selectors for triggers, steps, and actions.
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
    MiniMap,
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

const INVALID_NODE_CLASS = 'overseek-node-invalid';
const FLOW_DENSITY_KEY = 'overseek-flow-density';

let id = 0;
const getId = () => `node_${Date.now()}_${id++}`;

interface ControlsProps {
    onSave: (nodes: Node[], edges: Edge[]) => void;
    onCancel: () => void;
    isSaveDisabled?: boolean;
}

const FlowControls: React.FC<ControlsProps> = ({ onSave, onCancel, isSaveDisabled = false }) => {
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
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onSave(getNodes(), getEdges())}
                disabled={isSaveDisabled}
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
    isSaveDisabled?: boolean;
    onFlowChange?: (flow: { nodes: Node[], edges: Edge[] }) => void;
    onUndoRedoStateChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
    onUndoRedoHandlersChange?: (handlers: { undo: () => void; redo: () => void }) => void;
    invalidNodeIds?: string[];
    flowId?: string;
}

const FlowBuilderContent: React.FC<Props> = ({ initialFlow, onSave, onCancel, isSaveDisabled = false, onFlowChange, onUndoRedoStateChange, onUndoRedoHandlersChange, invalidNodeIds = [], flowId }) => {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);

    // Modal states
    const [showEventSelector, setShowEventSelector] = useState(false);
    const [showStepPopup, setShowStepPopup] = useState(false);
    const [showActionSelector, setShowActionSelector] = useState(false);
    const [showRecipeSelector, setShowRecipeSelector] = useState(false);
    const [stepPopupPosition, setStepPopupPosition] = useState({ x: 0, y: 0 });
    const [pendingNodeParent, setPendingNodeParent] = useState<string | null>(null);
    const [pendingActionParent, setPendingActionParent] = useState<string | null>(null);
    const pendingActionParentRef = useRef<string | null>(null);
    const [selectionCount, setSelectionCount] = useState(0);
    const [flowDensity, setFlowDensity] = useState<'compact' | 'comfortable'>(() => {
        if (typeof window === 'undefined') return 'comfortable';
        const saved = window.localStorage.getItem(FLOW_DENSITY_KEY);
        return saved === 'compact' ? 'compact' : 'comfortable';
    });
    const { setViewport, getViewport } = useReactFlow();


    // Stable callback refs for node operations (to avoid circular deps in node data)
    const copyNodeRef = useRef<(nodeId: string) => void>(() => { });
    const deleteNodeRef = useRef<(nodeId: string) => void>(() => { });
    const historyRef = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
    const historyIndexRef = useRef(-1);
    const suppressHistoryRef = useRef(false);

    const pushHistorySnapshot = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
        if (suppressHistoryRef.current) return;

        const snapshot = {
            nodes: JSON.parse(JSON.stringify(nextNodes)) as Node[],
            edges: JSON.parse(JSON.stringify(nextEdges)) as Edge[],
        };

        const current = historyRef.current[historyIndexRef.current];
        if (current) {
            const sameNodes = JSON.stringify(current.nodes) === JSON.stringify(snapshot.nodes);
            const sameEdges = JSON.stringify(current.edges) === JSON.stringify(snapshot.edges);
            if (sameNodes && sameEdges) return;
        }

        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current.push(snapshot);
        if (historyRef.current.length > 80) {
            historyRef.current.shift();
        }
        historyIndexRef.current = historyRef.current.length - 1;

        onUndoRedoStateChange?.({
            canUndo: historyIndexRef.current > 0,
            canRedo: historyIndexRef.current < historyRef.current.length - 1,
        });
    }, [onUndoRedoStateChange]);

    const applyHistorySnapshot = useCallback((index: number) => {
        const snap = historyRef.current[index];
        if (!snap) return;

        suppressHistoryRef.current = true;
        setNodes(snap.nodes);
        setEdges(snap.edges);
        setSelectedNode(null);
        setTimeout(() => {
            suppressHistoryRef.current = false;
        }, 0);
        historyIndexRef.current = index;
        onUndoRedoStateChange?.({
            canUndo: historyIndexRef.current > 0,
            canRedo: historyIndexRef.current < historyRef.current.length - 1,
        });
    }, [setEdges, setNodes, onUndoRedoStateChange]);

    const undo = useCallback(() => {
        if (historyIndexRef.current <= 0) return;
        applyHistorySnapshot(historyIndexRef.current - 1);
    }, [applyHistorySnapshot]);

    const redo = useCallback(() => {
        if (historyIndexRef.current >= historyRef.current.length - 1) return;
        applyHistorySnapshot(historyIndexRef.current + 1);
    }, [applyHistorySnapshot]);

    useEffect(() => {
        onUndoRedoHandlersChange?.({ undo, redo });
    }, [undo, redo, onUndoRedoHandlersChange]);

    // Load initial flow - start with empty canvas if no existing flow
    useEffect(() => {
        if (initialFlow && initialFlow.nodes && initialFlow.nodes.length > 0) {
            setNodes(initialFlow.nodes);
            setEdges(initialFlow.edges || []);
            historyRef.current = [{
                nodes: JSON.parse(JSON.stringify(initialFlow.nodes)) as Node[],
                edges: JSON.parse(JSON.stringify(initialFlow.edges || [])) as Edge[],
            }];
        } else {
            // Empty canvas - show starting point card
            setNodes([]);
            setEdges([]);
            historyRef.current = [{ nodes: [], edges: [] }];
        }
        historyIndexRef.current = 0;
        onUndoRedoStateChange?.({ canUndo: false, canRedo: false });
    }, [initialFlow, onUndoRedoStateChange, setNodes, setEdges]);

    useEffect(() => {
        pushHistorySnapshot(nodes, edges);
    }, [nodes, edges, pushHistorySnapshot]);

    const onConnect = useCallback(
        (params: Connection) => {
            if (!params.source) return;
            if (!params.target) return;
            if (params.source === params.target) return;

            const sourceNode = nodes.find((node) => node.id === params.source);
            if (!sourceNode) return;
            const targetNode = nodes.find((node) => node.id === params.target);
            if (!targetNode) return;
            if (targetNode.type === 'trigger') return;

            const existingFromSource = edges.filter((edge) => edge.source === params.source);
            const isConditionSource = sourceNode.type === 'condition';

            if (isConditionSource) {
                if (params.sourceHandle !== 'true' && params.sourceHandle !== 'false') {
                    return;
                }
                const handleAlreadyUsed = existingFromSource.some((edge) => edge.sourceHandle === params.sourceHandle);
                if (handleAlreadyUsed) {
                    return;
                }
            } else if (existingFromSource.length > 0) {
                return;
            }

            const conditionBranch = params.sourceHandle === 'true' ? 'YES' : params.sourceHandle === 'false' ? 'NO' : undefined;
            if (conditionBranch && params.source && params.target) {
                setEdges((eds) => ([
                    ...eds,
                    {
                        id: `e_${params.source}_${params.target}_${Date.now()}`,
                        source: params.source,
                        target: params.target,
                        sourceHandle: params.sourceHandle,
                        targetHandle: params.targetHandle,
                        label: conditionBranch,
                        ...defaultEdgeOptions,
                    },
                ]));
                return;
            }
            setEdges((eds) => addEdge(params, eds));
        },
        [nodes, edges, setEdges],
    );

    // Handle node click to open config panel
    const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
        setSelectedNode(node);
    }, []);

    // Handle pane click to close config panel
    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    const onSelectionChange = useCallback(({ nodes: selectedNodes = [], edges: selectedEdges = [] }: { nodes?: Node[]; edges?: Edge[] }) => {
        setSelectionCount(selectedNodes.length + selectedEdges.length);
    }, []);

    // Update node data from config panel
    const updateNodeData = useCallback((nodeId: string, newData: Node['data']) => {
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
    const [_clipboard, setClipboard] = useState<Node | null>(null);

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
        deleteNode(nodeId);
    }, [deleteNode]);

    const deleteSelection = useCallback(() => {
        setNodes((nds) => nds.filter((node) => !node.selected));
        setEdges((eds) => eds.filter((edge) => !edge.selected && !nodes.some((n) => n.selected && (edge.source === n.id || edge.target === n.id))));
        setSelectedNode(null);
    }, [nodes, setEdges, setNodes]);

    const duplicateSelection = useCallback(() => {
        const selectedNodes = nodes.filter((node) => node.selected);
        if (selectedNodes.length === 0) return;

        const idMap = new Map<string, string>();
        const duplicatedNodes = selectedNodes.map((node) => {
            const nextId = getId();
            idMap.set(node.id, nextId);
            return {
                ...node,
                id: nextId,
                position: { x: node.position.x + 40, y: node.position.y + 40 },
                selected: false,
                data: {
                    ...(node.data as Record<string, unknown>),
                },
            } as Node;
        });

        const duplicatedEdges = edges
            .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
            .map((edge) => ({
                ...edge,
                id: `e_${getId()}`,
                source: idMap.get(edge.source)!,
                target: idMap.get(edge.target)!,
                selected: false,
            }));

        setNodes((nds) => [...nds, ...duplicatedNodes]);
        setEdges((eds) => [...eds, ...duplicatedEdges]);
    }, [nodes, edges, setNodes, setEdges]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const isMeta = event.ctrlKey || event.metaKey;
            const target = event.target as HTMLElement | null;
            const inInput = !!target?.closest('input, textarea, [contenteditable="true"]');
            if (inInput) return;

            if (isMeta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
                event.preventDefault();
                undo();
                return;
            }

            if (isMeta && event.key.toLowerCase() === 'z' && event.shiftKey) {
                event.preventDefault();
                redo();
                return;
            }

            if (isMeta && event.key.toLowerCase() === 'd') {
                event.preventDefault();
                duplicateSelection();
                return;
            }

            if (event.key === 'Delete' || event.key === 'Backspace') {
                if (selectionCount > 0) {
                    event.preventDefault();
                    deleteSelection();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, duplicateSelection, deleteSelection, selectionCount]);

    // Keep refs in sync with callbacks
    useEffect(() => {
        copyNodeRef.current = handleCopyNode;
        deleteNodeRef.current = handleDeleteNode;
    }, [handleCopyNode, handleDeleteNode]);

    // Wrapper functions that use refs (stable references for node data)
    const onNodeCopy = useCallback((nodeId: string) => copyNodeRef.current(nodeId), []);
    const onNodeDelete = useCallback((nodeId: string) => deleteNodeRef.current(nodeId), []);

    // --- Step Type Selection (+ button) ---
    const handleOpenStepPopup = useCallback((nodeId: string, buttonPosition: { x: number; y: number }) => {
        setPendingNodeParent(nodeId);
        setStepPopupPosition(buttonPosition);
        setShowStepPopup(true);
    }, []);

    // --- Event (Trigger) Selection ---
    const handleEventSelect = useCallback((event: { triggerType: string; label: string }) => {
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
                density: flowDensity,
            },
        };
        setNodes([newNode]);
        setEdges([]);
    }, [setNodes, setEdges, handleOpenStepPopup, onNodeCopy, onNodeDelete, flowDensity]);

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
                density: flowDensity,
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
    }, [setNodes, setEdges, handleOpenStepPopup, onNodeCopy, onNodeDelete, flowDensity]);

    const handleStepSelect = (stepType: StepType) => {
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
            setPendingActionParent(pendingNodeParent);
            pendingActionParentRef.current = pendingNodeParent;
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
                    density: flowDensity,
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
                    density: flowDensity,
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
                    density: flowDensity,
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
                    density: flowDensity,
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
                    density: flowDensity,
                },
            };
            addNodeAndConnect(newNode, pendingNodeParent);
        }
    };

    // --- Action Selection ---
    const handleActionSelect = (action: { actionType: string; label: string }) => {
        const parentId = pendingActionParentRef.current || pendingActionParent || pendingNodeParent;
        if (!parentId) return;

        const parentNode = nodes.find(n => n.id === parentId);
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
                density: flowDensity,
            },
        };
        addNodeAndConnect(newNode, parentId);
        setShowActionSelector(false);
        setPendingActionParent(null);
        pendingActionParentRef.current = null;
    };

    useEffect(() => {
        try {
            window.localStorage.setItem(FLOW_DENSITY_KEY, flowDensity);
        } catch {
            // Ignore localStorage write failures
        }
    }, [flowDensity]);

    // Helper to add a node and connect it to parent
    const addNodeAndConnect = useCallback((newNode: Node, parentId: string) => {
        const parentNode = nodes.find((node) => node.id === parentId);
        if (!parentNode) {
            setPendingNodeParent(null);
            return;
        }

        if (parentNode.type !== 'condition') {
            const existingFromParent = edges.some((edge) => edge.source === parentId);
            if (existingFromParent) {
                setPendingNodeParent(null);
                return;
            }
        }

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
    }, [nodes, edges, setNodes, setEdges]);

    // Check if canvas is empty
    const isEmptyCanvas = nodes.length === 0;

    useEffect(() => {
        if (!onFlowChange) return;
        onFlowChange({ nodes, edges });
    }, [nodes, edges, onFlowChange]);

    useEffect(() => {
        if (!flowId) return;
        const key = `overseek-flow-viewport:${flowId}`;
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return;
            const parsed = JSON.parse(raw) as { x: number; y: number; zoom: number };
            if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number' && typeof parsed?.zoom === 'number') {
                setTimeout(() => setViewport(parsed), 0);
            }
        } catch {
            // Ignore invalid viewport cache
        }
    }, [flowId, setViewport]);

    const onMoveEnd = useCallback(() => {
        if (!flowId) return;
        const key = `overseek-flow-viewport:${flowId}`;
        try {
            window.localStorage.setItem(key, JSON.stringify(getViewport()));
        } catch {
            // Ignore localStorage write failures
        }
    }, [flowId, getViewport]);

    const renderNodes = useMemo(() => {
        const invalidSet = new Set(invalidNodeIds);

        return nodes.map((node) => {
            const hasOutgoing = edges.some((edge) => edge.source === node.id);
            const canAddFromNode = node.type === 'condition' ? false : !hasOutgoing;
            const hasError = invalidSet.has(node.id);
            const existingClassNames = (node.className || '')
                .split(' ')
                .filter((className) => className && className !== INVALID_NODE_CLASS)
                .join(' ');

            const className = hasError
                ? `${existingClassNames} ${INVALID_NODE_CLASS}`.trim()
                : existingClassNames;

            return {
                ...node,
                className,
                data: {
                    ...(node.data as Record<string, unknown>),
                    onAddStep: canAddFromNode ? handleOpenStepPopup : undefined,
                    onCopy: onNodeCopy,
                    onDelete: onNodeDelete,
                    density: flowDensity,
                },
            };
        });
    }, [nodes, edges, invalidNodeIds, handleOpenStepPopup, onNodeCopy, onNodeDelete, flowDensity]);

    return (
            <div className="h-full w-full relative">
            <style>{`.${INVALID_NODE_CLASS}{outline:2px solid #f87171;outline-offset:2px;border-radius:0.75rem;}`}</style>
            {/* Canvas */}
            <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={renderNodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    onMoveEnd={onMoveEnd}
                    onSelectionChange={onSelectionChange}
                    nodeTypes={nodeTypes}
                    fitView
                    defaultEdgeOptions={defaultEdgeOptions}
                    snapToGrid
                    multiSelectionKeyCode={['Control', 'Meta']}
                    deleteKeyCode={null}
                >
                    <Controls />
                    <MiniMap pannable zoomable className="!bg-white/90 !border !border-gray-200 !rounded-lg" />
                    <Background color="#e2e8f0" gap={16} />
                    <Panel position="top-right">
                        <FlowControls
                            onSave={(n, e) => onSave({ nodes: n, edges: e })}
                            onCancel={onCancel}
                            isSaveDisabled={isSaveDisabled}
                        />
                    </Panel>
                    <Panel position="top-left">
                        <div className="flex items-center gap-1.5 bg-white/95 backdrop-blur-sm p-1 rounded-lg shadow-xs border border-slate-200">
                            <button
                                type="button"
                                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${flowDensity === 'comfortable' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                onClick={() => setFlowDensity('comfortable')}
                            >
                                Comfortable
                            </button>
                            <button
                                type="button"
                                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${flowDensity === 'compact' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                onClick={() => setFlowDensity('compact')}
                            >
                                Compact
                            </button>
                        </div>
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
                    setPendingActionParent(null);
                    pendingActionParentRef.current = null;
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
