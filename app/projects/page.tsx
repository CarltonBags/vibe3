'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import UserMenu from '../components/UserMenu'

interface Project {
  id: string
  name: string
  description: string | null
  prompt: string
  sandbox_url: string | null
  created_at: string
  updated_at: string
}

export default function Projects() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [reopeningId, setReopeningId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) {
      fetchProjects()
    }
  }, [user])

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects)
      }
    } catch (error) {
      console.error('Error fetching projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewProject = async (projectId: string) => {
    // Prevent double-clicking
    if (reopeningId) {
      console.log('Already opening a project, please wait...');
      return;
    }

    setReopeningId(projectId)
    try {
      const res = await fetch(`/api/projects/${projectId}/reopen`, {
        method: 'GET',
      })

      if (res.ok) {
        const data = await res.json()
        // Redirect to home page with preview URL (no sandbox)
        router.push(`/?projectId=${projectId}&previewUrl=${encodeURIComponent(data.url)}&projectName=${encodeURIComponent(data.projectName)}`)
      } else {
        const error = await res.json()
        alert(`Failed to view project: ${error.error}`)
        setReopeningId(null)
      }
    } catch (error) {
      console.error('Error viewing project:', error)
      alert('Failed to view project')
      setReopeningId(null)
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400"
          >
            vibe
          </button>
          <UserMenu />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold">My Projects</h1>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 rounded-lg font-medium transition-all"
            style={{
              backgroundImage: 'url(/vibe_gradient.png)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            <span className="text-white drop-shadow-lg">+ New Project</span>
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
          </div>
        )}

        {/* Empty State */}
        {!loading && projects.length === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
            <div className="w-20 h-20 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-4">No Projects Yet</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Start creating amazing websites with AI. Click "New Project" to get started!
            </p>
            <button
              onClick={() => router.push('/')}
              className="px-8 py-3 rounded-lg font-medium transition-all inline-block"
              style={{
                backgroundImage: 'url(/vibe_gradient.png)',
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            >
              <span className="text-white drop-shadow-lg">Create Your First Project</span>
            </button>
          </div>
        )}

        {/* Projects Grid */}
        {!loading && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div
                key={project.id}
                className="bg-zinc-900 border border-zinc-800 hover:border-purple-500 rounded-xl overflow-hidden transition-all group"
              >
                {/* Project Preview */}
                <div className="aspect-video bg-zinc-800 flex items-center justify-center relative overflow-hidden">
                  {project.sandbox_url ? (
                    <iframe
                      src={`/api/proxy?url=${encodeURIComponent(project.sandbox_url)}`}
                      className="w-full h-full"
                      title={project.name}
                    />
                  ) : (
                    <svg className="w-12 h-12 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Project Info */}
                <div className="p-6">
                  <h3 className="text-lg font-bold mb-2 truncate">{project.name}</h3>
                  <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                    {project.description || project.prompt}
                  </p>
                  
                  {/* Meta */}
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                    <span>{new Date(project.created_at).toLocaleDateString()}</span>
                    {project.sandbox_url && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        Live
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleViewProject(project.id)}
                      disabled={reopeningId === project.id}
                      className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {reopeningId === project.id ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>Loading...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          <span>View Project</span>
                        </>
                      )}
                    </button>
                    {project.sandbox_url && (
                      <button
                        onClick={() => project.sandbox_url && window.open(project.sandbox_url, '_blank')}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
                        title="Open current sandbox"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

