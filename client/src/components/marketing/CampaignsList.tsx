import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { getBroadcastOperators, getDefaultBroadcastOperator, isBroadcastContactStatusField } from '../../utils/conditionFieldRules';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../ui/Modal';
import { LTR_TEXT_STYLE, sanitizeBidiText } from './textInputBidi';

interface MarketingCampaign {
    id: string;
    name: string;
    subject?: string;
    status: 'SENT' | 'DRAFT' | 'SCHEDULED' | 'SENDING' | string;
    sentCount: number;
    openedCount: number;
    scheduledAt?: string | null;
    createdAt?: string;
    clickRate?: number | null;
    orderCount?: number | null;
    revenue?: number | null;
}

interface SegmentItem {
    id: string;
    name: string;
    _count?: { campaigns?: number };
}

interface EmailListItem {
    id: string;
    name: string;
    description?: string | null;
    _count?: { memberships?: number };
}

interface NewCampaignInput {
    name: string;
    subject: string;
    segmentId?: string;
    listId?: string;
}

type AudienceType = 'all' | 'segment' | 'list';
type WizardStep = 1 | 2 | 3 | 4;

interface ContactPreview {
    id: string;
    initials: string;
    name: string;
    email: string;
    totalSpent: string;
    totalSpentValue: number;
    orders: number;
    contactStatus: string;
}

interface CustomersApiItem {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    totalSpent?: number;
    ordersCount?: number;
    contactStatus?: string;
}

interface CustomersApiResponse {
    customers?: CustomersApiItem[];
    total?: number;
    totalPages?: number;
}

interface SegmentPreviewResponse {
    customers?: CustomersApiItem[];
    pagination?: {
        total?: number;
        totalPages?: number;
    };
}

interface ListMembersPreviewResponse {
    customers?: CustomersApiItem[];
    pagination?: {
        total?: number;
        totalPages?: number;
    };
}

interface FilterCondition {
    id: string;
    field: string;
    operator: string;
    value: string;
}

interface FilterGroup {
    id: string;
    combinator: 'AND' | 'OR';
    conditions: FilterCondition[];
}

const STEP_LABELS = ['Information', 'Contacts', 'Content', 'Review'] as const;
const CONTACT_STATUS_OPTIONS = [
    { value: 'SUBSCRIBED', label: 'Subscribed' },
    { value: 'UNVERIFIED', label: 'Unverified' },
    { value: 'UNSUBSCRIBED', label: 'Unsubscribed' },
    { value: 'SOFT_BOUNCED', label: 'Soft Bounced' },
    { value: 'BOUNCED', label: 'Bounced' },
    { value: 'COMPLAINT', label: 'Complaint' }
] as const;

export function CampaignsList({ onEdit }: { onEdit: (id: string, name: string, subject?: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();

    const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
    const [segments, setSegments] = useState<SegmentItem[]>([]);
    const [lists, setLists] = useState<EmailListItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<'all' | 'scheduled' | 'ongoing' | 'completed' | 'paused' | 'cancelled'>('all');
    const [query, setQuery] = useState('');

    const [showCreate, setShowCreate] = useState(false);
    const [wizardStep, setWizardStep] = useState<WizardStep>(1);
    const [audienceType, setAudienceType] = useState<AudienceType>('all');
    const [newItem, setNewItem] = useState<NewCampaignInput>({ name: '', subject: '' });
    const [includeUnverifiedContacts, setIncludeUnverifiedContacts] = useState(false);
    const [includeSoftBounceContacts, setIncludeSoftBounceContacts] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [contactPage, setContactPage] = useState(1);
    const [contactPageSize, setContactPageSize] = useState(10);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactRows, setContactRows] = useState<ContactPreview[]>([]);
    const [contactsTotal, setContactsTotal] = useState(0);
    const [contactsTotalPages, setContactsTotalPages] = useState(1);
    const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([
        {
            id: 'group-1',
            combinator: 'AND',
            conditions: [{ id: 'condition-1', field: 'Select', operator: 'is', value: '' }]
        }
    ]);
    const [appliedFilterGroups, setAppliedFilterGroups] = useState<FilterGroup[]>([
        {
            id: 'group-1',
            combinator: 'AND',
            conditions: [{ id: 'condition-1', field: 'Select', operator: 'is', value: '' }]
        }
    ]);

    const fetchLists = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/email/lists', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setLists(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            Logger.error('Failed to fetch email lists', { error });
        }
    }, [currentAccount, token]);

    const fetchSegments = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/segments', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                setSegments(await res.json());
            }
        } catch (error) {
            Logger.error('Failed to fetch segments', { error });
        }
    }, [currentAccount, token]);

    const fetchCampaigns = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/marketing/campaigns', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setCampaigns(Array.isArray(data) ? data : []);
            } else {
                setCampaigns([]);
            }
        } catch (error) {
            Logger.error('Failed to fetch campaigns', { error });
            setCampaigns([]);
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        void fetchCampaigns();
        void fetchSegments();
        void fetchLists();
    }, [fetchCampaigns, fetchLists, fetchSegments]);

    const statusTabs = useMemo(() => {
        const counts = {
            all: campaigns.length,
            scheduled: campaigns.filter((item) => item.status === 'SCHEDULED').length,
            ongoing: campaigns.filter((item) => item.status === 'SENDING').length,
            completed: campaigns.filter((item) => item.status === 'SENT').length,
            paused: campaigns.filter((item) => item.status === 'PAUSED').length,
            cancelled: campaigns.filter((item) => item.status === 'CANCELLED').length
        };

        return [
            { id: 'all', label: 'All', count: counts.all },
            { id: 'scheduled', label: 'Scheduled', count: counts.scheduled },
            { id: 'ongoing', label: 'Ongoing', count: counts.ongoing },
            { id: 'completed', label: 'Completed', count: counts.completed },
            { id: 'paused', label: 'Paused', count: counts.paused },
            { id: 'cancelled', label: 'Cancelled', count: counts.cancelled }
        ] as const;
    }, [campaigns]);

    const filteredCampaigns = useMemo(() => {
        const lowered = query.trim().toLowerCase();
        return campaigns.filter((item) => {
            const statusMatch =
                activeTab === 'all' ||
                (activeTab === 'scheduled' && item.status === 'SCHEDULED') ||
                (activeTab === 'ongoing' && item.status === 'SENDING') ||
                (activeTab === 'completed' && item.status === 'SENT') ||
                (activeTab === 'paused' && item.status === 'PAUSED') ||
                (activeTab === 'cancelled' && item.status === 'CANCELLED');

            const queryMatch =
                !lowered ||
                item.name.toLowerCase().includes(lowered) ||
                (item.subject || '').toLowerCase().includes(lowered);

            return statusMatch && queryMatch;
        });
    }, [activeTab, campaigns, query]);

    const selectedAudienceCount = useMemo(() => {
        if (audienceType === 'segment') {
            return segments.find((item) => item.id === newItem.segmentId)?._count?.campaigns || 0;
        }
        if (audienceType === 'list') {
            return lists.find((item) => item.id === newItem.listId)?._count?.memberships || 0;
        }
        return lists.reduce((total, item) => total + (item._count?.memberships || 0), 0);
    }, [audienceType, lists, newItem.listId, newItem.segmentId, segments]);

    const activeContactFilter = useMemo(() => {
        const conditions = appliedFilterGroups.flatMap((group) => group.conditions);
        const textCondition = conditions.find((item) => item.field === 'Email' || item.field === 'Name');
        const statusCondition = conditions.find((item) => item.field === 'Contact Status');
        return {
            q: textCondition?.value?.trim() || '',
            status: statusCondition?.value?.trim().toUpperCase() || 'SUBSCRIBED'
        };
    }, [appliedFilterGroups]);

    const activeFilterGroups = useMemo(() => {
        return appliedFilterGroups
            .map((group) => ({
                combinator: group.combinator,
                conditions: group.conditions
                    .filter((condition) => condition.field !== 'Select' && condition.value.trim().length > 0)
                    .map((condition) => ({
                        field: condition.field,
                        operator: condition.operator,
                        value: condition.value.trim()
                    }))
            }))
            .filter((group) => group.conditions.length > 0);
    }, [appliedFilterGroups]);

    const hasAdvancedStatusCondition = useMemo(() => {
        return activeFilterGroups.some((group) =>
            group.conditions.some((condition) =>
                condition.field === 'Contact Status' && condition.operator !== 'is'
            )
        );
    }, [activeFilterGroups]);

    const totalContactPages = Math.max(1, contactsTotalPages);

    function toPreviewContact(item: CustomersApiItem, index = 0): ContactPreview {
        const firstName = item.firstName?.trim() || '';
        const lastName = item.lastName?.trim() || '';
        const email = item.email?.trim() || 'no-email@example.com';
        const fallbackName = email.split('@')[0]?.replace(/[._-]/g, ' ') || 'Unknown Contact';
        const name = `${firstName} ${lastName}`.trim() || fallbackName;
        const words = name.split(' ').filter(Boolean);
        const initials = `${words[0]?.[0] || 'C'}${words[1]?.[0] || words[0]?.[1] || 'U'}`.toUpperCase();
        const totalSpentValue = Number(item.totalSpent || 0);
        return {
            id: item.id || `${email}-${index}`,
            initials,
            name,
            email,
            totalSpent: `$${totalSpentValue.toFixed(2)}`,
            totalSpentValue,
            orders: Number(item.ordersCount || 0),
            contactStatus: String(item.contactStatus || 'SUBSCRIBED').toUpperCase()
        };
    }

    const fetchContactPreview = useCallback(async () => {
        if (!currentAccount || !token || !showCreate || wizardStep !== 2) return;
        setContactsLoading(true);

        try {
            if (audienceType === 'segment' && newItem.segmentId) {
                const params = new URLSearchParams({ page: String(contactPage), pageSize: String(contactPageSize) });
                if (activeFilterGroups.length > 0) {
                    params.set('filters', JSON.stringify(activeFilterGroups));
                }
                const res = await fetch(`/api/segments/${newItem.segmentId}/preview?${params.toString()}`, {
                    headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
                });
                if (!res.ok) throw new Error('Failed segment preview');
                const data = await res.json() as SegmentPreviewResponse;
                const customers = Array.isArray(data.customers) ? data.customers : [];
                const mapped = customers.map((item, index) => toPreviewContact(item, index));
                setContactRows(mapped);
                setContactsTotal(data.pagination?.total || mapped.length);
                setContactsTotalPages(data.pagination?.totalPages || 1);
                return;
            }

            if (audienceType === 'list' && newItem.listId) {
                const params = new URLSearchParams({ page: String(contactPage), pageSize: String(contactPageSize) });
                if (activeFilterGroups.length > 0) {
                    params.set('filters', JSON.stringify(activeFilterGroups));
                }

                const res = await fetch(`/api/email/lists/${newItem.listId}/members?${params.toString()}`, {
                    headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
                });
                if (!res.ok) throw new Error('Failed list members');
                const data = await res.json() as ListMembersPreviewResponse;
                const customers = Array.isArray(data.customers) ? data.customers : [];
                const mapped = customers.map((item, index) => toPreviewContact(item, index));
                setContactRows(mapped);
                setContactsTotal(data.pagination?.total || mapped.length);
                setContactsTotalPages(data.pagination?.totalPages || 1);
                return;
            }

            const status = includeUnverifiedContacts || hasAdvancedStatusCondition ? 'ALL' : activeContactFilter.status;
            const params = new URLSearchParams({
                page: String(contactPage),
                limit: String(contactPageSize),
                q: activeContactFilter.q,
                status
            });
            if (activeFilterGroups.length > 0) {
                params.set('filters', JSON.stringify(activeFilterGroups));
            }

            const res = await fetch(`/api/customers?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
            });
            if (!res.ok) throw new Error('Failed customer preview');
            const data = await res.json() as CustomersApiResponse;
            const customers = Array.isArray(data.customers) ? data.customers : [];
            const filtered = includeSoftBounceContacts ? customers : customers.filter((item) => item.contactStatus !== 'SOFT_BOUNCED');
            const mapped = filtered.map((item, index) => toPreviewContact(item, index));
            setContactRows(mapped);
            setContactsTotal(data.total || filtered.length);
            setContactsTotalPages(data.totalPages || 1);
        } catch (error) {
            Logger.error('Failed to load contact preview', { error });
            setContactRows([]);
            setContactsTotal(0);
            setContactsTotalPages(1);
        } finally {
            setContactsLoading(false);
        }
    }, [activeContactFilter.q, activeContactFilter.status, activeFilterGroups, audienceType, contactPage, contactPageSize, currentAccount, hasAdvancedStatusCondition, includeSoftBounceContacts, includeUnverifiedContacts, newItem.listId, newItem.segmentId, showCreate, token, wizardStep]);

    useEffect(() => {
        void fetchContactPreview();
    }, [fetchContactPreview]);

    function getStatusPill(status: string) {
        if (status === 'SENT') return 'bg-emerald-100 text-emerald-700';
        if (status === 'SENDING') return 'bg-blue-100 text-blue-700';
        if (status === 'SCHEDULED') return 'bg-amber-100 text-amber-700';
        if (status === 'DRAFT') return 'bg-yellow-100 text-yellow-700';
        if (status === 'PAUSED') return 'bg-orange-100 text-orange-700';
        if (status === 'CANCELLED') return 'bg-rose-100 text-rose-700';
        return 'bg-gray-100 text-gray-600';
    }

    function formatDate(value?: string | null) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString([], { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function formatRate(openedCount: number, sentCount: number) {
        if (!sentCount) return '-';
        return `${((openedCount / sentCount) * 100).toFixed(2)}%`;
    }

    function formatRevenue(value?: number | null) {
        if (!value) return '-';
        return value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value.toFixed(2)}`;
    }

    function resetWizard() {
        setWizardStep(1);
        setAudienceType('all');
        setNewItem({ name: '', subject: '' });
        setIncludeUnverifiedContacts(false);
        setIncludeSoftBounceContacts(false);
        setContactPage(1);
        setContactPageSize(10);
        setFilterGroups([
            {
                id: 'group-1',
                combinator: 'AND',
                conditions: [{ id: 'condition-1', field: 'Select', operator: 'is', value: '' }]
            }
        ]);
        setAppliedFilterGroups([
            {
                id: 'group-1',
                combinator: 'AND',
                conditions: [{ id: 'condition-1', field: 'Select', operator: 'is', value: '' }]
            }
        ]);
    }

    function applyFilterChanges() {
        setAppliedFilterGroups(JSON.parse(JSON.stringify(filterGroups)) as FilterGroup[]);
        setContactPage(1);
        setShowFilters(false);
    }

    function addGroup(combinator: 'AND' | 'OR') {
        setFilterGroups((prev) => [
            ...prev,
            {
                id: `group-${Date.now()}`,
                combinator,
                conditions: [{ id: `condition-${Date.now()}`, field: 'Select', operator: 'is', value: '' }]
            }
        ]);
    }

    function addCondition(groupId: string) {
        setFilterGroups((prev) => prev.map((group) => {
            if (group.id !== groupId) return group;
            return {
                ...group,
                conditions: [...group.conditions, { id: `condition-${Date.now()}`, field: 'Select', operator: 'is', value: '' }]
            };
        }));
    }

    function updateCondition(groupId: string, conditionId: string, key: keyof FilterCondition, value: string) {
        setFilterGroups((prev) => prev.map((group) => {
            if (group.id !== groupId) return group;
            return {
                ...group,
                conditions: group.conditions.map((condition) => {
                    if (condition.id !== conditionId) return condition;
                    if (key === 'field') {
                        return {
                            ...condition,
                            field: value,
                            operator: getDefaultBroadcastOperator(value),
                            value: ''
                        };
                    }
                    return { ...condition, [key]: value };
                })
            };
        }));
    }

    async function handleCreateBroadcast() {
        if (!currentAccount) return;

        if (!newItem.name.trim()) {
            toast.error('Please provide a broadcast name');
            setWizardStep(1);
            return;
        }

        if (!newItem.subject.trim()) {
            toast.error('Please provide a subject line');
            setWizardStep(3);
            return;
        }

        if (audienceType === 'segment' && !newItem.segmentId) {
            toast.error('Please select a segment');
            setWizardStep(2);
            return;
        }

        if (audienceType === 'list' && !newItem.listId) {
            toast.error('Please select an email list');
            setWizardStep(2);
            return;
        }

        const payload: NewCampaignInput = { ...newItem };
        if (audienceType === 'all') {
            payload.segmentId = '';
            payload.listId = '';
        } else if (audienceType === 'segment') {
            payload.listId = '';
        } else {
            payload.segmentId = '';
        }

        try {
            const res = await fetch('/api/marketing/campaigns', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                toast.error(`Failed to create campaign: ${errorData.error || 'Unknown error'}`);
                return;
            }

            const data = await res.json();
            setShowCreate(false);
            resetWizard();
            onEdit(data.id, data.name, data.subject);
        } catch (error) {
            Logger.error('Failed to create campaign', { error });
            toast.error('Error creating campaign');
        }
    }

    async function handleDelete(id: string) {
        if (!currentAccount) return;
        try {
            await fetch(`/api/marketing/campaigns/${id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            setDeletingId(null);
            await fetchCampaigns();
            toast.success('Campaign deleted');
        } catch (error) {
            Logger.error('Failed to delete campaign', { error });
            toast.error('Failed to delete campaign');
        }
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="text-2xl font-semibold text-gray-900">Email Broadcasts</h2>
                    <p className="text-sm text-gray-500">{statusTabs[0].count} Results</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                >
                    <Plus size={16} /> Create Email Broadcast
                </button>
            </div>

            <div className="border-b border-gray-200">
                <div className="flex flex-wrap gap-1 pb-2">
                    {statusTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`rounded px-3 py-1.5 text-sm transition ${activeTab === tab.id ? 'bg-sky-100 text-sky-700' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                            {tab.label} <span className="ml-1 text-xs text-gray-500">{tab.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <label className="relative w-full lg:max-w-sm">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(sanitizeBidiText(event.target.value))}
                        placeholder="Search..."
                        className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 focus:border-sky-400 focus:outline-none"
                        dir="ltr"
                        style={LTR_TEXT_STYLE}
                    />
                </label>
                <button
                    onClick={() => void fetchCampaigns()}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
                >
                    Refresh
                </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <div className="overflow-x-auto">
                    <table className="min-w-[1100px] w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Created On</th>
                                <th className="px-4 py-3">Execution Date</th>
                                <th className="px-4 py-3">Sent</th>
                                <th className="px-4 py-3">Open Rate</th>
                                <th className="px-4 py-3">Click Rate</th>
                                <th className="px-4 py-3">Orders</th>
                                <th className="px-4 py-3">Revenue</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                                        <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading broadcasts...</span>
                                    </td>
                                </tr>
                            ) : filteredCampaigns.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-12 text-center text-gray-500">No broadcasts found.</td>
                                </tr>
                            ) : filteredCampaigns.map((campaign) => (
                                <tr key={campaign.id} className="border-t border-gray-100 hover:bg-slate-50/70">
                                    <td className="px-4 py-3">
                                        <button
                                            className="font-medium text-sky-700 hover:text-sky-800"
                                            onClick={() => onEdit(campaign.id, campaign.name, campaign.subject)}
                                        >
                                            {campaign.name}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">{formatDate(campaign.createdAt)}</td>
                                    <td className="px-4 py-3 text-gray-600">{formatDate(campaign.scheduledAt)}</td>
                                    <td className="px-4 py-3 text-gray-600">{campaign.sentCount || '-'}</td>
                                    <td className="px-4 py-3 text-gray-600">{formatRate(campaign.openedCount, campaign.sentCount)}</td>
                                    <td className="px-4 py-3 text-gray-600">{campaign.clickRate ? `${campaign.clickRate.toFixed(2)}%` : '-'}</td>
                                    <td className="px-4 py-3 text-gray-600">{campaign.orderCount || '-'}</td>
                                    <td className="px-4 py-3">
                                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{formatRevenue(campaign.revenue)}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusPill(campaign.status)}`}>
                                            {campaign.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            onClick={() => setDeletingId(campaign.id)}
                                            className="rounded p-1.5 text-rose-600 hover:bg-rose-50"
                                            aria-label="Delete campaign"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); resetWizard(); }} title="Create Email Broadcast" maxWidth="max-w-5xl">
                <div className="space-y-8">
                    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-2">
                        {STEP_LABELS.map((label, index) => {
                            const step = (index + 1) as WizardStep;
                            const isDone = step < wizardStep;
                            const isActive = step === wizardStep;
                            return (
                                <div key={label} className="flex min-w-0 flex-1 items-center">
                                    <button
                                        onClick={() => setWizardStep(step)}
                                        className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold ${isDone || isActive ? 'border-sky-600 bg-sky-600 text-white' : 'border-gray-300 bg-white text-gray-500'}`}
                                    >
                                        {isDone ? <Check size={14} /> : step}
                                    </button>
                                    <div className={`ml-2 text-sm ${isActive ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</div>
                                    {index < STEP_LABELS.length - 1 && <div className="mx-4 h-px flex-1 bg-gray-200" />}
                                </div>
                            );
                        })}
                    </div>

                    <div className="rounded-xl border border-gray-200">
                        <div className="border-b border-gray-200 bg-gray-50 px-5 py-3 text-sm font-semibold text-gray-800">
                            {STEP_LABELS[wizardStep - 1]}
                        </div>

                        <div className="p-5">
                            {wizardStep === 1 && (
                                <div className="space-y-5">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                                        <input
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                            value={newItem.name}
                                            onChange={(event) => setNewItem((prev) => ({ ...prev, name: sanitizeBidiText(event.target.value) }))}
                                            placeholder="Mother's Day Reminder"
                                            dir="ltr"
                                            style={LTR_TEXT_STYLE}
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <div className="text-sm font-medium text-gray-700">Type</div>
                                        <div className="flex items-center gap-2">
                                            <button className="rounded-lg border border-sky-600 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700">Standard</button>
                                            <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-500" disabled>A/B Test</button>
                                        </div>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input type="checkbox" checked={includeUnverifiedContacts} onChange={(event) => setIncludeUnverifiedContacts(event.target.checked)} />
                                        Include unverified contacts
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input type="checkbox" checked={includeSoftBounceContacts} onChange={(event) => setIncludeSoftBounceContacts(event.target.checked)} />
                                        Include soft bounce contacts
                                    </label>
                                </div>
                            )}

                            {wizardStep === 2 && (
                                <div className="space-y-5">
                                    <div className="flex flex-wrap items-end justify-between gap-3">
                                        <div className="flex flex-wrap items-end gap-3">
                                        <div className="w-56">
                                            <label className="mb-1 block text-sm font-medium text-gray-700">Audience</label>
                                            <select
                                                value={audienceType}
                                                onChange={(event) => {
                                                    const next = event.target.value as AudienceType;
                                                    setAudienceType(next);
                                                    setNewItem((prev) => ({ ...prev, segmentId: '', listId: '' }));
                                                }}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                            >
                                                <option value="all">All Customers</option>
                                                <option value="segment">Segment</option>
                                                <option value="list">Email List</option>
                                            </select>
                                        </div>

                                        {audienceType === 'segment' && (
                                            <div className="w-72">
                                                <label className="mb-1 block text-sm font-medium text-gray-700">Segment</label>
                                                <select
                                                    value={newItem.segmentId || ''}
                                                    onChange={(event) => setNewItem((prev) => ({ ...prev, segmentId: event.target.value }))}
                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                                >
                                                    <option value="">Select segment</option>
                                                    {segments.map((segment) => (
                                                        <option key={segment.id} value={segment.id}>{segment.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {audienceType === 'list' && (
                                            <div className="w-72">
                                                <label className="mb-1 block text-sm font-medium text-gray-700">Email List</label>
                                                <select
                                                    value={newItem.listId || ''}
                                                    onChange={(event) => setNewItem((prev) => ({ ...prev, listId: event.target.value }))}
                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                                >
                                                    <option value="">Select list</option>
                                                    {lists.map((list) => (
                                                        <option key={list.id} value={list.id}>{list.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        </div>
                                        <button
                                            onClick={() => setShowFilters(true)}
                                            className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            <SlidersHorizontal size={14} /> Apply Filters
                                        </button>
                                    </div>

                                    <div className="rounded-lg border border-gray-200">
                                        <div className="grid grid-cols-3 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                            <div>Audience</div>
                                            <div>Selection</div>
                                            <div>Estimated Contacts</div>
                                        </div>
                                        <div className="grid grid-cols-3 px-4 py-3 text-sm text-gray-700">
                                            <div>{audienceType}</div>
                                            <div>{newItem.segmentId || newItem.listId || 'All subscribed contacts'}</div>
                                            <div>{selectedAudienceCount || '-'}</div>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-gray-200">
                                        <div className="border-b border-gray-200 bg-slate-50 px-4 py-2">
                                            <h4 className="text-sm font-semibold text-slate-900">Subscribed Contacts ({contactsTotal})</h4>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-[700px] w-full text-sm">
                                                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left">Contact</th>
                                                        <th className="px-4 py-2 text-left">Details</th>
                                                        <th className="px-4 py-2 text-left">Total Spent</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {contactsLoading ? (
                                                        <tr>
                                                            <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                                                                <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading contacts...</span>
                                                            </td>
                                                        </tr>
                                                    ) : contactRows.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={3} className="px-4 py-8 text-center text-gray-500">No contacts found for this audience.</td>
                                                        </tr>
                                                    ) : contactRows.map((contact) => (
                                                        <tr key={contact.id} className="border-t border-gray-100">
                                                            <td className="px-4 py-2.5">
                                                                <div className="flex items-center gap-3">
                                                                    <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-gray-300 text-sky-600" />
                                                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-xs font-semibold text-white">{contact.initials}</div>
                                                                    <span className="font-medium text-sky-700">{contact.name}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-2.5 text-gray-600">{contact.email}</td>
                                                            <td className="px-4 py-2.5 text-gray-700">{contact.totalSpent} | {contact.orders} order{contact.orders > 1 ? 's' : ''}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600 lg:flex-row lg:items-center lg:justify-between">
                                            <div className="inline-flex items-center gap-3">
                                                <span>Page {contactPage} of {totalContactPages}</span>
                                                <button
                                                    onClick={() => setContactPage((prev) => Math.max(1, prev - 1))}
                                                    disabled={contactPage === 1}
                                                    className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                                                >
                                                    <ChevronLeft size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setContactPage((prev) => Math.min(totalContactPages, prev + 1))}
                                                    disabled={contactPage === totalContactPages}
                                                    className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                                                >
                                                    <ChevronRight size={14} />
                                                </button>
                                                <span>Viewing {contactsTotal === 0 ? 0 : (contactPage - 1) * contactPageSize + 1}-{Math.min(contactPage * contactPageSize, contactsTotal)} of {contactsTotal} results</span>
                                            </div>
                                            <div className="inline-flex items-center gap-2">
                                                <select
                                                    value={contactPageSize}
                                                    onChange={(event) => {
                                                        const next = Number(event.target.value);
                                                        setContactPageSize(next);
                                                        setContactPage(1);
                                                    }}
                                                    className="rounded border border-gray-300 px-2 py-1"
                                                >
                                                    <option value={10}>10</option>
                                                    <option value={25}>25</option>
                                                    <option value={50}>50</option>
                                                </select>
                                                <span>Per Page</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {wizardStep === 3 && (
                                <div className="space-y-5">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
                                        <input
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                            value={newItem.subject}
                                            onChange={(event) => setNewItem((prev) => ({ ...prev, subject: sanitizeBidiText(event.target.value) }))}
                                            placeholder="Enter subject"
                                            dir="ltr"
                                            style={LTR_TEXT_STYLE}
                                        />
                                    </div>
                                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                                        Template and body content are edited in the email designer after this setup.
                                    </div>
                                </div>
                            )}

                            {wizardStep === 4 && (
                                <div className="space-y-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                                    <div><span className="font-semibold">Name:</span> {newItem.name || '-'}</div>
                                    <div><span className="font-semibold">Subject:</span> {newItem.subject || '-'}</div>
                                    <div><span className="font-semibold">Audience:</span> {audienceType}</div>
                                    <div><span className="font-semibold">Estimated Contacts:</span> {selectedAudienceCount || '-'}</div>
                                    <div className="text-xs text-gray-500">Click Create Broadcast to save and continue to the visual email editor.</div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setWizardStep((prev) => (prev === 1 ? prev : (prev - 1) as WizardStep))}
                            className="inline-flex items-center gap-1 rounded-lg border border-sky-600 px-4 py-2 text-sm font-medium text-sky-700 disabled:opacity-40"
                            disabled={wizardStep === 1}
                        >
                            <ChevronLeft size={14} /> Previous
                        </button>

                        {wizardStep < 4 ? (
                            <button
                                onClick={() => setWizardStep((prev) => (prev + 1) as WizardStep)}
                                className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                            >
                                Next <ChevronRight size={14} />
                            </button>
                        ) : (
                            <button
                                onClick={() => void handleCreateBroadcast()}
                                className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                            >
                                Create Broadcast
                            </button>
                        )}
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={showFilters}
                onClose={() => setShowFilters(false)}
                title={(
                    <div className="flex w-full items-center justify-between gap-3">
                        <span>Filters</span>
                        <button className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                            Use Audiences <ChevronDown size={14} />
                        </button>
                    </div>
                )}
                maxWidth="max-w-6xl"
            >
                <div className="space-y-5">
                    <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
                        <div className="space-y-3">
                            {filterGroups.map((group) => (
                                <div key={group.id} className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.combinator} Condition</div>
                                    <div className="space-y-2">
                                        {group.conditions.map((condition) => (
                                            <div key={condition.id} className="grid gap-2 lg:grid-cols-[120px_110px_1fr]">
                                                <select
                                                    value={condition.field}
                                                    onChange={(event) => updateCondition(group.id, condition.id, 'field', event.target.value)}
                                                    className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
                                                >
                                                    <option>Select</option>
                                                    <option>Name</option>
                                                    <option>Email</option>
                                                    <option>Contact Status</option>
                                                    <option>Total Spent</option>
                                                    <option>Orders</option>
                                                </select>
                                                <select
                                                    value={condition.operator}
                                                    onChange={(event) => updateCondition(group.id, condition.id, 'operator', event.target.value)}
                                                    className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
                                                >
                                                    {getBroadcastOperators(condition.field).map((operator) => (
                                                        <option key={operator} value={operator}>{operator}</option>
                                                    ))}
                                                </select>
                                                {isBroadcastContactStatusField(condition.field) ? (
                                                    <select
                                                        value={condition.value}
                                                        onChange={(event) => updateCondition(group.id, condition.id, 'value', event.target.value)}
                                                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                    >
                                                        <option value="">Select status</option>
                                                        {CONTACT_STATUS_OPTIONS.map((statusOption) => (
                                                            <option key={statusOption.value} value={statusOption.value}>{statusOption.label}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        value={condition.value}
                                                        onChange={(event) => updateCondition(group.id, condition.id, 'value', sanitizeBidiText(event.target.value))}
                                                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                        placeholder="Value (ex. SUBSCRIBED or john@shop.com)"
                                                        dir="ltr"
                                                        style={LTR_TEXT_STYLE}
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => addCondition(group.id)}
                                        className="mt-3 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        {group.combinator} Condition
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => addGroup('AND')}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
                        >
                            AND Condition
                        </button>
                        <button
                            onClick={() => addGroup('OR')}
                            className="rounded-lg border border-sky-500 px-3 py-2 text-sm font-medium text-sky-700"
                        >
                            OR Condition
                        </button>
                    </div>

                    <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
                        <button className="rounded-lg border border-sky-500 px-4 py-2 text-sm font-medium text-sky-700">Save as Audience</button>
                        <button
                            onClick={applyFilterChanges}
                            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                        >
                            Filter
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={!!deletingId}
                onClose={() => setDeletingId(null)}
                title="Delete Campaign"
                maxWidth="max-w-sm"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">Are you sure you want to delete this campaign? This action cannot be undone.</p>
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setDeletingId(null)}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700"
                        >
                            <X size={14} /> Cancel
                        </button>
                        <button
                            onClick={() => deletingId && void handleDelete(deletingId)}
                            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
