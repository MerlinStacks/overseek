// @ts-ignore - Responsive import has type issues with ESM
import { Responsive as ResponsiveGridLayout } from 'react-grid-layout';
import { Logger } from '../utils/logger';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { renderWidget, WidgetRegistry } from '../components/widgets/WidgetRegistry';
import { usePermissions } from '../hooks/usePermissions';
import { Loader2, Plus, X, Lock, Unlock } from 'lucide-react';
import { debounce, isEqual } from '../utils/debounce';
import { useRef, useLayoutEffect, useState, useEffect, useMemo } from 'react';
import { useMobile } from '../hooks/useMobile';
import { getDateRange, getComparisonRange, DateRangeOption, ComparisonOption } from '../utils/dateUtils';
import { api } from '../services/api';

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
    const { hasPermission } = usePermissions();
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
            const data = await api.request<{ widgets: any[] }>('/api/dashboard', {
                method: 'GET',
                token: token || undefined,
                accountId: currentAccount.id,
                headers: {
                    'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone
                }
            });

            // Transform DB widgets to state
            const mapped = data.widgets.map((w: any) => ({
                id: w.id, // Use unique ID for key
                widgetKey: w.widgetKey,
                position: typeof w.position === 'string' ? JSON.parse(w.position) : w.position,
                settings: w.settings
            }));
            setWidgets(mapped);
        } catch (err) {
            Logger.error('An error occurred', { error: err });
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
            await api.request('/api/dashboard', {
                method: 'POST',
                token: token || undefined,
                accountId: currentAccount!.id,
                headers: {
                    'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone
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
            Logger.error('Save failed', { error: err });
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
        const layouts: { [key: string]: { i: string; x: number; y: number; w: number; h: number, static?: boolean }[] } = {};

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
                    h: widget.position.h,
                    static: isLayoutLocked
                };
            });
        }
        return layouts;
    }, [widgets, isLayoutLocked]);

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
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Dashboard</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Overview of your store performance</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Date Logic Controls - Premium styling */}
                    <div className="flex bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
                        <select
                            value={dateOption}
                            onChange={(e) => setDateOption(e.target.value as DateRangeOption)}
                            className="bg-transparent border-r border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 outline-hidden focus:bg-slate-50 dark:focus:bg-slate-700/50 transition-colors cursor-pointer"
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
                            className="bg-transparent px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 outline-hidden focus:bg-slate-50 dark:focus:bg-slate-700/50 transition-colors cursor-pointer"
                        >
                            <option value="none">No Comparison</option>
                            <option value="previous_period">vs Previous Period</option>
                            <option value="previous_year">vs Previous Year</option>
                        </select>
                    </div>

                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden md:block"></div>

                    {isSaving && <span className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Saving...</span>}

                    {/* Layout Lock Toggle */}
                    <button
                        onClick={() => setIsLayoutLocked(!isLayoutLocked)}
                        className={`px-3 py-2.5 rounded-xl text-sm flex items-center gap-2 transition-all duration-200 border font-medium ${isLayoutLocked
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                            }`}
                        title={isLayoutLocked ? 'Unlock to edit layout' : 'Lock layout'}
                    >
                        {isLayoutLocked ? <Lock size={16} /> : <Unlock size={16} />}
                        {isLayoutLocked ? 'Locked' : 'Editing'}
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setShowAddWidget(!showAddWidget)}
                            className="bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/35 hover:-translate-y-0.5"
                        >
                            <Plus size={16} /> Add Widget
                        </button>

                        {showAddWidget && (
                            <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-scale-in">
                                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Available Widgets</span>
                                </div>
                                <div className="max-h-64 overflow-y-auto py-1">
                                    {Object.entries(WidgetRegistry)
                                        .filter(([, entry]) => !entry.requiredPermission || hasPermission(entry.requiredPermission))
                                        .map(([key, entry]) => (
                                            <button
                                                key={key}
                                                onClick={() => addWidget(key)}
                                                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                            >
                                                {entry.label}
                                            </button>
                                        ))}
                                </div>
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
                {widgets
                    .filter(w => {
                        const entry = WidgetRegistry[w.widgetKey];
                        // Hide widget if user lacks required permission
                        return !entry?.requiredPermission || hasPermission(entry.requiredPermission);
                    })
                    .map(w => (
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
