import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App.tsx'
import './index.css'

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
    errorMessage: event.error?.message,
    errorStack: event.error?.stack
  })
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', {
    reason: event.reason,
    reasonMessage: event.reason?.message,
    reasonStack: event.reason?.stack
  })
})

if (!document.documentElement.classList.contains('dark')) {
  document.documentElement.classList.add('dark')
}

document.body.classList.add('bg-background', 'text-foreground')

const getBaseName = () => {
  const previewPrefix = '/api/preview/'
  const { pathname } = window.location

  if (pathname.startsWith(previewPrefix)) {
    const segments = pathname.split('/')
    // ['', 'api', 'preview', projectId, buildId, ...]
    if (segments.length >= 5) {
      const base = segments.slice(0, 5).join('/')
      return base || '/'
    }
  }

  const baseEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
  return baseEnv?.BASE_URL ?? '/'
}

const basename = getBaseName()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <ErrorBoundary>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </HelmetProvider>
  </React.StrictMode>,
)

