/**
 * Vitest setup file for React Testing Library.
 * Extends jest-dom matchers for better assertions.
 */
import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

expect.extend(matchers);
