'use client'

import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import AuthModal from './components/AuthModal'
import UserMenu from './components/UserMenu'
import UsageIndicator from './components/UsageIndicator'

interface FileContent {
  path: string;
  content: string;
}

interface SandboxResponse {
  success: boolean;
  sandboxId: string;
  projectId?: string;
  url?: string;
  token?: string;
  files?: FileContent[];
  message?: string;
  error?: string;
  generationsRemaining?: number;
  upgradeRequired?: boolean;
}

type ViewMode = 'preview' | 'code';

export default function Home() {
  const { user, loading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  const [prompt, setPrompt] = useState('')
  const [amendmentPrompt, setAmendmentPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAmending, setIsAmending] = useState(false)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [sandboxData, setSandboxData] = useState<SandboxResponse | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [selectedFile, setSelectedFile] = useState<string>('app/page.tsx')
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [amendmentHistory, setAmendmentHistory] = useState<string[]>([])
  const hasStartedRef = useRef(false)

  // Cleanup sandbox when user navigates away or closes tab
  useEffect(() => {
    const cleanupSandbox = async () => {
      if (sandboxData?.sandboxId) {
        try {
          await fetch('/api/sandbox/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sandboxId: sandboxData.sandboxId }),
          });
          console.log('Sandbox cleaned up on page close');
        } catch (err) {
          console.error('Failed to cleanup sandbox:', err);
        }
      }
    };

    // Cleanup on page unload (close tab, navigate away)
    const handleBeforeUnload = () => {
      if (sandboxData?.sandboxId) {
        // Use sendBeacon for reliable cleanup on page close
        navigator.sendBeacon(
          '/api/sandbox/cleanup',
          JSON.stringify({ sandboxId: sandboxData.sandboxId })
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup on component unmount (navigation within app)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupSandbox();
    };
  }, [sandboxData?.sandboxId]);

    // Handle reopened projects from URL params
    useEffect(() => {
      const projectId = searchParams.get('projectId')
      const sandboxUrl = searchParams.get('sandboxUrl')
      const sandboxId = searchParams.get('sandboxId')
      const projectName = searchParams.get('projectName')

      if (projectId && sandboxUrl && sandboxId && !hasGenerated) {
        setIsGenerating(true)
        setHasGenerated(true)
        setProgress('🚀 Loading your project...')
        
        // Fetch project files
        fetch(`/api/projects/${projectId}/files`)
          .then(res => res.json())
          .then(data => {
            setSandboxData({
              success: true,
              sandboxId: sandboxId, // Use the actual sandbox ID from URL params
              projectId: projectId, // Store project ID for amendments
              url: sandboxUrl,
              files: data.files || []
            })
            setProgress('')
            setIsGenerating(false)
          })
          .catch(err => {
            console.error('Error loading project:', err)
            setError('Failed to load project files')
            setIsGenerating(false)
            setHasGenerated(false)
          })
      }
    }, [searchParams, hasGenerated])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || hasStartedRef.current) return
    
    // Check if user is authenticated
    if (!user) {
      setShowAuthModal(true)
      return
    }
    
    hasStartedRef.current = true
    setHasGenerated(true)
    setIsGenerating(true)
    setProgress('🤖 Generating code with AI...')
    setError('') // Clear previous errors
    
    try {
      // Simulate progress updates
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
        body: JSON.stringify({ prompt: prompt.trim() }),
      })

      clearInterval(progressTimer)

      const data: SandboxResponse = await res.json()
      
      // Check for auth or limit errors
      if (res.status === 401) {
        setError('Please sign in to continue')
        setShowAuthModal(true)
        setHasGenerated(false)
        hasStartedRef.current = false
        setIsGenerating(false)
        return
      }
      
      if (res.status === 403) {
        setError(data.error || 'Generation limit exceeded')
        if (data.upgradeRequired) {
          setError(`${data.error} - Upgrade to continue. Generations remaining: ${data.generationsRemaining || 0}`)
        }
        setHasGenerated(false)
        hasStartedRef.current = false
        setIsGenerating(false)
        return
      }
      
      if (!res.ok) {
        throw new Error('Failed to create sandbox')
      }

      setSandboxData(data)
      setProgress('✅ Website is ready!')
      
      if (!data.success) {
        setError(data.error || 'Failed to create sandbox')
      }
    } catch (err) {
      console.error('Error creating sandbox:', err)
      setError('Failed to create sandbox and execute code')
      setProgress('')
      hasStartedRef.current = false
    } finally {
      setIsGenerating(false)
    }
  }

  const handleReset = () => {
    setPrompt('')
    setAmendmentPrompt('')
    setHasGenerated(false)
    setSandboxData(null)
    setProgress('')
    setError('')
    setAmendmentHistory([])
    hasStartedRef.current = false
    
    // Clear URL params if any
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/')
    }
  }

  const handleAmendment = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!amendmentPrompt.trim() || !sandboxData || isAmending) {
      return
    }

    setIsAmending(true)
    setError('')
    setProgress('🔧 Processing your changes...')

    try {
      const response = await fetch('/api/amend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amendmentPrompt: amendmentPrompt.trim(),
          sandboxId: sandboxData.sandboxId,
          projectId: sandboxData.projectId || searchParams.get('projectId'),
          currentFiles: sandboxData.files
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to apply amendments')
      }

      if (data.success) {
        // Update sandbox data with new files
        setSandboxData({
          ...sandboxData,
          files: data.files,
          url: data.url
        })

        // Add to history
        setAmendmentHistory(prev => [...prev, amendmentPrompt])
        
        // Clear amendment input
        setAmendmentPrompt('')
        setProgress(`✨ ${data.summary}`)
        
        // Force iframe reload to show changes
        const iframe = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement
        if (iframe) {
          iframe.src = iframe.src
        }
        
        // Clear success message after a few seconds
        setTimeout(() => {
          setProgress('')
        }, 3000)
      }
    } catch (err) {
      console.error('Amendment error:', err)
      setError(err instanceof Error ? err.message : 'Failed to apply changes')
    } finally {
      setIsAmending(false)
    }
  }

  return (
    <>
      <main className="min-h-screen flex bg-black">
        {/* Top Left - Vibe Logo (only when hasGenerated) */}
        {hasGenerated && (
          <button
            onClick={handleReset}
            className="fixed top-4 left-4 z-40 text-2xl font-bold cursor-pointer hover:opacity-80 transition-opacity"
            style={{
              backgroundImage: 'url(/vibe_gradient.png)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            vibe
          </button>
        )}

        {/* Top Right - Usage Indicator + User Menu */}
        {!hasGenerated && (
          <div className="fixed top-4 right-4 z-40 flex items-center gap-4">
            {/* Usage Indicator (only when logged in) */}
            {user && <UsageIndicator />}
            
            {/* User Menu or Sign In Button */}
            {user ? (
              <UserMenu />
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-6 py-2 rounded-lg font-medium transition-all"
                style={{
                  backgroundImage: 'url(/vibe_gradient.png)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <span className="text-white drop-shadow-lg">Sign In</span>
              </button>
            )}
          </div>
        )}

        {/* Left Panel - Input & Status */}
        <div className={`${hasGenerated ? 'w-1/3' : 'w-full'} transition-all duration-500 flex flex-col bg-black p-8`}>
          <div className={`${hasGenerated ? 'pt-12' : 'flex-1 flex items-center justify-center'}`}>
            <div className="w-full max-w-2xl">
              {!hasGenerated && (
                <h1 className="text-5xl font-bold text-center mb-12">
                <span className="text-white">give in to the </span>
                <span 
                  className="inline-block bg-clip-text text-transparent bg-cover bg-center"
                  style={{
                    backgroundImage: 'url(/vibe_gradient.png)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text'
                  }}
                >
                  vibe
                </span>
              </h1>
            )}
            
            {/* Initial Generation Form */}
            {!hasGenerated && (
              <form onSubmit={handleSubmit} className="relative mb-6">
                <div className="input-container">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    disabled={isGenerating}
                    className="w-full p-4 bg-transparent outline-none resize-none placeholder-gray-400 disabled:opacity-50"
                    placeholder="Describe what you want to build (e.g., 'Create a tic-tac-toe game' or 'Build a todo app')..."
                  />
                  <button
                    type="submit"
                    disabled={!prompt.trim() || isGenerating}
                    className="submit-arrow disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Generate"
                    style={{
                      backgroundImage: 'url(/vibe_gradient.png)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  >
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      viewBox="0 0 24 24" 
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5"
                    >
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </button>
                </div>
              </form>
            )}

            {/* Amendment Form (shown after generation) */}
            {hasGenerated && !isGenerating && (
              <div className="space-y-4 mb-6">
                <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700">
                  <p className="text-xs text-gray-400 mb-1">Original prompt:</p>
                  <p className="text-sm text-gray-300">{prompt}</p>
                </div>
                
                <form onSubmit={handleAmendment} className="relative">
                  <div className="input-container">
                    <textarea
                      value={amendmentPrompt}
                      onChange={(e) => setAmendmentPrompt(e.target.value)}
                      rows={3}
                      disabled={isAmending}
                      className="w-full p-4 bg-transparent outline-none resize-none placeholder-gray-400 disabled:opacity-50"
                      placeholder="Request changes (e.g., 'Make the button bigger' or 'Add a contact form')..."
                    />
                    <button
                      type="submit"
                      disabled={!amendmentPrompt.trim() || isAmending}
                      className="submit-arrow disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Apply Changes"
                      style={{
                        backgroundImage: 'url(/vibe_gradient.png)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }}
                    >
                      <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        viewBox="0 0 24 24" 
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-5 h-5"
                      >
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </button>
                  </div>
                </form>

                {/* Amendment History */}
                {amendmentHistory.length > 0 && (
                  <div className="bg-gray-800/20 rounded-lg p-3 border border-gray-700/50">
                    <p className="text-xs text-gray-500 mb-2">Changes made:</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {amendmentHistory.map((change, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-purple-400 text-xs mt-0.5">✓</span>
                          <p className="text-xs text-gray-400 flex-1">{change}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasGenerated && (
              <div className="space-y-4">
                {(isGenerating || isAmending) && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div>
                      <p className="text-sm text-gray-300">{progress}</p>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-4">
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full ${progress.includes('Generating') ? 'bg-purple-500 animate-pulse' : 'bg-green-500'}`}></div>
                          <p className="text-xs text-gray-400">AI Code Generation</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full ${progress.includes('Creating') ? 'bg-purple-500 animate-pulse' : progress.includes('Generating') ? 'bg-gray-600' : 'bg-green-500'}`}></div>
                          <p className="text-xs text-gray-400">Sandbox Environment</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full ${progress.includes('Setting') ? 'bg-purple-500 animate-pulse' : progress.includes('Generating') || progress.includes('Creating') ? 'bg-gray-600' : 'bg-green-500'}`}></div>
                          <p className="text-xs text-gray-400">Project Setup</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full ${progress.includes('Installing') ? 'bg-purple-500 animate-pulse' : progress.includes('Starting') || progress.includes('ready') ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                          <p className="text-xs text-gray-400">Dependencies</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full ${progress.includes('Starting') ? 'bg-purple-500 animate-pulse' : progress.includes('ready') ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                          <p className="text-xs text-gray-400">Dev Server</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {!isGenerating && !isAmending && sandboxData && (
                  <div className="space-y-3">
                    {progress && !error && (
                      <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4">
                        <p className="text-green-400 text-sm font-medium">{progress}</p>
                      </div>
                    )}
                    {!progress && (
                      <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4">
                        <p className="text-green-400 text-sm font-medium">✓ Website is live!</p>
                        <p className="text-gray-400 text-xs mt-1">Sandbox: {sandboxData.sandboxId}</p>
                      </div>
                    )}
                    <button
                      onClick={() => window.open(sandboxData.url, '_blank')}
                      className="w-full bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                    >
                      Open in New Tab →
                    </button>
                  </div>
                )}

                {error && (
                  <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Preview/Code */}
      {hasGenerated && sandboxData?.url && (
        <div className="w-2/3 bg-gray-900 flex flex-col">
          {/* Tab Bar */}
          <div className="bg-gray-800 px-4 py-2 flex items-center justify-between border-b border-gray-700">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('preview')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'preview' 
                    ? 'bg-gray-700 text-white' 
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Preview
              </button>
              <button
                onClick={() => setViewMode('code')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'code' 
                    ? 'bg-gray-700 text-white' 
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                Code
              </button>
            </div>
            {viewMode === 'preview' && (
              <button
                onClick={() => {
                  const iframe = document.querySelector('iframe');
                  if (iframe) iframe.src = iframe.src;
                }}
                className="text-gray-400 hover:text-gray-300 text-xs flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}
          </div>

          {/* Content */}
          {viewMode === 'preview' ? (
            <iframe 
              key={sandboxData.url}
              src={`/api/proxy?url=${encodeURIComponent(sandboxData.url)}${sandboxData.token ? `&token=${encodeURIComponent(sandboxData.token)}` : ''}`}
              className="flex-1 w-full border-0"
              title="Website Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
          ) : (
            <div className="flex-1 overflow-auto flex">
              {/* File Tree Sidebar */}
              <div className="w-64 bg-gray-800 border-r border-gray-700 p-4 overflow-y-auto">
                <div className="text-xs font-semibold text-gray-400 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  PROJECT FILES
                </div>
                
                {/* Root files */}
                <div className="space-y-1 mb-4">
                  {sandboxData.files?.filter(f => !f.path.includes('/')).map((file) => (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFile(file.path)}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                        selectedFile === file.path
                          ? 'bg-gray-700 text-white'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-750'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {file.path.endsWith('.json') ? (
                          <svg className="w-3.5 h-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
                          </svg>
                        )}
                        <span className="truncate">{file.path}</span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* app/ folder */}
                <div className="mb-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1 px-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                    app/
                  </div>
                  <div className="space-y-0.5 pl-2">
                    {sandboxData.files?.filter(f => f.path.startsWith('app/') && !f.path.includes('/', 4)).map((file) => (
                      <button
                        key={file.path}
                        onClick={() => setSelectedFile(file.path)}
                        className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                          selectedFile === file.path
                            ? 'bg-gray-700 text-white'
                            : 'text-gray-400 hover:text-gray-300 hover:bg-gray-750'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {file.path.endsWith('.tsx') || file.path.endsWith('.ts') ? (
                            <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M3 3h18v18H3V3m4.73 15.04l.95-2.27c.2-.48.2-.99 0-1.47l-.95-2.27h2.43l.95 2.27c.2.48.2.99 0 1.47l-.95 2.27H7.73m4.05 0l.95-2.27c.2-.48.2-.99 0-1.47l-.95-2.27h2.43l.95 2.27c.2.48.2.99 0 1.47l-.95 2.27h-2.43Z"/>
                            </svg>
                          ) : file.path.endsWith('.css') ? (
                            <svg className="w-3.5 h-3.5 text-purple-400" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
                            </svg>
                          )}
                          <span className="truncate">{file.path.replace('app/', '')}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* app/components/ folder */}
                {sandboxData.files?.some(f => f.path.startsWith('app/components/')) && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 px-2 flex items-center gap-1 pl-4">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                      </svg>
                      components/
                    </div>
                    <div className="space-y-0.5 pl-4">
                      {sandboxData.files?.filter(f => f.path.startsWith('app/components/')).map((file) => (
                        <button
                          key={file.path}
                          onClick={() => setSelectedFile(file.path)}
                          className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                            selectedFile === file.path
                              ? 'bg-gray-700 text-white'
                              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-750'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M3 3h18v18H3V3m4.73 15.04l.95-2.27c.2-.48.2-.99 0-1.47l-.95-2.27h2.43l.95 2.27c.2.48.2.99 0 1.47l-.95 2.27H7.73m4.05 0l.95-2.27c.2-.48.2-.99 0-1.47l-.95-2.27h2.43l.95 2.27c.2.48.2.99 0 1.47l-.95 2.27h-2.43Z"/>
                            </svg>
                            <span className="truncate">{file.path.replace('app/components/', '')}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* app/types/ and app/utils/ folders */}
                {['types', 'utils'].map(folder => sandboxData.files?.some(f => f.path.startsWith(`app/${folder}/`)) && (
                  <div key={folder} className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 px-2 flex items-center gap-1 pl-4">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                      </svg>
                      {folder}/
                    </div>
                    <div className="space-y-0.5 pl-4">
                      {sandboxData.files?.filter(f => f.path.startsWith(`app/${folder}/`)).map((file) => (
                        <button
                          key={file.path}
                          onClick={() => setSelectedFile(file.path)}
                          className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                            selectedFile === file.path
                              ? 'bg-gray-700 text-white'
                              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-750'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M3 3h18v18H3V3m4.73 15.04l.95-2.27c.2-.48.2-.99 0-1.47l-.95-2.27h2.43l.95 2.27c.2.48.2.99 0 1.47l-.95 2.27H7.73m4.05 0l.95-2.27c.2-.48.2-.99 0-1.47l-.95-2.27h2.43l.95 2.27c.2.48.2.99 0 1.47l-.95 2.27h-2.43Z"/>
                            </svg>
                            <span className="truncate">{file.path.replace(`app/${folder}/`, '')}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Code Editor */}
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="mb-4 flex items-center justify-between sticky top-0 bg-gray-900 pb-3 z-10">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    <span className="font-mono">{selectedFile}</span>
                  </div>
                  <button
                    onClick={() => {
                      const file = sandboxData.files?.find(f => f.path === selectedFile);
                      if (file) {
                        navigator.clipboard.writeText(file.content);
                        alert('Code copied to clipboard!');
                      }
                    }}
                    className="text-gray-400 hover:text-white transition-colors text-xs flex items-center gap-1 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                </div>
                <div className="bg-gray-950 rounded-lg p-6 overflow-x-hidden">
                  <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
                    <code className="text-gray-300">
                      {sandboxData.files?.find(f => f.path === selectedFile)?.content.split('\n').map((line, i) => (
                        <div key={i} className="table-row hover:bg-gray-900/50">
                          <span className="table-cell text-right pr-4 text-gray-600 select-none" style={{minWidth: '3em'}}>
                            {i + 1}
                          </span>
                          <span className="table-cell text-gray-300">
                            {line || ' '}
                          </span>
                        </div>
                      )) || '// File not found'}
                    </code>
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>

    {/* Auth Modal */}
    <AuthModal 
      isOpen={showAuthModal} 
      onClose={() => setShowAuthModal(false)} 
    />
  </>
  )
}
