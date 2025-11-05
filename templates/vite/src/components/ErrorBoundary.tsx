import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log detailed error information
    console.error('ErrorBoundary caught an error:', {
      error,
      errorMessage: error?.message || 'Unknown error',
      errorStack: error?.stack || 'No stack trace',
      errorName: error?.name || 'Error',
      errorInfo,
      componentStack: errorInfo.componentStack
    })
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error
      const errorMessage = error?.message || error?.toString() || 'Unknown error occurred'
      const errorStack = error?.stack || ''
      
      return (
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
          <div className="text-center max-w-2xl">
            <h1 className="text-4xl font-bold mb-4 text-red-400">Something went wrong</h1>
            <p className="text-gray-300 mb-4">
              An error occurred while rendering the application.
            </p>
            {error && (
              <details className="mt-4 text-left bg-gray-800 p-4 rounded-lg" open>
                <summary className="cursor-pointer text-gray-400 mb-2 font-semibold">Error Details</summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="text-sm text-gray-400 mb-1">Error Message:</p>
                    <pre className="text-xs text-red-300 overflow-auto p-2 bg-gray-900 rounded">
                      {errorMessage}
                    </pre>
                  </div>
                  {errorStack && (
                    <div>
                      <p className="text-sm text-gray-400 mb-1">Stack Trace:</p>
                      <pre className="text-xs text-red-300 overflow-auto p-2 bg-gray-900 rounded max-h-96">
                        {errorStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

