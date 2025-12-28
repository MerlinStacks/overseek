import { useState, useMemo } from 'react';

export const useSortableData = (items, config = null) => {
    const [sortConfig, setSortConfig] = useState(config);

    const sortedItems = useMemo(() => {
        let sortableItems = [...items];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const getValue = (obj, path) => {
                    if (!path) return '';
                    return path.split('.').reduce((o, k) => (o || {})[k], obj);
                };

                let aValue = getValue(a, sortConfig.key);
                let bValue = getValue(b, sortConfig.key);

                // Basic null handling
                if (aValue === null || aValue === undefined) aValue = '';
                if (bValue === null || bValue === undefined) bValue = '';

                // Numeric check
                const aNum = parseFloat(aValue);
                const bNum = parseFloat(bValue);
                if (!isNaN(aNum) && !isNaN(bNum) && isFinite(aValue) && isFinite(bValue)) {
                    aValue = aNum;
                    bValue = bNum;
                } else {
                    // String case insensitive sort
                    if (typeof aValue === 'string') {
                        aValue = aValue.toLowerCase();
                    }
                    if (typeof bValue === 'string') {
                        bValue = bValue.toString().toLowerCase();
                    }
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [items, sortConfig]);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (
            sortConfig &&
            sortConfig.key === key &&
            sortConfig.direction === 'ascending'
        ) {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    return { items: sortedItems, requestSort, sortConfig };
};
