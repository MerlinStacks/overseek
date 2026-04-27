import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { Logger } from '../utils/logger';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { renderWidget, WidgetRegistry } from '../components/widgets/WidgetRegistry';
import { usePermissions } from '../hooks/usePermissions';
import { DashboardPageSkeleton } from '../components/ui/PageSkeletons';
import { Loader2, Plus, X, Lock, Unlock } from 'lucide-react';
import { debounce, isEqual } from '../utils/debounce';
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useMobile } from '../hooks/useMobile';
import { getDateRange, getComparisonRange, getComparisonLabel, DateRangeOption, ComparisonOption } from '../utils/dateUtils';
import { api } from '../services/api';

const ResponsiveGridLayoutWithWidth = WidthProvider(Responsive);
interface GridLayoutItem {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
}
type Layouts = Partial<Record<string, readonly GridLayoutItem[]>>;

interface WidgetInstance {
    id: string; // Generated ID or DB ID
    widgetKey: string;
    position: { x: number, y: number, w: number, h: number };
    settings?: unknown;
}

interface DashboardWidgetResponse {
    id: string;
    widgetKey: string;
    position: string | { x: number; y: number; w: number; h: number };
    settings?: unknown;
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
    const addWidgetRef = useRef<HTMLDivElement>(null);
    // Mobile lock state: locked by default on mobile to prevent accidental drag
    const [isLayoutLocked, setIsLayoutLocked] = useState(true);
    // Track current breakpoint to maintain layout stability during resize
    const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('lg');

    // Date State
    const [dateOption, setDateOption] = useState<DateRangeOption>('today');
    const [comparisonOption, setComparisonOption] = useState<ComparisonOption>('smart');

    const fetchLayout = useCallback(async () => {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            const data = await api.request<{ widgets: DashboardWidgetResponse[] }>('/api/dashboard', {
                method: 'GET',
                token: token || undefined,
                accountId: currentAccount.id,
                headers: {
                    'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone
                }
            });

            // Transform DB widgets to state
            const mapped = data.widgets.map((w) => ({
                id: w.id, // Use unique ID for key
                widgetKey: w.widgetKey,
                position: (typeof w.position === 'string' ? JSON.parse(w.position) : w.position) as WidgetInstance['position'],
                settings: w.settings
            }));
            setWidgets(mapped);
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchLayout();
    }, [fetchLayout]);

    /** Close the Add Widget dropdown when clicking outside */
    useEffect(() => {
        if (!showAddWidget) return;
        const handler = (e: MouseEvent) => {
            if (addWidgetRef.current && !addWidgetRef.current.contains(e.target as Node)) {
                setShowAddWidget(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showAddWidget]);

    /**
     * Handle breakpoint changes to maintain layout stability.
     * This prevents react-grid-layout from recalculating layouts during resize.
     */
    const onBreakpointChange = (newBreakpoint: string) => {
        setCurrentBreakpoint(newBreakpoint);
    };

    const onLayoutChange = (_layout: readonly GridLayoutItem[], allLayouts: Layouts) => {
        // Don't persist layout changes on mobile to protect desktop layout
        if (isMobile) return;
        // Only persist when layout is unlocked to prevent accidental saves
        if (isLayoutLocked) return;

        // Always use the lg layout for persistence (our source of truth)
        const lgLayout = allLayouts?.lg;
        if (!lgLayout) return;

        // Update local state positions from lg layout
        const newWidgets = widgets.map(w => {
            const match = lgLayout.find((l) => l.i === w.id);
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

    const saveLayout = useCallback(async (newWidgets: WidgetInstance[]) => {
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
    }, [token, currentAccount]);

    const debouncedSave = useMemo(
        () => debounce((newWidgets: WidgetInstance[]) => saveLayout(newWidgets), 2000),
        [saveLayout]
    );
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

    // Memoize date calculations to prevent all widgets re-rendering on every resize
    const dateRange = useMemo(() => getDateRange(dateOption), [dateOption]);
    const comparisonRange = useMemo(() => getComparisonRange(dateRange, comparisonOption), [dateRange, comparisonOption]);
    const comparisonLabel = useMemo(() => getComparisonLabel(dateRange, comparisonOption), [dateRange, comparisonOption]);

    if (isLoading) return <DashboardPageSkeleton />;

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
                            aria-label="Date range"
                            className="bg-transparent border-r border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 outline-hidden focus:bg-slate-50 dark:focus:bg-slate-700/50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500/50"
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
                            aria-label="Comparison period"
                            className="bg-transparent px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 outline-hidden focus:bg-slate-50 dark:focus:bg-slate-700/50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                        >
                            <option value="none">No Comparison</option>
                            <option value="smart">Smart Comparison</option>
                            <option value="previous_period">vs Previous Period</option>
                            <option value="previous_year">vs Previous Year</option>
                        </select>
                    </div>

                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden md:block"></div>

                    {isSaving && <span className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Saving...</span>}

                    {/* Layout Lock Toggle */}
                    <button
                        onClick={() => setIsLayoutLocked(!isLayoutLocked)}
                        aria-label={isLayoutLocked ? 'Unlock layout editing' : 'Lock layout editing'}
                        className={`px-3 py-2.5 rounded-xl text-sm flex items-center gap-2 transition-all duration-200 border font-medium ${isLayoutLocked
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                            }`}
                        title={isLayoutLocked ? 'Unlock to edit layout' : 'Lock layout'}
                    >
                        {isLayoutLocked ? <Lock size={16} /> : <Unlock size={16} />}
                        {isLayoutLocked ? 'Locked' : 'Editing'}
                    </button>

                    <div className="relative" ref={addWidgetRef}>
                        <button
                            onClick={() => setShowAddWidget(!showAddWidget)}
                            aria-label="Add dashboard widget"
                            aria-expanded={showAddWidget}
                            aria-controls="dashboard-widget-menu"
                            className="bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/35 hover:-translate-y-0.5"
                        >
                            <Plus size={16} /> Add Widget
                        </button>

                        {showAddWidget && (
                            <div id="dashboard-widget-menu" className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-scale-in">
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
                onLayoutChange={(layoutArg, layoutsArg) => {
                    onLayoutChange(
                        layoutArg as unknown as readonly GridLayoutItem[],
                        layoutsArg as Layouts
                    );
                }}
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
                                        aria-label="Remove widget"
                                        className="p-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 dark:bg-slate-700/80 rounded-sm hover:bg-red-50 dark:hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400 text-gray-400 dark:text-slate-400 pointer-events-auto shadow-xs"
                                        title="Remove Widget"
                                    >
                                        <X size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Drag widget"
                                        title="Drag Widget"
                                        className="drag-handle p-1 cursor-move opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 dark:bg-slate-700/80 rounded-sm text-gray-500 dark:text-slate-400 pointer-events-auto shadow-xs hover:bg-white dark:hover:bg-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" /></svg>
                                    </button>
                                </div>
                            )}
                            {renderWidget(w.widgetKey, {
                                settings: (typeof w.settings === 'object' && w.settings !== null ? w.settings : undefined) as Record<string, unknown> | undefined,
                                className: "h-full",
                                dateRange,
                                comparison: comparisonRange,
                                comparisonLabel
                            })}
                        </div>
                    ))}
            </ResponsiveGridLayoutWithWidth>
        </div>
    );
}
