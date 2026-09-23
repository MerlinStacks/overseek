import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ShippingTransitGrid } from './ShippingTransitGrid';
import { responseFixture } from './fixtures.test-support';
import { settingsErrors } from './validation';
import type { DeliverySettings } from './types';

it('edits explicit WBS policy and selects the exact mapping identity as default', () => {
    let latest: DeliverySettings = responseFixture().settings;
    latest.shippingMethods = [{ ...latest.shippingMethods[0], methodId: 'wbs', instanceId: 0 }];
    latest.defaultMethod = null;
    function Form() {
        const [settings, setSettings] = useState(latest);
        return <ShippingTransitGrid settings={settings} onChange={value => { latest = value; setSettings(value); }} />;
    }
    render(<Form />);
    expect(screen.getByText(/Unverified WBS policy/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Row 1 mapping policy'), { target: { value: 'all_provider_rates' } });
    expect(settingsErrors(latest).some(error => error.includes('explicitly confirm'))).toBe(true);
    fireEvent.click(screen.getByLabelText(/I confirm every option/));
    expect(settingsErrors(latest)).toEqual([]);
    fireEvent.change(screen.getByLabelText('Row 1 mapping policy'), { target: { value: 'exact_rate' } });
    fireEvent.change(screen.getByLabelText('Row 1 actual rate ID'), { target: { value: 'wbs:opaque/standard?x=1' } });
    fireEvent.change(screen.getByLabelText('Default product-page method'), { target: { value: 'wbs:0|exact_rate|wbs:opaque/standard?x=1' } });
    expect(latest.defaultMethod).toEqual({ methodId: 'wbs', instanceId: 0, mappingKind: 'exact_rate', rateId: 'wbs:opaque/standard?x=1' });
    expect(settingsErrors(latest)).toEqual([]);
});
