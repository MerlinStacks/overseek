import React, { useState } from 'react';

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
}

export function Tabs({ tabs, defaultTab, className = '' }: TabsProps) {
    const [activeTab, setActiveTab] = useState(defaultTab || tabs[0].id);

    return (
        <div className={`space-y-6 ${className}`}>
            {/* Tab Header */}
            <div className="flex items-center gap-1 p-1 bg-white/40 backdrop-blur-md border border-white/50 rounded-xl overflow-x-auto no-scrollbar shadow-sm">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                            flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap
                            ${activeTab === tab.id
                                ? 'bg-white text-blue-600 shadow-md ring-1 ring-black/5'
                                : 'text-gray-600 hover:bg-white/50 hover:text-gray-900'}
                        `}
                    >
                        {tab.icon && <span className="w-4 h-4">{tab.icon}</span>}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="min-h-[400px]">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        className={`transition-opacity duration-300 ${activeTab === tab.id ? 'block opacity-100' : 'hidden opacity-0'}`}
                    >
                        {tab.content}
                    </div>
                ))}
            </div>
        </div>
    );
}
