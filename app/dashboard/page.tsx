'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import UserMenu from '../components/UserMenu'
import { useUserUsage } from '@/lib/hooks/useUserUsage'

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth()
  const { usage, loading: usageLoading } = useUserUsage()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/')
    }
  }, [user, authLoading, router])

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
        <h1 className="text-4xl font-bold mb-8">Dashboard</h1>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Generations Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center"
                style={{
                  backgroundImage: 'url(/vibe_gradient.png)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-400">Generations</p>
                <p className="text-2xl font-bold">
                  {usageLoading ? '...' : `${usage?.generationsUsed || 0} / ${usage?.generationsLimit || 0}`}
                </p>
              </div>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-2">
              <div 
                className="h-full rounded-full transition-all"
                style={{
                  width: `${usageLoading ? 0 : Math.min(100, ((usage?.generationsUsed || 0) / (usage?.generationsLimit || 1)) * 100)}%`,
                  backgroundImage: 'url(/vibe_gradient.png)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {usage?.generationsLimit && usage.generationsUsed ? Math.max(0, usage.generationsLimit - usage.generationsUsed) : 0} remaining this month
            </p>
          </div>

          {/* Projects Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-400">Projects</p>
                <p className="text-2xl font-bold">
                  {usageLoading ? '...' : `${usage?.projectsCreated || 0} / ${usage?.projectsLimit || 0}`}
                </p>
              </div>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-2">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{
                  width: `${usageLoading ? 0 : Math.min(100, ((usage?.projectsCreated || 0) / (usage?.projectsLimit || 1)) * 100)}%`
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {usage?.projectsLimit && usage.projectsCreated ? Math.max(0, usage.projectsLimit - usage.projectsCreated) : 0} slots available
            </p>
          </div>

          {/* Tokens Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-400">Tokens Used</p>
                <p className="text-2xl font-bold">
                  {usageLoading ? '...' : (usage?.tokensUsed || 0).toLocaleString()}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              This month's AI usage
            </p>
          </div>
        </div>

        {/* Current Plan */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 mb-12">
          <h2 className="text-2xl font-bold mb-4">Current Plan</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="inline-block px-4 py-2 rounded-lg mb-2"
                style={{
                  backgroundImage: 'url(/vibe_gradient.png)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}>
                <span className="text-white font-bold">{usage?.tierDisplayName || 'Loading...'}</span>
              </div>
              <p className="text-gray-400">
                {usage?.tierName === 'free' && 'Perfect for getting started and exploring'}
                {usage?.tierName === 'starter' && 'Great for solo developers and side projects'}
                {usage?.tierName === 'pro' && 'Professional features for serious projects'}
                {usage?.tierName === 'team' && 'Collaborate with your team'}
                {usage?.tierName === 'enterprise' && 'Custom solutions for your organization'}
              </p>
            </div>
            <button
              onClick={() => router.push('/pricing')}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
            >
              View Plans
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <button
            onClick={() => router.push('/')}
            className="bg-zinc-900 border border-zinc-800 hover:border-purple-500 rounded-xl p-6 text-left transition-all group"
          >
            <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">New Generation</h3>
            <p className="text-sm text-gray-400">Create a new website with AI</p>
          </button>

          <button
            onClick={() => router.push('/projects')}
            className="bg-zinc-900 border border-zinc-800 hover:border-blue-500 rounded-xl p-6 text-left transition-all group"
          >
            <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">My Projects</h3>
            <p className="text-sm text-gray-400">View all your projects</p>
          </button>

          <button
            onClick={() => router.push('/settings')}
            className="bg-zinc-900 border border-zinc-800 hover:border-green-500 rounded-xl p-6 text-left transition-all group"
          >
            <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Settings</h3>
            <p className="text-sm text-gray-400">Manage your account</p>
          </button>
        </div>
      </div>
    </div>
  )
}

