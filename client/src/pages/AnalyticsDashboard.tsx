import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import VisitorLogWidget from '../components/widgets/VisitorLogWidget';
import EcommerceLogWidget from '../components/widgets/EcommerceLogWidget';
import AnalyticsStatsWidget from '../components/widgets/AnalyticsStatsWidget';
import FunnelWidget from '../components/widgets/FunnelWidget';
import { BarChart3, Users, Globe, TrendingUp, PieChart } from 'lucide-react';

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
                <Card className="flex flex-col h-full overflow-hidden border-0 shadow-xs ring-1 ring-gray-200">
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
                <Card className="flex flex-col h-full overflow-hidden border-0 shadow-xs ring-1 ring-gray-200">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Conversion Funnel */}
                <Card className="border-0 shadow-xs ring-1 ring-gray-200">
                    <CardHeader className="bg-white border-b border-gray-100 py-4">
                        <CardTitle className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            Conversion Funnel
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 bg-white">
                        <FunnelWidget />
                    </CardContent>
                </Card>

                {/* Session Stats */}
                <Card className="border-0 shadow-xs ring-1 ring-gray-200">
                    <CardHeader className="bg-white border-b border-gray-100 py-4">
                        <CardTitle className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            <PieChart className="w-4 h-4 text-purple-500" />
                            Audience Insights
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 bg-white">
                        <AnalyticsStatsWidget />
                    </CardContent>
                </Card>
            </div>

        </div>
    );
};

export default AnalyticsDashboard;
