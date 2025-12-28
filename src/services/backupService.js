import { db } from '../db/db';

const BACKUP_VERSION = 1;

// Tables that we explicitly support backing up.
// Transient data like Products/Orders/Customers are NOT backed up as they should be re-synced from WC.
const SUPPORTED_TABLES = [
    'settings',
    'automations',
    'segments',
    'customer_notes',
    'reports',
    'invoice_layouts',
    'custom_reports',
    'email_templates',
    'suppliers',
    'purchase_orders',
    'product_components'
];

export const exportDatabase = async () => {
    try {
        const exportData = {
            meta: {
                version: BACKUP_VERSION,
                timestamp: new Date().toISOString(),
                appVersion: 21, // Current DB Schema Version reference
                tablesIncluded: []
            },
            tables: {}
        };

        for (const table of SUPPORTED_TABLES) {
            // Check if table exists in current DB instance to avoid errors
            if (db[table]) {
                const data = await db[table].toArray();
                if (data.length > 0) {
                    exportData.tables[table] = data;
                    exportData.meta.tablesIncluded.push(table);
                }
            }
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `woodash_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    } catch (e) {
        console.error("Export failed", e);
        throw e;
    }
};

/**
 * Reads a backup file and returns a summary of what's inside.
 * Does NOT modify the database.
 * Used for the "Dry Run" / Confirmation UI.
 */
export const getBackupDryRun = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);

                // 1. Basic Structure Validation
                if (!json.tables || typeof json.tables !== 'object') {
                    throw new Error("Invalid backup format: Missing 'tables' object.");
                }

                // Support legacy/v1 backups that didn't have 'meta'
                const meta = json.meta || { version: 1, timestamp: 'Unknown' };

                const summary = {
                    isValid: true,
                    meta: meta,
                    tables: {},
                    totalRecords: 0,
                    warnings: []
                };

                // 2. Table Analysis
                for (const [tableName, rows] of Object.entries(json.tables)) {
                    // Check if table exists in current schema
                    if (!db[tableName]) {
                        summary.warnings.push(`Skipping unknown table: '${tableName}'`);
                        continue;
                    }

                    if (!Array.isArray(rows)) {
                        summary.warnings.push(`Skipping malformed table data: '${tableName}'`);
                        continue;
                    }

                    summary.tables[tableName] = rows.length;
                    summary.totalRecords += rows.length;
                }

                resolve(summary);
            } catch (err) {
                reject(new Error("Failed to parse backup file: " + err.message));
            }
        };

        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
};

export const importDatabase = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.tables) throw new Error("Invalid backup file format");

                // Transactional Write
                const tableNames = Object.keys(data.tables).filter(t => db[t]); // Filter only existing tables in current DB

                if (tableNames.length === 0) {
                    throw new Error("No matching tables found to import.");
                }

                await db.transaction('rw', tableNames.map(t => db[t]), async () => {
                    for (const tableName of tableNames) {
                        const rows = data.tables[tableName];
                        if (Array.isArray(rows) && rows.length > 0) {
                            await db[tableName].clear();
                            await db[tableName].bulkAdd(rows);
                        }
                    }
                });

                resolve(true);
            } catch (err) {
                reject(err);
            }
        };

        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
};
