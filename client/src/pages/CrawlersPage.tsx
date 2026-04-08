/**
 * CrawlersPage — Bot & Crawler Management
 *
 * Dedicated page for viewing detected crawlers, managing their block status,
 * and customising the HTML page served to blocked bots.
 * Extracted from Settings > Analytics to keep the settings tab clean.
 */

import { CrawlerManagement } from '../components/settings/CrawlerManagement';
import { CrawlerBlockPageEditor } from '../components/settings/CrawlerBlockPageEditor';

export function CrawlersPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Bot & Crawler Management</h1>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    View detected crawlers, block unwanted bots, and customise the page they see.
                </p>
            </div>
            <CrawlerManagement />
            <CrawlerBlockPageEditor />
        </div>
    );
}
