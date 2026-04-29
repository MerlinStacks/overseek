import React, { useEffect, useState } from 'react';

interface Tab {
    id: string;
    label: string;
    icon?: React.ReactNode;
    content: React.ReactNode;
}

interface TabsProps {
    tabs: Tab[];
    defaultTab?: string;
    className?: string;
    mountInactiveTabs?: boolean;
    activeTab?: string;
    onTabChange?: (tabId: string) => void;
}

export function Tabs({
    tabs,
    defaultTab,
    className = '',
    mountInactiveTabs = true,
    activeTab: controlledActiveTab,
    onTabChange
}: TabsProps) {
    const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState(defaultTab || tabs[0].id);
    const activeTab = controlledActiveTab ?? uncontrolledActiveTab;

    useEffect(() => {
        if (!tabs.some(tab => tab.id === activeTab)) {
            const fallbackTab = defaultTab || tabs[0].id;
            if (controlledActiveTab === undefined) {
                setUncontrolledActiveTab(fallbackTab);
            }
            onTabChange?.(fallbackTab);
        }
    }, [activeTab, controlledActiveTab, defaultTab, onTabChange, tabs]);

    const handleTabChange = (tabId: string) => {
        if (controlledActiveTab === undefined) {
            setUncontrolledActiveTab(tabId);
        }
        onTabChange?.(tabId);
    };

    return (
        <div className={`space-y-6 ${className}`}>
            {/* Tab Header */}
            <div className="flex items-center gap-1.5 p-1.5 bg-slate-100/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200/50 dark:border-slate-700/50 rounded-2xl overflow-x-auto no-scrollbar shadow-inner">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => handleTabChange(tab.id)}
                        className={`
                            flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap relative
                            ${activeTab === tab.id
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50 hover:text-slate-700 dark:hover:text-slate-200'}
                        `}
                    >
                        {tab.icon && <span className={`w-4 h-4 transition-colors ${activeTab === tab.id ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>{tab.icon}</span>}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="min-h-[400px]">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        className={`transition-all duration-300 ease-out transform ${activeTab === tab.id ? 'opacity-100 translate-y-0 relative z-10' : 'opacity-0 translate-y-2 absolute inset-0 -z-10 pointer-events-none'}`}
                    >
                        {(mountInactiveTabs || activeTab === tab.id) ? tab.content : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
