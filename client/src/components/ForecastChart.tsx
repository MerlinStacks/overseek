
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, TrendingUp } from 'lucide-react';

interface ForecastData {
    date: string;
    sales?: number;
    historySales?: number | null;
    forecastSales?: number | null;
    isForecast?: boolean;
}

interface ForecastProps {
    dateRange: { startDate: string, endDate: string };
}

export function ForecastChart({ dateRange }: ForecastProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<ForecastData[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (currentAccount && token) {
            fetchForecast();
        }
    }, [currentAccount, token, dateRange]);

    async function fetchForecast() {
        setIsLoading(true);
        try {
            // First get actual history
            const historyRes = await fetch(
                `/api/analytics/sales-chart?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&interval=day`,
                { headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' } }
            );

            // Then get forecast
            const forecastRes = await fetch(
                `/api/analytics/forecast?days=30`,
                { headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' } }
            );

            if (historyRes.ok && forecastRes.ok) {
                const history = await historyRes.json();
                const forecast = await forecastRes.json();

                // Transform for Recharts: historySales vs forecastSales
                // Warning: To make the line continuous, the last history point should also be the first forecast point 
                // (or they should share a date). Our simple backend forecast starts 'tomorrow', so there might be a gap visually.
                // Let's just render them. 

                const processed: ForecastData[] = history.map((d: any) => ({
                    date: d.date,
                    historySales: d.sales,
                    forecastSales: null
                }));

                // Logic to stitch the lines: 
                // The last point of history should also be the start point of forecast.
                if (processed.length > 0 && forecast.length > 0) {
                    const lastHistory = processed[processed.length - 1];
                    // Set the start of the forecast line to be the same as the end of history
                    lastHistory.forecastSales = lastHistory.historySales;
                }

                // Add the rest of the forecast (excluding the first point if it overlaps by date, 
                // though usually forecast API returns future dates. We just append.)
                forecast.forEach((d: any) => {
                    // Check if date already exists to avoid duplicates (which would break the x-axis)
                    if (!processed.find(p => p.date === d.date)) {
                        processed.push({
                            date: d.date,
                            historySales: null,
                            forecastSales: d.sales
                        });
                    }
                });

                setData(processed);
            }

        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    }

    if (isLoading) return <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-900">Sales Forecast</h3>
                    <p className="text-sm text-gray-500">Predicted sales for the next 30 days based on recent trends</p>
                </div>
                <div className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                    <TrendingUp size={14} /> AI Powered
                </div>
            </div>

            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        {/* @ts-ignore */}
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(val: any) => String(val).length > 5 ? String(val).slice(5) : String(val)} />
                        {/* @ts-ignore */}
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(val: any) => `$${val}`} />
                        <Tooltip />
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />

                        {/* History Area */}
                        <Area
                            type="monotone"
                            dataKey="historySales"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorSales)"
                            name="Sales"
                        />

                        {/* Forecast Area */}
                        <Area
                            type="monotone"
                            dataKey="forecastSales"
                            stroke="#a855f7"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            fillOpacity={1}
                            fill="url(#colorForecast)"
                            name="Forecast"
                        />
                    </AreaChart>
                </ResponsiveContainer>

                {/* Fallback legend/explanation since single line color change is hard in simple AreaChart without split data */}
                <div className="flex justify-center mt-4 gap-6 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="text-gray-600">Historical Sales</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                        <span className="text-gray-600">Forecast (Projected)</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Improvement: To properly show different colors, we essentially need two series in the data
// e.g. { date, historySales: 100, forecastSales: null }
//      { date, historySales: null, forecastSales: 105 }
// But for now, a single continuous blue line is okay, or I can quickly refactor to split keys.
// Let's refactor quickly for better visualization.
