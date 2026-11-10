import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AppWithTheme from './AppWithTheme'
import { PWAProvider } from './context/PWAContext'
import { SettingsProvider } from './context/SettingsContext'
import { RadioProvider } from './context/RadioContext'
import { SleepTimerProvider } from './context/SleepTimerContext'
import { EqualizerProvider } from './context/EqualizerContext'
import { AchievementNotificationProvider } from './context/AchievementNotificationContext'
import './i18n'
import './style.css'
import './styles/pwa.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PWAProvider>
        <SettingsProvider>
          <EqualizerProvider>
            <RadioProvider>
              <SleepTimerProvider>
                <AchievementNotificationProvider>
                  <AppWithTheme />
                </AchievementNotificationProvider>
              </SleepTimerProvider>
            </RadioProvider>
          </EqualizerProvider>
        </SettingsProvider>
      </PWAProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
