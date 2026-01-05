import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import VisitorLogWidget from '../components/widgets/VisitorLogWidget';
import EcommerceLogWidget from '../components/widgets/EcommerceLogWidget';
import { BarChart3, Users, Globe, Search } from 'lucide-react';

const AnalyticsDashboard: React.FC = () => {

    return (
        <div className="p-6 space-y-6 h-full overflow-y-auto bg-gray-50/30">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Analytics & Intelligence</h1>
                    <p className="text-sm text-gray-500">Deep dive into visitor behavior and commerce events.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[600px]">
                {/* Visitor Log Section */}
                <Card className="flex flex-col h-full overflow-hidden border-0 shadow-sm ring-1 ring-gray-200">
                    <CardHeader className="bg-white border-b border-gray-100 py-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                <Users className="w-4 h-4 text-blue-500" />
                                Real-time Visitor Log
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 overflow-hidden bg-white">
                        <VisitorLogWidget />
                    </CardContent>
                </Card>

                {/* Ecommerce Stream Section */}
                <Card className="flex flex-col h-full overflow-hidden border-0 shadow-sm ring-1 ring-gray-200">
                    <CardHeader className="bg-white border-b border-gray-100 py-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                <Globe className="w-4 h-4 text-emerald-500" />
                                Ecommerce Stream
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 overflow-hidden bg-white">
                        <EcommerceLogWidget />
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Placeholder for Search Insights */}
                <Card className="col-span-1 border-0 shadow-sm ring-1 ring-gray-200">
                    <CardHeader className="bg-white border-b border-gray-100 py-4">
                        <CardTitle className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            <Search className="w-4 h-4 text-purple-500" />
                            Top Search Terms
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 bg-white">
                        <div className="text-sm text-gray-500 italic">Coming soon...</div>
                        {/* We can wire up search-terms endpoint here later */}
                    </CardContent>
                </Card>

                <Card className="col-span-1 border-0 shadow-sm ring-1 ring-gray-200">
                    <CardHeader className="bg-white border-b border-gray-100 py-4">
                        <CardTitle className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-orange-500" />
                            Channel Breakdown
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 bg-white">
                        <div className="text-sm text-gray-500 italic">Coming soon...</div>
                    </CardContent>
                </Card>
            </div>

        </div>
    );
};

export default AnalyticsDashboard;
