import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

import { SettingsProvider } from './context/SettingsContext';
import { AccountProvider } from './context/AccountContext';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AccountProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </AccountProvider>
  </StrictMode>,
)
