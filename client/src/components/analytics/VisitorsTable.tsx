
import { Smartphone, Monitor, Clock } from 'lucide-react';
import { LiveSession } from '../../types/analytics';

function getFlagEmoji(countryCode: string | null) {
    if (!countryCode) return '🌍';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

interface VisitorsTableProps {
    data: LiveSession[];
}

export const VisitorsTable = ({ data }: VisitorsTableProps) => (
    <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
            <tr>
                <th className="p-4 font-medium">Visitor</th>
                <th className="p-4 font-medium">Location</th>
                <th className="p-4 font-medium hidden md:table-cell">Source</th>
                <th className="p-4 font-medium">Last Activity</th>
            </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
            {data.map(v => (
                <tr key={v.id} className="hover:bg-blue-50 transition-colors group">
                    <td className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-gray-100 p-2 rounded-full text-gray-500">
                                {v.deviceType === 'mobile' ? <Smartphone size={16} /> : <Monitor size={16} />}
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
                    <td className="p-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xl">{getFlagEmoji(v.country)}</span>
                            <span className="text-gray-700">{v.city || 'Unknown'}, {v.country || '-'}</span>
                        </div>
                    </td>
                    <td className="p-4 hidden md:table-cell">
                        {v.utmSource ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-50 text-yellow-700 rounded text-xs font-medium border border-yellow-200">
                                {v.utmSource} / {v.utmCampaign}
                            </span>
                        ) : (
                            <span className="text-gray-400 text-xs">{v.referrer || 'Direct'}</span>
                        )}
                    </td>
                    <td className="p-4">
                        <div className="flex items-center gap-2 text-gray-700">
                            <Clock size={14} className="text-gray-400" />
                            {new Date(v.lastActiveAt).toLocaleTimeString()}
                        </div>
                        <div className="text-xs text-gray-400 mt-1 max-w-[200px] truncate">{v.currentPath}</div>
                    </td>
                </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-500">No active visitors.</td></tr>}
        </tbody>
    </table>
);
