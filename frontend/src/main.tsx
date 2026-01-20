import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import CssBaseline from '@mui/material/CssBaseline'
import AppWithTheme from './AppWithTheme'
import { QuickSyncProvider } from './context/QuickSyncContext'
import { PWAProvider } from './context/PWAContext'
import { SettingsProvider } from './context/SettingsContext'
import './style.css'
import './styles/pwa.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PWAProvider>
        <QuickSyncProvider>
          <SettingsProvider>
            <AppWithTheme />
          </SettingsProvider>
        </QuickSyncProvider>
      </PWAProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
