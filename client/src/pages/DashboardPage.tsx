// @ts-ignore
import { Responsive as ResponsiveGridLayout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { renderWidget, WidgetRegistry } from '../components/widgets/WidgetRegistry';
import { Loader2, Plus, X, Lock, Unlock } from 'lucide-react';
import { debounce, isEqual } from '../utils/debounce';
import { useRef, useLayoutEffect, useState, useEffect, useMemo } from 'react';
import { useMobile } from '../hooks/useMobile';
import { getDateRange, getComparisonRange, DateRangeOption, ComparisonOption } from '../utils/dateUtils';

// Custom WidthProvider HOC since the library's export is broken in ESM
const withWidth = (WrappedComponent: any) => {
    return (props: any) => {
        const ref = useRef<HTMLDivElement>(null);
        // Initialize with 0 to prevent rendering at wrong breakpoint
        const [width, setWidth] = useState(0);

        useLayoutEffect(() => {
            if (!ref.current) return;

            // Set initial width immediately
            setWidth(ref.current.offsetWidth || ref.current.clientWidth);

            const observer = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    setWidth(entry.contentRect.width);
                }
            });
            observer.observe(ref.current);
            return () => observer.disconnect();
        }, []);

        return (
            <div ref={ref} className={props.className} style={{ width: '100%', height: '100%' }}>
                {/* Only render grid when we know actual width to prevent layout jump */}
                {width > 0 && (
                    <WrappedComponent
                        {...props}
                        width={width}
                        className="" // clear class on child to avoid conflicts
                    />
                )}
            </div>
        );
    };
};

const ResponsiveGridLayoutWithWidth = withWidth(ResponsiveGridLayout);

interface WidgetInstance {
    id: string; // Generated ID or DB ID
    widgetKey: string;
    position: { x: number, y: number, w: number, h: number };
    settings?: any;
}

export function DashboardPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const isMobile = useMobile();
    const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showAddWidget, setShowAddWidget] = useState(false);
    // Mobile lock state: locked by default on mobile to prevent accidental drag
    const [isLayoutLocked, setIsLayoutLocked] = useState(true);
    // Track current breakpoint to maintain layout stability during resize
    const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('lg');

    // Date State
    const [dateOption, setDateOption] = useState<DateRangeOption>('today');
    const [comparisonOption, setComparisonOption] = useState<ComparisonOption>('previous_period');

    useEffect(() => {
        fetchLayout();
    }, [currentAccount, token]);

    async function fetchLayout() {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            const res = await fetch('/api/dashboard', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const data = await res.json();

            // Transform DB widgets to state
            const mapped = data.widgets.map((w: any) => ({
                id: w.id, // Use unique ID for key
                widgetKey: w.widgetKey,
                position: typeof w.position === 'string' ? JSON.parse(w.position) : w.position,
                settings: w.settings
            }));
            setWidgets(mapped);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }

    /**
     * Handle breakpoint changes to maintain layout stability.
     * This prevents react-grid-layout from recalculating layouts during resize.
     */
    const onBreakpointChange = (newBreakpoint: string) => {
        setCurrentBreakpoint(newBreakpoint);
    };

    const onLayoutChange = (_layout: any, allLayouts: any) => {
        // Don't persist layout changes on mobile to protect desktop layout
        if (isMobile) return;
        // Only persist when layout is unlocked to prevent accidental saves
        if (isLayoutLocked) return;

        // Always use the lg layout for persistence (our source of truth)
        const lgLayout = allLayouts?.lg;
        if (!lgLayout) return;

        // Update local state positions from lg layout
        const newWidgets = widgets.map(w => {
            const match = lgLayout.find((l: any) => l.i === w.id);
            if (match) {
                return {
                    ...w,
                    position: { x: match.x, y: match.y, w: match.w, h: match.h }
                };
            }
            return w;
        });

        if (!isEqual(widgets, newWidgets)) {
            setWidgets(newWidgets);
            debouncedSave(newWidgets);
        }
    };

    const debouncedSave = debounce(async (newWidgets: WidgetInstance[]) => {
        setIsSaving(true);
        try {
            await fetch('/api/dashboard', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id
                },
                body: JSON.stringify({
                    widgets: newWidgets.map(w => ({
                        widgetKey: w.widgetKey,
                        position: w.position,
                        settings: w.settings
                    }))
                })
            });
        } catch (err) {
            console.error("Save failed", err);
        } finally {
            setIsSaving(false);
        }
    }, 2000);
    /**
     * Memoized responsive layouts for all breakpoints.
     * Generated from widget positions, only recalculates when widgets change.
     * This prevents layout reset when the library re-renders.
     */
    const responsiveLayouts = useMemo(() => {
        const breakpointCols = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
        const layouts: { [key: string]: { i: string; x: number; y: number; w: number; h: number }[] } = {};

        for (const [bp, cols] of Object.entries(breakpointCols)) {
            layouts[bp] = widgets.map(widget => {
                // Clamp width to max available columns
                const w = Math.min(widget.position.w, cols);
                // Clamp x position so item stays within bounds
                const x = Math.min(widget.position.x, Math.max(0, cols - w));
                return {
                    i: widget.id,
                    x,
                    y: widget.position.y,
                    w,
                    h: widget.position.h
                };
            });
        }
        return layouts;
    }, [widgets]);

    const addWidget = (key: string) => {
        const entry = WidgetRegistry[key];
        const newWidget: WidgetInstance = {
            id: `new-${Date.now()}`,
            widgetKey: key,
            position: { x: 0, y: Infinity, w: entry.defaultW, h: entry.defaultH }
        };
        const updated = [...widgets, newWidget];
        setWidgets(updated);
        debouncedSave(updated);
        setShowAddWidget(false);
    };

    const removeWidget = (id: string) => {
        const updated = widgets.filter(w => w.id !== id);
        setWidgets(updated);
        debouncedSave(updated);
    };

    // Calculate dates
    const dateRange = getDateRange(dateOption);
    const comparisonRange = getComparisonRange(dateRange, comparisonOption);

    if (isLoading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-sm text-gray-500">Overview of your store performance.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Date Logic Controls */}
                    <div className="flex bg-white border border-gray-200 rounded-lg shadow-xs">
                        <select
                            value={dateOption}
                            onChange={(e) => setDateOption(e.target.value as DateRangeOption)}
                            className="bg-transparent border-r border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 outline-hidden focus:bg-gray-50"
                        >
                            <option value="today">Today</option>
                            <option value="yesterday">Yesterday</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="90d">Last 90 Days</option>
                            <option value="ytd">Year to Date</option>
                            <option value="all">All Time</option>
                        </select>
                        <select
                            value={comparisonOption}
                            onChange={(e) => setComparisonOption(e.target.value as ComparisonOption)}
                            className="bg-transparent px-3 py-2 text-sm text-gray-500 outline-hidden focus:bg-gray-50"
                        >
                            <option value="none">No Comparison</option>
                            <option value="previous_period">vs Previous Period</option>
                            <option value="previous_year">vs Previous Year</option>
                        </select>
                    </div>


                    <div className="h-6 w-px bg-gray-300 mx-2 hidden md:block"></div>

                    {isSaving && <span className="text-xs text-gray-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving...</span>}

                    {/* Layout Lock Toggle */}
                    <button
                        onClick={() => setIsLayoutLocked(!isLayoutLocked)}
                        className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors border ${isLayoutLocked
                            ? 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                            }`}
                        title={isLayoutLocked ? 'Unlock to edit layout' : 'Lock layout'}
                    >
                        {isLayoutLocked ? <Lock size={16} /> : <Unlock size={16} />}
                        {isLayoutLocked ? 'Locked' : 'Editing'}
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setShowAddWidget(!showAddWidget)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
                        >
                            <Plus size={16} /> Add Widget
                        </button>

                        {showAddWidget && (
                            <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-100 z-50 py-2">
                                <div className="px-3 py-2 border-b border-gray-50 text-xs font-semibold text-gray-500 uppercase">Available Widgets</div>
                                {Object.entries(WidgetRegistry).map(([key, entry]) => (
                                    <button
                                        key={key}
                                        onClick={() => addWidget(key)}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-blue-600 transition-colors"
                                    >
                                        {entry.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ResponsiveGridLayoutWithWidth
                key={`grid-${isLayoutLocked ? 'locked' : 'unlocked'}-${currentBreakpoint}`}
                className="layout"
                layouts={responsiveLayouts}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={100}
                onLayoutChange={(l: any, all: any) => onLayoutChange(l, all)}
                onBreakpointChange={onBreakpointChange}
                isDraggable={!isLayoutLocked}
                isResizable={!isLayoutLocked}
                draggableHandle={!isLayoutLocked ? ".drag-handle" : undefined}
                compactType={null}
                preventCollision={true}
            >
                {widgets.map(w => (
                    <div key={w.id} className="bg-transparent h-full relative group">
                        {/* Widget Controls - hidden when locked */}
                        {!isLayoutLocked && (
                            <div className="absolute top-2 right-2 z-20 flex items-center gap-1 pointer-events-none">
                                <button
                                    onClick={(e) => { e.stopPropagation(); removeWidget(w.id); }}
                                    className="p-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 rounded-sm hover:bg-red-50 hover:text-red-500 text-gray-400 pointer-events-auto shadow-xs"
                                    title="Remove Widget"
                                >
                                    <X size={14} />
                                </button>
                                <div className="drag-handle p-1 cursor-move opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 rounded-sm text-gray-500 pointer-events-auto shadow-xs hover:bg-white">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" /></svg>
                                </div>
                            </div>
                        )}
                        {renderWidget(w.widgetKey, {
                            settings: w.settings,
                            className: "h-full",
                            dateRange,
                            comparison: comparisonRange
                        })}
                    </div>
                ))}
            </ResponsiveGridLayoutWithWidth>
        </div>
    );
}
