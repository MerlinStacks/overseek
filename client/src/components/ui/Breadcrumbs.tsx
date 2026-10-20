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
        <nav aria-label="Breadcrumb" className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            <ol className="flex flex-wrap items-center gap-1.5">
            {items.map((item, i) => {
                const isLast = i === items.length - 1;
                return (
                    <li key={i} className="flex min-w-0 items-center gap-1.5 break-words">
                        {i > 0 && <ChevronRight aria-hidden="true" size={14} className="shrink-0 text-gray-300 dark:text-gray-600" />}
                        {isLast || !item.href ? (
                            <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'text-gray-900 dark:text-white font-medium' : ''}>{item.label}</span>
                        ) : (
                            <Link to={item.href} className="hover:text-gray-900 dark:hover:text-white transition-colors">{item.label}</Link>
                        )}
                    </li>
                );
            })}
            </ol>
        </nav>
    );
}
