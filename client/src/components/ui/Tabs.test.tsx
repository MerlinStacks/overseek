import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
    { id: 'details', label: 'General Details', content: <p>Product details</p> },
    { id: 'feed', label: 'Feed Writes', content: <input aria-label="Feed draft" />, keepMounted: true },
];

describe('Tabs navigation placement', () => {
    it('keeps navigation inline by default', () => {
        const { container } = render(<Tabs tabs={tabs} mountInactiveTabs={false} />);
        expect(within(container).getByRole('button', { name: 'General Details' })).toBeInTheDocument();
        expect(screen.getByText('Product details')).toBeInTheDocument();
    });

    it('renders navigation in the header without moving panels or losing retained drafts', () => {
        function Editor() {
            const [header, setHeader] = useState<HTMLDivElement | null>(null);
            const [activeTab, setActiveTab] = useState('details');
            return (
                <>
                    <div data-testid="header" ref={setHeader} />
                    <main>
                        <Tabs tabs={tabs} navigationContainer={header} activeTab={activeTab}
                            onTabChange={setActiveTab} mountInactiveTabs={false} />
                    </main>
                </>
            );
        }

        render(<Editor />);
        const header = screen.getByTestId('header');
        const content = screen.getByRole('main');
        expect(within(content).queryByRole('button')).not.toBeInTheDocument();
        expect(within(header).queryByText('Product details')).not.toBeInTheDocument();
        fireEvent.click(within(header).getByRole('button', { name: 'Feed Writes' }));
        fireEvent.change(within(content).getByRole('textbox', { name: 'Feed draft' }), { target: { value: 'Unsaved draft' } });
        fireEvent.click(within(header).getByRole('button', { name: 'General Details' }));
        fireEvent.click(within(header).getByRole('button', { name: 'Feed Writes' }));
        expect(within(content).getByRole('textbox', { name: 'Feed draft' })).toHaveValue('Unsaved draft');
        expect(within(content).queryByText('Product details')).not.toBeInTheDocument();
    });
});
