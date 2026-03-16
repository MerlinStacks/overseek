/**
 * VisitorsTable — Real-time visitor list used by the live analytics page.
 *
 * Why these columns: the original table was missing cart value, current page,
 * and status indicators despite the data being available in LiveSession. It also
 * had no click-to-profile capability (the VisitorProfileModal was never wired up).
 */

import { Smartphone, Monitor, Clock, ExternalLink } from 'lucide-react';
import { LiveSession } from '../../types/analytics';
import { formatCurrency } from '../../utils/format';

/** Country-code → flag emoji. Falls back to 🌍. */
function getFlagEmoji(countryCode: string | null): string {
    if (!countryCode) return '🌍';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

/** Recency status: green < 1 min, yellow 1-3 min, gray > 3 min. */
function getStatusClasses(isoDate: string): string {
    const secsAgo = (Date.now() - new Date(isoDate).getTime()) / 1000;
    if (secsAgo < 60) return 'bg-green-500 animate-pulse';
    if (secsAgo < 180) return 'bg-yellow-400';
    return 'bg-gray-300';
}

interface VisitorsTableProps {
    data: LiveSession[];
    onVisitorClick?: (visitorId: string) => void;
}

export const VisitorsTable = ({ data, onVisitorClick }: VisitorsTableProps) => (
    <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
            <tr>
                <th className="p-4 font-medium">Visitor</th>
                <th className="p-4 font-medium">Location</th>
                <th className="p-4 font-medium hidden md:table-cell">Source</th>
                <th className="p-4 font-medium hidden lg:table-cell">Currently Viewing</th>
                <th className="p-4 font-medium hidden lg:table-cell text-right">Cart Value</th>
                <th className="p-4 font-medium">Last Activity</th>
            </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
            {data.map(v => (
                <tr
                    key={v.id}
                    className={`hover:bg-blue-50/60 transition-colors group ${onVisitorClick ? 'cursor-pointer' : ''}`}
                    onClick={() => onVisitorClick?.(v.visitorId)}
                >
                    {/* Visitor */}
                    <td className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className="bg-gray-100 p-2 rounded-full text-gray-500">
                                    {v.deviceType === 'mobile' ? <Smartphone size={16} /> : <Monitor size={16} />}
                                </div>
                                {/* Status dot */}
                                <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${getStatusClasses(v.lastActiveAt)}`} />
                            </div>
                            <div>
                                <div className="font-medium text-gray-900 break-all">
                                    {v.customer?.firstName
                                        ? `${v.customer.firstName} ${v.customer.lastName || ''}`.trim()
                                        : `${v.visitorId.substring(0, 8)}...`}
                                </div>
                                <div className="text-xs text-gray-500">{v.os} • {v.browser}</div>
                            </div>
                        </div>
                    </td>

                    {/* Location */}
                    <td className="p-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xl">{getFlagEmoji(v.country)}</span>
                            <span className="text-gray-700">{v.city || 'Unknown'}, {v.country || '-'}</span>
                        </div>
                    </td>

                    {/* Source */}
                    <td className="p-4 hidden md:table-cell">
                        {v.utmSource ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-50 text-yellow-700 rounded-sm text-xs font-medium border border-yellow-200">
                                {v.utmSource} / {v.utmCampaign}
                            </span>
                        ) : (
                            <span className="text-gray-400 text-xs">{v.referrer || 'Direct'}</span>
                        )}
                    </td>

                    {/* Currently Viewing */}
                    <td className="p-4 hidden lg:table-cell">
                        {v.currentPath ? (
                            <span className="text-xs text-blue-600 truncate block max-w-[200px]" title={v.currentPath}>
                                {v.currentPath}
                            </span>
                        ) : (
                            <span className="text-xs text-gray-300">—</span>
                        )}
                    </td>

                    {/* Cart Value */}
                    <td className="p-4 hidden lg:table-cell text-right">
                        {Number(v.cartValue) > 0 ? (
                            <span className="text-sm font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-md">
                                {formatCurrency(Number(v.cartValue))}
                            </span>
                        ) : (
                            <span className="text-xs text-gray-300">—</span>
                        )}
                    </td>

                    {/* Last Activity */}
                    <td className="p-4">
                        <div className="flex items-center gap-2 text-gray-700">
                            <Clock size={14} className="text-gray-400" />
                            {new Date(v.lastActiveAt).toLocaleTimeString()}
                        </div>
                        {/* Profile link hint on hover */}
                        {onVisitorClick && (
                            <div className="text-xs text-blue-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <ExternalLink size={10} /> View profile
                            </div>
                        )}
                    </td>
                </tr>
            ))}
            {data.length === 0 && (
                <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-500">No active visitors.</td>
                </tr>
            )}
        </tbody>
    </table>
);
