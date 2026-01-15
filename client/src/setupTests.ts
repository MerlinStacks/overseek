/**
 * Vitest setup file for React Testing Library.
 * Extends jest-dom matchers for better assertions.
 */
import '@testing-library/jest-dom/vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

expect.extend(matchers);
