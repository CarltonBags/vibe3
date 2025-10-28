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
  lastModified?: number;
  tokensUsed?: number;
}

type ViewMode = 'preview' | 'code';
type PageSection = 'home' | 'features' | 'pricing' | 'about' | 'generate';

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
  const [currentSection, setCurrentSection] = useState<PageSection>('home')
  const hasStartedRef = useRef(false)

  // Navigation functions
  const scrollToSection = (section: PageSection) => {
    setCurrentSection(section)
    if (section === 'generate') {
      setHasGenerated(false)
      return
    }

    const element = document.getElementById(section)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

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

    // Handle projects from URL params (both new generation and existing projects)
    useEffect(() => {
      const projectId = searchParams.get('projectId')
      const sandboxUrl = searchParams.get('sandboxUrl')
      const previewUrl = searchParams.get('previewUrl')
      const sandboxId = searchParams.get('sandboxId')
      const projectName = searchParams.get('projectName')

      // Handle existing project viewing (no sandbox, just preview)
      if (projectId && previewUrl && !hasGenerated) {
        setHasGenerated(true)
        setProgress('🚀 Loading your project...')

        // Fetch project files
        fetch(`/api/projects/${projectId}/files`)
          .then(res => res.json())
          .then(data => {
        setSandboxData({
          success: true,
          sandboxId: '', // No sandbox in preview-only mode
          projectId: projectId, // Store project ID for amendments
          url: previewUrl, // Use preview URL directly
          files: data.files || []
        })
            setProgress('')
          })
          .catch(err => {
            console.error('Error loading project:', err)
            setError('Failed to load project files')
            setHasGenerated(false)
          })
      }
      // Handle reopened projects with sandbox (legacy support)
      else if (projectId && sandboxUrl && sandboxId && !hasGenerated) {
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

  const handleRenameProject = async (projectId: string, newName: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })

      if (!res.ok) {
        const error = await res.json()
        alert(`Failed to rename project: ${error.error}`)
      }
      // Success - the UI will update naturally as the project name is just for display
    } catch (error) {
      console.error('Error renaming project:', error)
      alert('Failed to rename project')
    }
  }

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
      let sandboxId = sandboxData.sandboxId
      const projectId = sandboxData.projectId || searchParams.get('projectId')

      // If no sandbox exists (preview-only mode), spawn one first
      if (!sandboxId && projectId) {
        setProgress(' Starting development environment...')
        const reopenResponse = await fetch(`/api/projects/${projectId}/reopen`, {
          method: 'POST',
        })

        if (!reopenResponse.ok) {
          throw new Error('Failed to start development environment')
        }

        const reopenData = await reopenResponse.json()
        sandboxId = reopenData.sandboxId

        // Update sandbox data with the new sandbox ID
        setSandboxData(prev => prev ? { ...prev, sandboxId } : null)
      }

      const response = await fetch('/api/amend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amendmentPrompt: amendmentPrompt.trim(),
          sandboxId: sandboxId,
          projectId: projectId,
          currentFiles: sandboxData.files
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to apply amendments')
      }

      if (data.success) {
        // Add to history
        setAmendmentHistory(prev => [...prev, amendmentPrompt])
        
        // Clear amendment input
        setAmendmentPrompt('')
        setProgress(`✨ ${data.summary}`)
        
        // Update sandbox data with new files
        const updatedSandboxData = {
          ...sandboxData,
          files: data.files,
          url: data.url,
          sandboxId: sandboxData.sandboxId,
          lastModified: Date.now(), // Add timestamp to force iframe reload
          tokensUsed: data.tokensUsed || sandboxData.tokensUsed // Preserve or update token count
        }
        setSandboxData(updatedSandboxData)
        
        // Force a complete reload of the preview
        setTimeout(() => {
          // Clear success message
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

  // If showing a project (generated or from URL), show the project interface
  if (hasGenerated) {
    return (
      <>
        <main className="min-h-screen flex bg-black">
          {/* Top Left - Vibe Logo */}
          <button
            onClick={() => scrollToSection('home')}
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

          {/* Top Right - Usage Indicator + User Menu */}
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
                    {sandboxData.tokensUsed && (
                      <div className="mt-2 text-center">
                        <p className="text-gray-400 text-xs">
                          Tokens used: <span className="text-purple-400 font-medium">{sandboxData.tokensUsed.toLocaleString()}</span>
                        </p>
                      </div>
                    )}
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
              {/* Project Name */}
              {sandboxData?.projectId && (
                <div className="flex items-center gap-2 px-3 py-1 bg-gray-700/50 rounded-md">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-gray-300">Project</span>
                  <button
                    onClick={() => {
                      const projectId = sandboxData.projectId || searchParams.get('projectId')
                      if (projectId) {
                        const newName = prompt('Rename project:', 'My Project')
                        if (newName && newName.trim()) {
                          handleRenameProject(projectId, newName.trim())
                        }
                      }
                    }}
                    className="text-gray-400 hover:text-gray-300 ml-2"
                    title="Rename project"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              )}

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
            <>
              {isAmending && (
                <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-gray-900 rounded-lg p-6 flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-vibe-gradient-to-br"></div>
                    <p className="text-white text-sm">Applying changes...</p>
                  </div>
                </div>
              )}
              {!sandboxData.url && hasGenerated && (
                <div className="flex-1 flex items-center justify-center bg-gray-900">
                  <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-vibe-gradient-to-br"></div>
                    <p className="text-gray-400 text-sm">Loading preview...</p>
                  </div>
                </div>
              )}
              {sandboxData.url && (
                <iframe
                  key={`${sandboxData.url}-${sandboxData.lastModified || 0}`}
                  src={sandboxData.url}
                  className="flex-1 w-full border-0"
                  title="Website Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                  onError={(e) => {
                    console.log('Iframe error, will retry automatically');
                    // Don't show error to user
                  }}
                />
              )}
            </>
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

                {/* src/ folder */}
                <div className="mb-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1 px-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                    src/
                  </div>
                  <div className="space-y-0.5 pl-2">
                    {sandboxData.files?.filter(f => f.path.startsWith('src/') && !f.path.includes('/', 5)).map((file, idx) => (
                      <button
                        key={`${file.path}-${idx}`}
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

                {/* src/components/ folder */}
                {sandboxData.files?.some(f => f.path.startsWith('src/components/')) && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 px-2 flex items-center gap-1 pl-4">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                      </svg>
                      components/
                    </div>
                    <div className="space-y-0.5 pl-4">
                      {sandboxData.files?.filter(f => f.path.startsWith('src/components/')).map((file) => (
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
                            <span className="truncate">{file.path.replace('src/components/', '')}</span>
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

  // Landing Page
  return (
    <div className="min-h-screen bg-black">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-black/90 backdrop-blur-lg z-50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <button
                onClick={() => scrollToSection('home')}
                className="text-2xl font-bold cursor-pointer hover:opacity-80 transition-opacity"
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
            </div>

            <div className="hidden md:flex items-center space-x-8">
              <button
                onClick={() => scrollToSection('home')}
                className={`text-gray-300 hover:text-white transition-colors ${currentSection === 'home' ? 'text-white' : ''}`}
              >
                Home
              </button>
              <button
                onClick={() => scrollToSection('integrations')}
                className={`text-gray-300 hover:text-white transition-colors ${currentSection === 'integrations' ? 'text-white' : ''}`}
              >
                Integrations
              </button>
              <button
                onClick={() => scrollToSection('pricing')}
                className={`text-gray-300 hover:text-white transition-colors ${currentSection === 'pricing' ? 'text-white' : ''}`}
              >
                Pricing
              </button>
            </div>

            <div className="flex items-center space-x-4">
              {/* Usage Indicator (only when logged in) */}
              {user && <UsageIndicator />}

              {/* User Menu or Sign In Button */}
              {user ? (
                <UserMenu />
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - Main Generation Form */}
      <section id="home" className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          {/* Logo and Title */}
          <div className="mb-12">
            <h1 className="text-6xl md:text-8xl font-bold mb-6">
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
            <p className="text-xl md:text-2xl text-gray-400 max-w-2xl mx-auto">
              Build web applications with AI. From landing pages to Web3 dApps.
            </p>
          </div>

          {/* Main Generation Form */}
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-800 max-w-2xl mx-auto">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3 text-left">
                  Describe what you want to build
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  disabled={isGenerating}
                  className="w-full p-4 bg-gray-800/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50 resize-none"
                  placeholder="e.g., 'Create a modern portfolio website' or 'Build a Web3 NFT marketplace'"
                />
              </div>

              <button
                type="submit"
                disabled={!prompt.trim() || isGenerating}
                className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 text-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Generating...</span>
                  </div>
                ) : (
                  'Generate Application'
                )}
              </button>
            </form>

            {isGenerating && (
              <div className="mt-8">
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
                      <div className={`w-2 h-2 rounded-full ${progress.includes('Installing') ? 'bg-purple-500 animate-pulse' : progress.includes('Starting') || progress.includes('ready') ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                      <p className="text-xs text-gray-400">Dependencies</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-6 bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* Auth prompt for non-logged in users */}
          {!user && !isGenerating && (
            <div className="mt-8 text-center">
              <p className="text-gray-400 mb-4">
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  Sign in
                </button>
                {' '}to save your projects and access advanced features
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Integrations Section */}
      <section id="integrations" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Works with Your Favorite Tools</h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              Seamlessly integrate with the technologies you already use
            </p>
          </div>

          {/* Integration Slideshow - 2 rows with animation */}
          <div className="space-y-8">
            {/* First row - scrolling left */}
            <div className="relative overflow-hidden">
              <div className="flex space-x-8 animate-scroll-left">
                {[1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6].map((num, index) => (
                  <div key={`${num}-${index}`} className="flex-shrink-0 w-24 h-12 bg-gray-800/50 rounded-lg border border-gray-700 flex items-center justify-center hover:bg-gray-700/50 transition-colors">
                    <img
                      src={`/slide/${num}.png`}
                      alt={`Integration ${num}`}
                      className="w-full h-full object-contain rounded-lg opacity-70 hover:opacity-100 transition-opacity"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Second row - scrolling right */}
            <div className="relative overflow-hidden">
              <div className="flex space-x-8 animate-scroll-right ml-12">
                {[7, 8, 9, 10, 11, 12, 7, 8, 9, 10, 11, 12].map((num, index) => (
                  <div key={`${num}-${index}`} className="flex-shrink-0 w-24 h-12 bg-gray-800/50 rounded-lg border border-gray-700 flex items-center justify-center hover:bg-gray-700/50 transition-colors">
                    <img
                      src={`/slide/${num}.png`}
                      alt={`Integration ${num}`}
                      className="w-full h-full object-contain rounded-lg opacity-70 hover:opacity-100 transition-opacity"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Choose Your Plan</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Start free and scale as you grow. All plans include access to our AI-powered development platform.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Plan */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">Free</h3>
                <div className="text-4xl font-bold text-white mb-2">$0<span className="text-lg text-gray-400">/month</span></div>
                <p className="text-gray-400">Perfect for getting started</p>
              </div>
              <ul className="space-y-4 mb-8">
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  5 generations per month
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Basic templates
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Community support
                </li>
              </ul>
              <button
                onClick={() => user ? scrollToSection('generate') : setShowAuthModal(true)}
                className="w-full py-3 px-6 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors"
              >
                Get Started Free
              </button>
            </div>

            {/* Pro Plan */}
            <div className="bg-gradient-to-br from-purple-600/20 to-pink-600/20 backdrop-blur-sm rounded-2xl p-8 border-2 border-purple-500/50 relative">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <span className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                  Most Popular
                </span>
              </div>
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">Pro</h3>
                <div className="text-4xl font-bold text-white mb-2">$19<span className="text-lg text-gray-400">/month</span></div>
                <p className="text-gray-400">For serious developers</p>
              </div>
              <ul className="space-y-4 mb-8">
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  100 generations per month
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  All templates & frameworks
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Priority support
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Advanced AI features
                </li>
              </ul>
              <button
                onClick={() => user ? scrollToSection('generate') : setShowAuthModal(true)}
                className="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:shadow-2xl hover:scale-105 transition-all"
              >
                Start Pro Trial
              </button>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">Enterprise</h3>
                <div className="text-4xl font-bold text-white mb-2">$99<span className="text-lg text-gray-400">/month</span></div>
                <p className="text-gray-400">For teams and businesses</p>
              </div>
              <ul className="space-y-4 mb-8">
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Unlimited generations
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Custom integrations
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Dedicated support
                </li>
                <li className="flex items-center text-gray-300">
                  <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  White-label solutions
                </li>
              </ul>
              <button
                onClick={() => user ? scrollToSection('generate') : setShowAuthModal(true)}
                className="w-full py-3 px-6 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors"
              >
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 border-t border-gray-800 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="text-2xl font-bold mb-4">
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
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                Revolutionizing web development with AI-powered code generation.
              </p>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="#integrations" className="text-gray-400 hover:text-white transition-colors">Integrations</a></li>
                <li><a href="#pricing" className="text-gray-400 hover:text-white transition-colors">Pricing</a></li>
                <li><button onClick={() => scrollToSection('home')} className="text-gray-400 hover:text-white transition-colors">Get Started</button></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Careers</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-4">Support</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Status</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-gray-400 text-sm">
              © 2024 Vibe. All rights reserved.
            </p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                </svg>
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>
                </svg>
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-4.4869 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0189 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  )
}
