import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyThemeMode, themeModeFromSearch } from './lib/themeMode'

applyThemeMode(themeModeFromSearch(window.location.search))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MotionConfig>
  </StrictMode>
)
