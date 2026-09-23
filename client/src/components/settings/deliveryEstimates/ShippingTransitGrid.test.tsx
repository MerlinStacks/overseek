import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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

it('keeps names and provider identity read-only while allowing transit edits, toggling and removal', () => {
    let latest = responseFixture().settings;
    const original = { ...latest.shippingMethods[0] };
    function Form() {
        const [settings, setSettings] = useState(latest);
        return <ShippingTransitGrid settings={settings} onChange={value => { latest = value; setSettings(value); }} />;
    }
    const { container } = render(<Form />);
    expect(screen.getByText(original.title)).toBeTruthy();
    expect(screen.queryByDisplayValue(original.title)).toBeNull();
    expect(screen.queryByDisplayValue(original.zoneName)).toBeNull();
    expect(screen.queryByLabelText('Row 1 method ID')).toBeNull();
    expect(container.querySelector('details')?.open).toBe(false);
    fireEvent.change(screen.getByLabelText('Row 1 maximum transit days'), { target: { value: '8' } });
    expect(latest.shippingMethods[0]).toEqual({ ...original, maxTransitDays: 8 });
    fireEvent.click(screen.getByRole('switch', { name: 'Enable row 1' }));
    expect(latest.shippingMethods[0].enabled).toBe(!original.enabled);
    fireEvent.click(screen.getByRole('button', { name: 'Remove shipping row 1' }));
    expect(latest.shippingMethods).toHaveLength(0);
});

it('keeps unconfigured and read-only toggles disabled', () => {
    const settings = responseFixture().settings;
    const row = settings.shippingMethods[0];
    const onChange = vi.fn();
    const { rerender } = render(<ShippingTransitGrid settings={settings} onChange={onChange} unconfigured={[`${row.methodId}:${row.instanceId}`]} />);
    expect(screen.getByRole('switch', { name: 'Enable row 1' })).toBeDisabled();
    rerender(<fieldset disabled><ShippingTransitGrid settings={settings} onChange={onChange} /></fieldset>);
    expect(screen.getByRole('switch', { name: 'Enable row 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove shipping row 1' })).toBeDisabled();
});

it('adds an exact mapping without allowing the provider name or identity to change', () => {
    const settings = responseFixture().settings;
    const onChange = vi.fn();
    render(<ShippingTransitGrid settings={settings} onChange={onChange} />);
    fireEvent.click(screen.getByText(/Mapping ·/));
    fireEvent.click(screen.getByRole('button', { name: 'Add exact rate mapping' }));
    expect(onChange.mock.calls[0][0].shippingMethods[1]).toEqual({
        ...settings.shippingMethods[0], mappingKind: 'exact_rate', rateId: '', allRatesConfirmed: undefined, enabled: false,
    });
});
