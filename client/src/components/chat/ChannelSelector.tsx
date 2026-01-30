import { useState, useRef, useEffect } from 'react';
import { Mail, MessageSquare, Facebook, Music, ChevronDown, Smartphone } from 'lucide-react';
import { cn } from '../../utils/cn';

export type ConversationChannel = 'EMAIL' | 'CHAT' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'SMS';

interface ChannelOption {
    channel: ConversationChannel;
    identifier: string; // e.g., email address, username, or page name
    available: boolean;
}

interface ChannelSelectorProps {
    channels: ChannelOption[];
    selectedChannel: ConversationChannel;
    onChannelChange: (channel: ConversationChannel) => void;
    disabled?: boolean;
}

// Instagram icon component (Lucide doesn't have one)
function Instagram({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            className={className}
            fill="currentColor"
        >
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
    );
}

const CHANNEL_CONFIG: Record<ConversationChannel, { icon: React.ElementType; label: string; color: string }> = {
    EMAIL: { icon: Mail, label: 'Email', color: 'text-blue-600' },
    CHAT: { icon: MessageSquare, label: 'Live Chat', color: 'text-green-600' },
    FACEBOOK: { icon: Facebook, label: 'Facebook', color: 'text-[#1877F2]' },
    INSTAGRAM: { icon: Instagram, label: 'Instagram', color: 'text-[#E4405F]' },
    TIKTOK: { icon: Music, label: 'TikTok', color: 'text-black' },
    SMS: { icon: Smartphone, label: 'SMS', color: 'text-purple-600' },
};

export function ChannelSelector({
    channels,
    selectedChannel,
    onChannelChange,
    disabled = false
}: ChannelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Filter to only available channels
    const availableChannels = channels.filter(c => c.available);
    const selected = channels.find(c => c.channel === selectedChannel);
    const config = CHANNEL_CONFIG[selectedChannel];

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Only show static display if no channels available (fallback)
    if (availableChannels.length === 0) {
        const Icon = config.icon;
        return (
            <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="text-gray-400 w-8">TO</span>
                <Icon size={16} className={config.color} />
                <span>{selected?.identifier || config.label}</span>
            </div>
        );
    }

    const Icon = config.icon;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm",
                    "hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500",
                    disabled && "opacity-50 cursor-not-allowed",
                    isOpen && "bg-gray-50 ring-2 ring-blue-500"
                )}
            >
                <span className="text-gray-400 text-xs uppercase font-medium">To</span>
                <div className="flex items-center gap-2 min-w-0">
                    <Icon size={16} className={config.color} />
                    <span className="font-medium text-gray-700 truncate max-w-[200px]">
                        {selected?.identifier || config.label}
                    </span>
                </div>
                <ChevronDown
                    size={14}
                    className={cn(
                        "text-gray-400 transition-transform",
                        isOpen && "rotate-180"
                    )}
                />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                    <div className="px-3 py-2 border-b border-gray-100">
                        <span className="text-xs font-medium text-gray-500 uppercase">
                            Reply via
                        </span>
                    </div>
                    {availableChannels.map((option) => {
                        const optConfig = CHANNEL_CONFIG[option.channel];
                        const OptIcon = optConfig.icon;
                        const isSelected = option.channel === selectedChannel;

                        return (
                            <button
                                key={option.channel}
                                type="button"
                                onClick={() => {
                                    onChannelChange(option.channel);
                                    setIsOpen(false);
                                }}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors",
                                    isSelected && "bg-blue-50"
                                )}
                            >
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center",
                                    isSelected ? "bg-blue-100" : "bg-gray-100"
                                )}>
                                    <OptIcon size={16} className={optConfig.color} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900">
                                        {optConfig.label}
                                    </div>
                                    <div className="text-xs text-gray-500 truncate">
                                        {option.identifier}
                                    </div>
                                </div>
                                {isSelected && (
                                    <div className="w-2 h-2 rounded-full bg-blue-600" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
