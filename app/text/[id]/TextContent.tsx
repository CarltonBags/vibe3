'use client'

import { useEffect, useState, useRef } from 'react'

interface TextContentProps {
  id: string | undefined | null
}

interface SandboxResponse {
  success: boolean;
  sandboxId: string;
  url?: string;
  code?: string;
  message?: string;
  error?: string;
}

export default function TextContent({ id }: TextContentProps) {
  const [prompt, setPrompt] = useState('')
  const [sandboxData, setSandboxData] = useState<SandboxResponse | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [showConfirm, setShowConfirm] = useState(true)
  const hasStartedRef = useRef(false)

  useEffect(() => {
    if (!id || typeof id !== 'string') {
      if (!id) setError('Invalid or missing text')
      return
    }

    try {
      // Restore base64 padding
      let paddedId = id.trim()
      const remainder = paddedId.length % 4
      if (remainder > 0) {
        paddedId = paddedId.padEnd(paddedId.length + (4 - remainder), '=')
      }

      // Convert URL-safe characters back to base64 standard
      const base64 = paddedId
        .replace(/-/g, '+')
        .replace(/_/g, '/')
      
      // Decode the text
      const decoded = Buffer.from(base64, 'base64').toString()
      setPrompt(decoded)
      
      // Don't auto-fetch, wait for user confirmation
    } catch (error) {
      console.error('Failed to decode text:', error)
      setError('Invalid text encoding')
    }
  }, [id])

  const handleGenerate = () => {
    if (hasStartedRef.current || !prompt) return
    hasStartedRef.current = true
    setShowConfirm(false)
    fetchSandboxResponse(prompt)
  }

  const fetchSandboxResponse = async (prompt: string) => {
    setIsLoading(true)
    setProgress('🤖 Generating code with AI...')
    
    try {
      // Simulate progress updates (since we can't stream from API route easily)
      const progressTimer = setInterval(() => {
        setProgress(prev => {
          if (prev.includes('Generating')) return '📦 Creating sandbox environment...'
          if (prev.includes('Creating')) return '📁 Setting up Next.js project...'
          if (prev.includes('Setting')) return '⚙️ Installing dependencies...'
          if (prev.includes('Installing')) return '🚀 Starting development server...'
          return prev
        })
      }, 8000)

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      })

      clearInterval(progressTimer)

      if (!res.ok) {
        throw new Error('Failed to create sandbox')
      }

      const data: SandboxResponse = await res.json()
      setSandboxData(data)
      setProgress('✅ Website is ready!')
      
      if (!data.success) {
        setError(data.error || 'Failed to create sandbox')
      }
    } catch (error) {
      console.error('Error creating sandbox:', error)
      setError('Failed to create sandbox and execute code')
      setProgress('')
    } finally {
      setIsLoading(false)
    }
  }

  if (error) {
    return (
      <div className="input-container p-8">
        <p className="text-red-400">{error}</p>
        <div className="mt-6 flex justify-end">
          <a
            href="/"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            ← Back to input
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="input-container p-8">
        <div className="space-y-6">
          <div>
            <h2 className="text-purple-300 text-sm font-medium mb-2">Your Prompt:</h2>
            <p className="text-gray-400 text-sm whitespace-pre-wrap">{prompt}</p>
          </div>
          
          {showConfirm && !isLoading && !sandboxData && (
            <div className="bg-purple-500/20 border border-purple-500/50 rounded-lg p-6 text-center">
              <p className="text-gray-300 mb-4">Ready to generate your website?</p>
              <button
                onClick={handleGenerate}
                className="bg-purple-500 hover:bg-purple-600 text-white px-8 py-3 rounded-lg transition-colors font-medium text-lg"
              >
                🚀 Generate Website
              </button>
            </div>
          )}
          
          {!showConfirm && (
          <div>
            <h2 className="text-purple-300 text-sm font-medium mb-2">Status:</h2>
            {isLoading ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                  <p className="text-lg text-gray-300">{progress}</p>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${progress.includes('Generating') ? 'bg-purple-500 animate-pulse' : 'bg-green-500'}`}></div>
                      <p className="text-sm text-gray-400">AI Code Generation</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${progress.includes('Creating') ? 'bg-purple-500 animate-pulse' : progress.includes('Generating') ? 'bg-gray-600' : 'bg-green-500'}`}></div>
                      <p className="text-sm text-gray-400">Sandbox Environment</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${progress.includes('Setting') ? 'bg-purple-500 animate-pulse' : progress.includes('Generating') || progress.includes('Creating') ? 'bg-gray-600' : 'bg-green-500'}`}></div>
                      <p className="text-sm text-gray-400">Project Setup</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${progress.includes('Installing') ? 'bg-purple-500 animate-pulse' : progress.includes('Starting') || progress.includes('ready') ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                      <p className="text-sm text-gray-400">Installing Dependencies</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${progress.includes('Starting') ? 'bg-purple-500 animate-pulse' : progress.includes('ready') ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                      <p className="text-sm text-gray-400">Starting Server</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : sandboxData ? (
              <div className="space-y-4">
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="space-y-2 text-sm">
                    <p className="text-green-400 text-lg">✓ Website is live and ready!</p>
                    <p className="text-gray-400">Sandbox ID: <span className="text-purple-300 font-mono text-xs">{sandboxData.sandboxId}</span></p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          )}
        </div>
        
        <div className="mt-6 flex justify-between items-center">
          {sandboxData?.url && (
            <button
              onClick={() => window.open(sandboxData.url, '_blank')}
              className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
            >
              Open in New Tab →
            </button>
          )}
          <a
            href="/"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            ← Create Another
          </a>
        </div>
      </div>

      {sandboxData?.url && !isLoading && (
        <div className="bg-gray-800/30 rounded-lg p-4">
          <h3 className="text-purple-300 text-sm font-medium mb-3">Live Preview:</h3>
          <iframe 
            src={sandboxData.url}
            className="w-full h-[700px] bg-white rounded-lg border border-gray-700 shadow-2xl"
            title="Sandbox Preview"
          />
        </div>
      )}
    </div>
  )
}
