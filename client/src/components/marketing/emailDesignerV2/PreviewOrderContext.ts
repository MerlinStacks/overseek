import { createContext } from 'react';

/** The account's loaded sample order, including its persisted snapshot. Never synthetic dates. */
export const PreviewOrderContext = createContext<unknown>(null);
