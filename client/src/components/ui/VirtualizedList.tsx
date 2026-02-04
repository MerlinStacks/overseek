import { useRef, useEffect, useState, useCallback, ReactNode } from 'react';

interface VirtualizedListProps<T> {
    /** Array of items to render */
    items: T[];
    /** Height of each item in pixels */
    itemHeight: number;
    /** Render function for each item */
    renderItem: (item: T, index: number) => ReactNode;
    /** Optional CSS class for the container */
    className?: string;
    /** Number of extra items to render above/below viewport (default: 5) */
    overscan?: number;
    /** Optional callback when scrolling near bottom (for infinite scroll) */
    onEndReached?: () => void;
    /** Threshold for onEndReached trigger (in items from bottom, default: 5) */
    endReachedThreshold?: number;
    /** Optional header above the list */
    header?: ReactNode;
    /** Optional empty state when no items */
    emptyState?: ReactNode;
    /** Optional loading state */
    loading?: boolean;
    /** Loading component */
    loadingComponent?: ReactNode;
}

/**
 * Virtualized list component for rendering large datasets efficiently.
 * Only renders items visible in the viewport plus an overscan buffer.
 * 
 * Performance benefit: Reduces DOM nodes from thousands to ~20-30, 
 * dramatically improving scroll performance and memory usage.
 * 
 * @example
 * ```tsx
 * <VirtualizedList
 *   items={customers}
 *   itemHeight={72}
 *   renderItem={(customer, index) => (
 *     <CustomerRow key={customer.id} customer={customer} />
 *   )}
 *   onEndReached={() => loadMore()}
 * />
 * ```
 */
export function VirtualizedList<T>({
    items,
    itemHeight,
    renderItem,
    className = '',
    overscan = 5,
    onEndReached,
    endReachedThreshold = 5,
    header,
    emptyState,
    loading,
    loadingComponent,
}: VirtualizedListProps<T>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);
    const hasTriggeredEndRef = useRef(false);

    // Calculate visible range
    const totalHeight = items.length * itemHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
        items.length,
        Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    const visibleItems = items.slice(startIndex, endIndex);
    const offsetY = startIndex * itemHeight;

    // Track scroll position
    const handleScroll = useCallback((e: Event) => {
        const target = e.target as HTMLDivElement;
        setScrollTop(target.scrollTop);

        // Check if near bottom for infinite scroll
        if (onEndReached && !hasTriggeredEndRef.current) {
            const itemsFromBottom = items.length - Math.ceil((target.scrollTop + target.clientHeight) / itemHeight);
            if (itemsFromBottom <= endReachedThreshold) {
                hasTriggeredEndRef.current = true;
                onEndReached();
            }
        }
    }, [items.length, itemHeight, onEndReached, endReachedThreshold]);

    // Reset end-reached trigger when items change
    useEffect(() => {
        hasTriggeredEndRef.current = false;
    }, [items.length]);

    // Set up container dimensions
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateHeight = () => {
            setContainerHeight(container.clientHeight);
        };

        updateHeight();
        container.addEventListener('scroll', handleScroll, { passive: true });

        const resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(container);

        return () => {
            container.removeEventListener('scroll', handleScroll);
            resizeObserver.disconnect();
        };
    }, [handleScroll]);

    if (loading && loadingComponent) {
        return <>{loadingComponent}</>;
    }

    if (items.length === 0 && emptyState) {
        return <>{emptyState}</>;
    }

    return (
        <div
            ref={containerRef}
            className={`overflow-auto ${className}`}
            style={{ position: 'relative' }}
        >
            {header}
            <div
                style={{
                    height: totalHeight,
                    position: 'relative',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        top: offsetY,
                        left: 0,
                        right: 0,
                    }}
                >
                    {visibleItems.map((item, relativeIndex) => {
                        const absoluteIndex = startIndex + relativeIndex;
                        return (
                            <div
                                key={absoluteIndex}
                                style={{ height: itemHeight }}
                            >
                                {renderItem(item, absoluteIndex)}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
