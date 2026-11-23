import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted variable fonts (bundled; no third-party requests).
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'

import App from './App.tsx'
import { AppProviders } from './app/AppProviders'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
