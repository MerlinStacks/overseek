/** Test-only stand-in for the plugin installed exclusively in native builds. */
import { vi } from 'vitest';
export const ImpactStyle = { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' };
export const NotificationType = { Success: 'SUCCESS', Error: 'ERROR', Warning: 'WARNING' };
export const Haptics = {
    impact: vi.fn(async () => {}), notification: vi.fn(async () => {}),
    selectionStart: vi.fn(async () => {}), selectionChanged: vi.fn(async () => {}), selectionEnd: vi.fn(async () => {}),
};
