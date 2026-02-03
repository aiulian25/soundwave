import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import CssBaseline from '@mui/material/CssBaseline'
import AppWithTheme from './AppWithTheme'
import { QuickSyncProvider } from './context/QuickSyncContext'
import { PWAProvider } from './context/PWAContext'
import { SettingsProvider } from './context/SettingsContext'
import { RadioProvider } from './context/RadioContext'
import { SleepTimerProvider } from './context/SleepTimerContext'
import { QueueProvider } from './context/QueueContext'
import { EqualizerProvider } from './context/EqualizerContext'
import { AchievementNotificationProvider } from './context/AchievementNotificationContext'
import './style.css'
import './styles/pwa.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PWAProvider>
        <QuickSyncProvider>
          <SettingsProvider>
            <EqualizerProvider>
              <RadioProvider>
                <SleepTimerProvider>
                  <QueueProvider>
                    <AchievementNotificationProvider>
                      <AppWithTheme />
                    </AchievementNotificationProvider>
                  </QueueProvider>
                </SleepTimerProvider>
              </RadioProvider>
            </EqualizerProvider>
          </SettingsProvider>
        </QuickSyncProvider>
      </PWAProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
