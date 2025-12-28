import { describe, it, expect, vi } from 'vitest';
import { getBackupDryRun } from '../services/backupService';

// Mock DB because backupService checks db[tableName] existence
vi.mock('../db/db', () => ({
    db: {
        settings: {},
        automations: {},
        // 'unknown_table' is NOT here
    }
}));

describe('Backup Service', () => {
    it('analyzes backup file correctly', async () => {
        const mockData = {
            meta: { timestamp: '2023-01-01' },
            tables: {
                settings: [{ id: 1, key: 'test', value: '123' }],
                automations: [{ id: 1, name: 'Auto 1' }, { id: 2, name: 'Auto 2' }],
                unknown_table: [{ id: 1 }] // Should generate warning
            }
        };

        const file = new File([JSON.stringify(mockData)], 'backup.json', { type: 'application/json' });

        const summary = await getBackupDryRun(file);

        expect(summary.isValid).toBe(true);
        expect(summary.tables.settings).toBe(1);
        expect(summary.tables.automations).toBe(2);

        // Validation check
        expect(summary.warnings.length).toBeGreaterThan(0);
        expect(summary.warnings[0]).toContain('unknown table');
    });

    it('rejects invalid json', async () => {
        const file = new File(['{ invalid json'], 'bad.json', { type: 'application/json' });
        await expect(getBackupDryRun(file)).rejects.toThrow();
    });
});
