import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TypingIndicator } from './TypingIndicator';
afterEach(cleanup);
describe('typing status', () => {
    it('announces the participant and respects reduced motion', () => {
        render(<TypingIndicator name="Alice" isAgent />);
        expect(screen.getByRole('status')).toHaveTextContent('Alice is typing');
        expect(screen.queryByText('ME')).toBeNull();
        expect(document.querySelectorAll('.motion-reduce\\:animate-none')).toHaveLength(3);
    });
    it.each([[false, 'Customer'], [true, 'Agent']])('uses a sensible unnamed participant fallback', (isAgent, name) => {
        render(<TypingIndicator name=" " isAgent={isAgent} />);
        expect(screen.getByRole('status')).toHaveTextContent(`${name} is typing`);
    });
});
