import { Link } from 'react-router-dom';
import { TeamSettings } from '../components/settings/TeamSettings';

/** Keep the standalone route on the same guarded controls as account settings. */
export function TeamPage() {
    return <main className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6 text-slate-900 dark:text-slate-100">
        <div className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Team Management</h1><Link to="/settings?tab=roles" className="text-indigo-600 dark:text-indigo-400">Manage Roles</Link></div>
        <TeamSettings />
    </main>;
}
