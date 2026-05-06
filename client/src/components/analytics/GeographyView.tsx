import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Logger } from '../../utils/logger';
import { getDateRange } from '../../utils/dateUtils';
import { Globe, ChevronDown, ChevronRight, MapPin } from 'lucide-react';

interface CountryData {
    country: string;
    sessions: number;
    revenue: number;
    conversionRate: number;
    cities?: { city: string; sessions: number; revenue: number }[];
}

// GeoRevenueData interface removed (unused)

function getFlagEmoji(code: string): string {
    const clean = code.slice(0, 2).toUpperCase();
    if (clean.length !== 2) return '🌍';
    return String.fromCodePoint(...clean.split('').map(c => 127397 + c.charCodeAt(0)));
}

export const GeographyView: React.FC<{ dateRange: string }> = ({ dateRange }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [countries, setCountries] = useState<CountryData[]>([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const fetchData = useCallback(async () => {
        if (!token || !currentAccount?.id) return;
        setLoading(true);
        try {
            const range = getDateRange(dateRange);
            const [countriesRes] = await Promise.all([
                api.get<CountryData[]>(`/api/analytics/geography/countries?startDate=${range.startDate}&endDate=${range.endDate}`, token, currentAccount.id),
            ]);
            setCountries(countriesRes || []);
        } catch (e) {
            Logger.error('Failed to fetch geography data:', { error: e });
        } finally {
            setLoading(false);
        }
    }, [dateRange, token, currentAccount?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const toggleExpand = async (country: string) => {
        const next = new Set(expanded);
        if (next.has(country)) {
            next.delete(country);
            setExpanded(next);
            return;
        }
        next.add(country);
        setExpanded(next);
        if (!countries.find(c => c.country === country)?.cities) {
            try {
                const range = getDateRange(dateRange);
                const cities = await api.get<{ city: string; sessions: number; revenue: number }[]>(
                    `/api/analytics/geography/cities?country=${country}&startDate=${range.startDate}&endDate=${range.endDate}`,
                    token!, currentAccount!.id
                );
                setCountries(prev =>
                    prev.map(c => c.country === country ? { ...c, cities } : c)
                );
            } catch (e) {
                Logger.error('Failed to fetch city data:', { error: e });
            }
        }
    };

    return (
        <div className="space-y-6">
            <Card className="border-0 shadow-xs">
                <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Globe className="w-4 h-4 text-indigo-500" />
                        Traffic by Country
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                        </div>
                    ) : countries.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-slate-400 italic">No geography data yet</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-100 dark:border-slate-700">
                                        <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Country</th>
                                        <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Sessions</th>
                                        <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Revenue</th>
                                        <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Conv. Rate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {countries.map(item => (
                                        <React.Fragment key={item.country}>
                                            <tr
                                                className="border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                                                onClick={() => toggleExpand(item.country)}
                                            >
                                                <td className="py-2.5 px-3 flex items-center gap-2">
                                                    {expanded.has(item.country)
                                                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                                        : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                                                    }
                                                    <span className="text-base">{getFlagEmoji(item.country)}</span>
                                                    <span className="text-gray-700 dark:text-slate-300">{item.country}</span>
                                                </td>
                                                <td className="py-2.5 px-3 text-right text-gray-900 dark:text-slate-100">{item.sessions.toLocaleString()}</td>
                                                <td className="py-2.5 px-3 text-right font-medium text-gray-900 dark:text-slate-100">${item.revenue.toLocaleString()}</td>
                                                <td className="py-2.5 px-3 text-right text-gray-500 dark:text-slate-400">{item.conversionRate.toFixed(2)}%</td>
                                            </tr>
                                            {expanded.has(item.country) && item.cities && item.cities.length > 0 && (
                                                <tr>
                                                    <td colSpan={4} className="py-2 pl-10 pr-4 bg-gray-50/50 dark:bg-slate-800/30">
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                            {item.cities.map(city => (
                                                                <div key={city.city} className="flex items-center justify-between text-xs py-1.5 px-3 bg-white dark:bg-slate-800 rounded-lg">
                                                                    <span className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300">
                                                                        <MapPin className="w-3 h-3" />
                                                                        {city.city}
                                                                    </span>
                                                                    <span className="text-gray-400 dark:text-slate-500">{city.sessions} sessions · ${city.revenue.toLocaleString()}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default GeographyView;
