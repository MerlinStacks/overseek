import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';

interface Role { id: string; name: string }
interface Member { userId: string; role: string; roleId: string | null; maxRole: Role | null; user: { fullName: string | null; email: string; avatarUrl?: string | null } }
const baseRoles = ['ADMIN', 'STAFF', 'VIEWER'];
function decodeMembers(value: unknown): Member[] {
    if (!Array.isArray(value) || !value.every(item => isRecord(item) && typeof item.userId === 'string' && ['OWNER', ...baseRoles].includes(String(item.role)) && (item.roleId == null || typeof item.roleId === 'string') && (item.maxRole == null || (isRecord(item.maxRole) && typeof item.maxRole.id === 'string' && typeof item.maxRole.name === 'string')) && isRecord(item.user) && typeof item.user.email === 'string' && ['fullName', 'avatarUrl'].every(key => item.user && ((item.user as Record<string, unknown>)[key] == null || typeof (item.user as Record<string, unknown>)[key] === 'string')))) throw new Error('Invalid members');
    return value;
}
function decodeRoles(value: unknown): Role[] {
    if (!Array.isArray(value) || !value.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string')) throw new Error('Invalid roles');
    return value;
}
export function TeamSettings() {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to manage its team.</p>;
    return <AccountTeam key={JSON.stringify([token, currentAccount.id])} accountId={currentAccount.id} token={token} accountName={currentAccount.name} />;
}
function AccountTeam({ accountId, token, accountName }: { accountId: string; token: string; accountName: string }) {
    const endpoint = `/api/accounts/${encodeURIComponent(accountId)}/users`;
    const members = useScopedRequest(endpoint, accountId, token, decodeMembers);
    const roles = useScopedRequest('/api/roles', accountId, token, decodeRoles);
    const mutation = useScopedMutation();
    const [email, setEmail] = useState(''); const [role, setRole] = useState('STAFF');
    const [editing, setEditing] = useState<string | null>(null); const [editRole, setEditRole] = useState('STAFF'); const [roleId, setRoleId] = useState('');
    const [validation, setValidation] = useState<string | null>(null);
    const mutate = async (path: string, method: string, body?: unknown) => {
        if (mutation.isPending() || members.loading || members.error || roles.loading || roles.error) return;
        setValidation(null);
        const result = await mutation.run(async signal => {
            const response = await fetch(path, { method, signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            if (!response.ok) throw new Error('Team change failed');
        }, 'Could not confirm the team change. Existing members are retained; check their status before retrying.');
        if (result.ok) { setEmail(''); setEditing(null); members.retry(); }
    };
    if (members.loading || roles.loading) return <p role="status">Loading team members and roles...</p>;
    if (members.error || roles.error || !members.data || !roles.data) return <p role="alert">Could not load team members or roles. <button type="button" onClick={() => { members.retry(); roles.retry(); }}>Retry team</button></p>;
    return <section aria-label="Team settings" className="space-y-4 p-6 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-200 dark:border-slate-700">
        <h2 className="font-semibold">Team Members · {accountName}</h2>{(validation || mutation.error) && <p role="alert">{validation || mutation.error}</p>}{mutation.busy && <p role="status">Saving team changes...</p>}
        <fieldset disabled={mutation.busy} className="space-y-4"><form onSubmit={event => { event.preventDefault(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !baseRoles.includes(role)) { setValidation('Enter a valid member email and role.'); return; } void mutate(endpoint, 'POST', { email: email.trim().toLowerCase(), role }); }} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">Member email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} className="block p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-600" /></label><label className="text-sm">New member role<select value={role} onChange={event => setRole(event.target.value)} className="block p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-600">{baseRoles.map(value => <option key={value}>{value}</option>)}</select></label><button type="submit">Add User</button>
        </form><p className="text-sm">Users must already be registered with this email.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Account team members and assigned roles</caption><thead><tr>{['User', 'Base role', 'Custom role', 'Actions'].map(label => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{members.data.map(member => <tr key={member.userId}>
            <th scope="row" className="p-2">{member.user.fullName || member.user.email}<span className="block text-xs font-normal">{member.user.email}</span></th>
            <td className="p-2">{editing === member.userId ? <select aria-label={`Base role for ${member.user.email}`} value={editRole} onChange={event => setEditRole(event.target.value)} className="dark:bg-slate-900">{baseRoles.map(value => <option key={value}>{value}</option>)}</select> : member.role}</td>
            <td className="p-2">{editing === member.userId ? <select aria-label={`Custom role for ${member.user.email}`} value={roleId} onChange={event => setRoleId(event.target.value)} className="dark:bg-slate-900"><option value="">None</option>{roles.data!.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : member.maxRole?.name || 'None'}</td>
            <td className="p-2">{member.role !== 'OWNER' && (editing === member.userId ? <div className="flex gap-3"><button type="button" onClick={() => {
                if (!baseRoles.includes(editRole) || (roleId && !roles.data!.some(item => item.id === roleId))) { setValidation('Choose an available role.'); return; }
                void mutate(`${endpoint}/${encodeURIComponent(member.userId)}`, 'PATCH', { role: editRole, roleId: roleId || null });
            }}>Save Role</button><button type="button" onClick={() => setEditing(null)}>Cancel Role Edit</button></div> : <div className="flex gap-3"><button type="button" aria-label={`Edit role for ${member.user.email}`} onClick={() => { setEditing(member.userId); setEditRole(member.role); setRoleId(member.roleId || ''); }}>Edit Role</button><button type="button" aria-label={`Remove ${member.user.email}`} onClick={() => { if (!mutation.isPending() && confirm('Remove this member from the account?')) void mutate(`${endpoint}/${encodeURIComponent(member.userId)}`, 'DELETE'); }}>Remove User</button></div>)}</td>
        </tr>)}</tbody></table></div>{!members.data.length && <p>No team members found.</p>}
        {!roles.data.length && <p className="text-sm">Create custom roles in the Roles tab to define granular staff permissions.</p>}
        </fieldset>
    </section>;
}
