import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

interface BreadcrumbItem {
    label: string;
    href?: string;
}

interface BreadcrumbsProps {
    items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
    if (items.length === 0) return null;

    return (
        <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-4">
            {items.map((item, i) => {
                const isLast = i === items.length - 1;
                return (
                    <span key={i} className="flex items-center gap-1.5">
                        {i > 0 && <ChevronRight size={14} className="text-gray-300 dark:text-gray-600" />}
                        {isLast || !item.href ? (
                            <span className={isLast ? 'text-gray-900 dark:text-white font-medium' : ''}>{item.label}</span>
                        ) : (
                            <Link to={item.href} className="hover:text-gray-900 dark:hover:text-white transition-colors">{item.label}</Link>
                        )}
                    </span>
                );
            })}
        </nav>
    );
}
