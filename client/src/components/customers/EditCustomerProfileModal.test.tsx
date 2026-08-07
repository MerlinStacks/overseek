import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EditCustomerProfileModal, type CustomerProfileValues } from './EditCustomerProfileModal';

const initialValues: CustomerProfileValues = {
    firstName: 'Jamie',
    lastName: 'Nguyen',
    email: 'jamie@example.com',
    phone: '',
    company: '',
    abn: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    postcode: '',
    country: 'au',
};

function modal(overrides: Partial<ComponentProps<typeof EditCustomerProfileModal>> = {}) {
    const props = {
        isOpen: true,
        initialValues,
        isSaving: false,
        onClose: vi.fn(),
        onSave: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
    return { props, ...render(<EditCustomerProfileModal {...props} />) };
}

describe('EditCustomerProfileModal', () => {
    it('has an associated dialog title, labelled close control, and initial focus', () => {
        modal();

        expect(screen.getByRole('dialog', { name: 'Edit Contact Profile' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'First name' })).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    });

    it('preserves edits across parent rerenders and failed saves', async () => {
        const user = userEvent.setup();
        const view = modal();
        const firstName = screen.getByRole('textbox', { name: 'First name' });

        await user.clear(firstName);
        await user.type(firstName, 'Taylor');
        view.rerender(
            <EditCustomerProfileModal
                {...view.props}
                initialValues={{ ...initialValues }}
                error="The save failed"
            />,
        );

        expect(screen.getByRole('textbox', { name: 'First name' })).toHaveValue('Taylor');
        expect(screen.getByText('The save failed')).toBeInTheDocument();
    });

    it('validates fields and submits normalized country and ABN values', async () => {
        const user = userEvent.setup();
        const { props } = modal();
        const email = screen.getByRole('textbox', { name: 'Email' });
        const abn = screen.getByRole('textbox', { name: 'ABN' });
        const country = screen.getByRole('textbox', { name: 'Country code' });

        await user.clear(email);
        await user.type(email, 'invalid');
        await user.tab();
        expect(email).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

        await user.clear(email);
        await user.type(email, 'new@example.com');
        await user.type(abn, '51824753556');
        await user.clear(country);
        await user.type(country, 'a1u');
        expect(abn).toHaveValue('51 824 753 556');
        expect(country).toHaveValue('AU');

        await user.click(screen.getByRole('button', { name: 'Save profile' }));
        expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
            email: 'new@example.com',
            abn: '51824753556',
            country: 'AU',
        }));
    });

    it('guards dirty drafts on Escape and restores focus after closing', async () => {
        const user = userEvent.setup();
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const view = modal();

        await user.type(screen.getByRole('textbox', { name: 'First name' }), ' changed');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(confirm).toHaveBeenCalled();
        expect(view.props.onClose).not.toHaveBeenCalled();

        confirm.mockReturnValue(true);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(view.props.onClose).toHaveBeenCalledOnce();
        view.rerender(<EditCustomerProfileModal {...view.props} isOpen={false} />);
        expect(opener).toHaveFocus();
        opener.remove();
        confirm.mockRestore();
    });
});
