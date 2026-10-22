import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from '@xyflow/react';

type FlowEdgeData = {
    onInsertNode?: (edgeId: string, position: { x: number; y: number }) => void;
};

export const FlowEdge = memo((props: EdgeProps) => {
    const {
        id,
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        style,
        markerEnd,
        label,
        data,
        selected,
    } = props;

    const [isHovered, setIsHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const edgeData = data as FlowEdgeData | undefined;
    const canInsert = typeof edgeData?.onInsertNode === 'function';
    const isInsertVisible = isHovered || selected || focused;
    const selectedEdgeStyle = selected
        ? {
            ...(style || {}),
            stroke: '#2563eb',
            strokeWidth: 3,
            filter: 'drop-shadow(0 0 6px rgba(37, 99, 235, 0.45))',
        }
        : style;

    return (
        <>
            <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={selectedEdgeStyle} />

            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            />

            {label ? (
                <EdgeLabelRenderer>
                    <div
                        className="pointer-events-none absolute rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200"
                        style={{
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)`,
                        }}
                    >
                        {String(label)}
                    </div>
                </EdgeLabelRenderer>
            ) : null}

            {canInsert ? (
                <EdgeLabelRenderer>
                    <button
                        type="button"
                        className={`nodrag nopan absolute h-8 w-8 rounded-full border border-blue-200 bg-white dark:bg-slate-900 text-sm font-bold text-blue-600 shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500 transition-all ${isInsertVisible ? 'opacity-100 scale-100' : 'opacity-60 scale-95'}`}
                        style={{
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                        }}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            edgeData?.onInsertNode?.(id, { x: rect.left + rect.width / 2, y: rect.bottom });
                        }}
                        aria-label="Insert node between steps"
                    >
                        +
                    </button>
                </EdgeLabelRenderer>
            ) : null}
        </>
    );
});

FlowEdge.displayName = 'FlowEdge';
