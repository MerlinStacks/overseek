
import { useState } from 'react';
import {
    User, Mail,
    MoreVertical,
    ChevronDown, ChevronRight
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { format } from 'date-fns';

interface ContactPanelProps {
    conversation?: {
        id: string;
        status: string;
        priority?: string;
        createdAt: string;
        updatedAt: string;
        wooCustomer?: {
            id: string;
            firstName?: string;
            lastName?: string;
            email?: string;
            totalSpent?: number;
            ordersCount?: number;
        };
        guestEmail?: string;
        guestName?: string;
        assignee?: {
            id: string;
            fullName?: string;
            avatarUrl?: string;
        };
        _count?: {
            messages: number;
        };
    };
}

interface SectionProps {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-100">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
                {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
            </button>
            {isOpen && (
                <div className="px-4 pb-4">
                    {children}
                </div>
            )}
        </div>
    );
}

export function ContactPanel({ conversation }: ContactPanelProps) {
    if (!conversation) return null;

    const customer = conversation.wooCustomer;
    const name = customer
        ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email || 'Anonymous'
        : conversation.guestName || conversation.guestEmail || 'Anonymous';
    const email = customer?.email || conversation.guestEmail;
    const initials = (name || 'A').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'OPEN': return 'bg-green-100 text-green-700';
            case 'CLOSED': return 'bg-gray-100 text-gray-700';
            case 'SNOOZED': return 'bg-yellow-100 text-yellow-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    const getPriorityColor = (priority?: string) => {
        switch (priority) {
            case 'HIGH': return 'text-red-600';
            case 'MEDIUM': return 'text-yellow-600';
            case 'LOW': return 'text-green-600';
            default: return 'text-gray-500';
        }
    };

    return (
        <div className="w-80 border-l border-gray-200 bg-white hidden lg:flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-700">Contact</span>
                <button className="p-1 rounded hover:bg-gray-100 text-gray-400">
                    <MoreVertical size={16} />
                </button>
            </div>

            {/* Contact Card */}
            <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{name}</h3>
                        {email && (
                            <a href={`mailto:${email}`} className="text-sm text-blue-600 hover:underline flex items-center gap-1 truncate">
                                <Mail size={12} />
                                {email}
                            </a>
                        )}
                    </div>
                </div>

                {/* Quick Stats for WooCustomer */}
                {customer && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-semibold text-gray-900">{customer.ordersCount || 0}</div>
                            <div className="text-xs text-gray-500">Orders</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-semibold text-gray-900">
                                ${(customer.totalSpent || 0).toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">Spent</div>
                        </div>
                    </div>
                )}

                {/* Not a customer indicator */}
                {!customer && (
                    <div className="mt-3 text-xs text-gray-500 flex items-center gap-1">
                        <User size={12} />
                        Not linked to a customer
                    </div>
                )}
            </div>


            {/* Scrollable Sections */}
            <div className="flex-1 overflow-y-auto">

                {/* Conversation Info */}
                <Section title="Conversation Information" defaultOpen={true}>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Status</span>
                            <span className={cn("px-2 py-0.5 rounded text-xs font-medium", getStatusColor(conversation.status))}>
                                {conversation.status}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Priority</span>
                            <span className={cn("font-medium", getPriorityColor(conversation.priority))}>
                                {conversation.priority || 'Normal'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Assignee</span>
                            <span className="text-gray-900">
                                {conversation.assignee?.fullName || 'Unassigned'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Messages</span>
                            <span className="text-gray-900">{conversation._count?.messages || 0}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Created</span>
                            <span className="text-gray-900 text-xs">
                                {format(new Date(conversation.createdAt), 'MMM d, yyyy')}
                            </span>
                        </div>
                    </div>
                </Section>

                {/* Auto-reopen notice */}
                <div className="px-4 py-3 bg-blue-50 text-xs text-blue-700">
                    <strong>Note:</strong> Resolved conversations will automatically reopen when the customer replies.
                </div>

                {/* Contact Attributes for WooCustomer */}
                {customer && (
                    <Section title="Contact Attributes" defaultOpen={false}>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Customer ID</span>
                                <span className="text-gray-900 font-mono text-xs">{customer.id.slice(0, 8)}...</span>
                            </div>
                        </div>
                    </Section>
                )}

                {/* Contact Notes */}
                <Section title="Contact Notes" defaultOpen={false}>
                    <div className="text-sm text-gray-500 italic">
                        No notes added yet.
                    </div>
                    <button className="mt-2 text-xs text-blue-600 hover:underline">
                        + Add note
                    </button>
                </Section>

                {/* Previous Conversations */}
                <Section title="Previous Conversations" defaultOpen={false}>
                    <div className="text-sm text-gray-500 italic">
                        No previous conversations found.
                    </div>
                </Section>
            </div>
        </div>
    );
}
