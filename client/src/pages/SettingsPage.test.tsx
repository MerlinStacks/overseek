import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';

const featureFlags: Record<string, boolean> = {
    GOLD_PRICE_CALCULATOR: true,
    AD_TRACKING: true,
    AI_WRITER: true,
};

vi.mock('../context/AccountContext', () => ({
    useAccount: () => ({
        currentAccount: {
            id: 'acc-1',
            name: 'Test Account',
            features: [],
        },
    }),
}));

vi.mock('../hooks/useAccountFeature', () => ({
    useAccountFeature: (featureKey: string) => Boolean(featureFlags[featureKey]),
}));

vi.mock('../components/sync/SyncStatus', () => ({ SyncStatus: () => <div>Sync Status Content</div> }));
vi.mock('../components/chat/ChatSettings', () => ({ ChatSettings: () => <div>Chat Settings Content</div> }));
vi.mock('../components/settings/AISettings', () => ({ AISettings: () => <div>AI Settings Content</div> }));
vi.mock('../components/settings/TrackingScriptHelper', () => ({ TrackingScriptHelper: () => <div>Tracking Script Helper</div> }));
vi.mock('../components/settings/AppearanceSettings', () => ({ AppearanceSettings: () => <div>Appearance Settings Content</div> }));
vi.mock('../components/settings/GeneralSettings', () => ({ GeneralSettings: () => <div>General Settings Content</div> }));
vi.mock('../components/settings/EmailSettings', () => ({ EmailSettings: () => <div>Email Settings Content</div> }));
vi.mock('../components/settings/GoldPriceSettings', () => ({ GoldPriceSettings: () => <div>Gold Price Settings Content</div> }));
vi.mock('../components/settings/InventoryAlertsSettings', () => ({ InventoryAlertsSettings: () => <div>Inventory Settings Content</div> }));
vi.mock('../components/settings/OrderTagSettings', () => ({ OrderTagSettings: () => <div>Order Tag Settings Content</div> }));
vi.mock('../components/settings/NotificationSettings', () => ({ NotificationSettings: () => <div>Notification Settings Content</div> }));
vi.mock('../components/settings/SocialChannelsSettings', () => ({ SocialChannelsSettings: () => <div>Social Channels Content</div> }));
vi.mock('../components/settings/TeamSettings', () => ({ TeamSettings: () => <div>Team Settings Content</div> }));
vi.mock('../components/settings/RoleManager', () => ({ default: () => <div>Role Manager Content</div> }));
vi.mock('../components/settings/WebhookSettings', () => ({ WebhookSettings: () => <div>Webhook Settings Content</div> }));
vi.mock('../components/settings/AdAccountSettings', () => ({ AdAccountSettings: () => <div>Ad Account Settings Content</div> }));
vi.mock('../components/settings/CannedResponsesSettings', () => ({ CannedResponsesSettings: () => <div>Canned Responses Content</div> }));
vi.mock('../components/settings/TrackingExclusionSettings', () => ({ TrackingExclusionSettings: () => <div>Tracking Exclusions Content</div> }));
vi.mock('../components/settings/CAPISettings', () => ({ CAPISettings: () => <div>CAPI Settings Content</div> }));
vi.mock('../components/ui/PageSkeletons', () => ({ SettingsPageSkeleton: () => <div>Settings Skeleton</div> }));

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-search">{location.search}</div>;
}

function renderSettings(initialEntry = '/settings') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
                <Route
                    path="/settings"
                    element={(
                        <>
                            <SettingsPage />
                            <LocationProbe />
                        </>
                    )}
                />
            </Routes>
        </MemoryRouter>
    );
}

describe('SettingsPage tab behavior', () => {
    beforeEach(() => {
        featureFlags.GOLD_PRICE_CALCULATOR = true;
        featureFlags.AD_TRACKING = true;
        featureFlags.AI_WRITER = true;
    });

    it('loads the tab from URL query string', async () => {
        renderSettings('/settings?tab=email');

        expect((await screen.findAllByText('Email Settings Content')).length).toBeGreaterThan(0);
        expect(screen.getByTestId('location-search')).toHaveTextContent('tab=email');
    });

    it('updates URL query when a tab is clicked', async () => {
        renderSettings('/settings');

        const user = userEvent.setup();
        const emailButtons = screen.getAllByRole('button', { name: /Email/i });
        await user.click(emailButtons[0]);

        await waitFor(() => {
            expect(screen.getByTestId('location-search')).toHaveTextContent('tab=email');
        });
        expect(screen.getAllByText('Email Settings Content').length).toBeGreaterThan(0);
    });

    it('falls back to first visible tab when URL points to a hidden tab', async () => {
        featureFlags.AD_TRACKING = false;

        renderSettings('/settings?tab=conversions');

        await waitFor(() => {
            expect(screen.getByTestId('location-search')).toHaveTextContent('tab=general');
        });
        expect(screen.getAllByText('General Settings Content').length).toBeGreaterThan(0);
    });
});
