import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Tab {
    id: string;
    label: string;
    icon?: React.ReactNode;
    content: React.ReactNode;
    keepMounted?: boolean;
}

interface TabsProps {
    tabs: Tab[];
    defaultTab?: string;
    className?: string;
    mountInactiveTabs?: boolean;
    activeTab?: string;
    onTabChange?: (tabId: string) => void;
    /** Render navigation elsewhere while keeping panel state owned by this component. */
    navigationContainer?: HTMLElement | null;
}

export function Tabs({
    tabs,
    defaultTab,
    className = '',
    mountInactiveTabs = true,
    activeTab: controlledActiveTab,
    onTabChange,
    navigationContainer
}: TabsProps) {
    const initialTab = defaultTab || tabs[0]?.id || '';
    const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState(initialTab);

    const rawActiveTab = controlledActiveTab ?? uncontrolledActiveTab;
    const isValidTab = tabs.some(tab => tab.id === rawActiveTab);
    const fallbackTab = defaultTab || tabs[0]?.id || '';
    const activeTab = isValidTab ? rawActiveTab : fallbackTab;
    const [visitedTabs, setVisitedTabs] = useState(() => new Set([activeTab]));

    useEffect(() => {
        if (fallbackTab && !isValidTab && controlledActiveTab === undefined) {
            // Guard: when active tab is removed from tab list, fall back to a valid tab
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setUncontrolledActiveTab(fallbackTab);
            onTabChange?.(fallbackTab);
        }
    }, [isValidTab, controlledActiveTab, fallbackTab, onTabChange]);

    if (tabs.length === 0) {
        return null;
    }

    const handleTabChange = (tabId: string) => {
        setVisitedTabs((current) => {
            if (current.has(activeTab) && current.has(tabId)) return current;
            const next = new Set(current);
            next.add(activeTab);
            next.add(tabId);
            return next;
        });
        if (controlledActiveTab === undefined) {
            setUncontrolledActiveTab(tabId);
        }
        onTabChange?.(tabId);
    };

    const navigation = (
            <div className="flex w-full items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto no-scrollbar">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        aria-pressed={activeTab === tab.id}
                        onClick={() => handleTabChange(tab.id)}
                        className={`
                            flex shrink-0 items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors motion-reduce:transition-none whitespace-nowrap relative
                            lg:min-w-0 lg:flex-1 lg:justify-center lg:gap-1 lg:px-1.5 lg:text-xs
                            ${activeTab === tab.id
                                ? 'bg-white dark:bg-slate-700 text-[var(--brand-text)] shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'}
                        `}
                    >
                        {tab.icon && <span className={`w-4 h-4 ${activeTab === tab.id ? 'text-[var(--brand-text)]' : 'text-slate-500 dark:text-slate-400'}`}>{tab.icon}</span>}
                        {tab.label}
                    </button>
                ))}
            </div>
    );

    return (
        <div className={`${navigationContainer ? '' : 'space-y-6'} ${className}`}>
            {navigationContainer ? createPortal(navigation, navigationContainer) : navigation}

            {/* Tab Content */}
            <div className="min-h-[400px]">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        hidden={activeTab !== tab.id}
                        className="min-w-0"
                    >
                        {(mountInactiveTabs || activeTab === tab.id || (tab.keepMounted && visitedTabs.has(tab.id))) ? tab.content : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
