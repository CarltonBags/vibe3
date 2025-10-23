'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useUserUsage } from '@/lib/hooks/useUserUsage'

export default function UserMenu() {
  const { user, signOut } = useAuth()
  const { usage, loading: usageLoading } = useUserUsage()
  const [isOpen, setIsOpen] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user?.email) {
      setUserEmail(user.email)
    }
  }, [user])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    try {
      await signOut()
      setIsOpen(false)
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  if (!user) return null

  // Get initials from email
  const initials = userEmail.charAt(0).toUpperCase()

  return (
    <div className="relative" ref={menuRef}>
      {/* Avatar button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm hover:scale-105 transition-transform"
      >
        {initials}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden z-50">
          {/* User info */}
          <div className="p-4 border-b border-zinc-800">
            <p className="text-sm text-gray-400">Signed in as</p>
            <p className="text-sm font-medium text-white truncate">{userEmail}</p>
          </div>

          {/* Usage Stats */}
          {!usageLoading && usage && (
            <div className="p-4 bg-zinc-800/50 border-b border-zinc-800">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase">Your Plan</p>
                <span 
                  className="text-xs font-bold px-2 py-1 rounded"
                  style={{
                    backgroundImage: 'url(/vibe_gradient.png)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  <span className="text-white drop-shadow-lg">{usage.tierDisplayName}</span>
                </span>
              </div>

              {/* Generations Progress */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">Generations</p>
                  <p className="text-xs font-medium text-white">
                    {usage.generationsUsed} / {usage.generationsLimit}
                  </p>
                </div>
                <div className="w-full bg-zinc-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (usage.generationsUsed / usage.generationsLimit) * 100)}%`,
                      backgroundImage: 'url(/vibe_gradient.png)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {Math.max(0, usage.generationsLimit - usage.generationsUsed)} remaining this month
                </p>
              </div>

              {/* Projects Progress */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">Projects</p>
                  <p className="text-xs font-medium text-white">
                    {usage.projectsCreated} / {usage.projectsLimit}
                  </p>
                </div>
                <div className="w-full bg-zinc-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (usage.projectsCreated / usage.projectsLimit) * 100)}%`,
                      backgroundImage: 'url(/vibe_gradient.png)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {Math.max(0, usage.projectsLimit - usage.projectsCreated)} slots available
                </p>
              </div>

              {/* Tokens Used */}
              <div className="pt-3 border-t border-zinc-700">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Tokens Used</p>
                  <p className="text-xs font-medium text-purple-400">
                    {usage.tokensUsed.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Upgrade CTA if close to limits */}
              {(usage.generationsUsed / usage.generationsLimit >= 0.8 || usage.tierName === 'free') && (
                <button
                  onClick={() => {
                    setIsOpen(false)
                    window.location.href = '/pricing'
                  }}
                  className="w-full mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundImage: 'url(/vibe_gradient.png)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  <span className="text-white drop-shadow-lg">
                    {usage.tierName === 'free' ? 'Upgrade for More' : 'Running Low? Upgrade'}
                  </span>
                </button>
              )}
            </div>
          )}

          {usageLoading && (
            <div className="p-4 bg-zinc-800/50 border-b border-zinc-800">
              <div className="animate-pulse">
                <div className="h-4 bg-zinc-700 rounded mb-2"></div>
                <div className="h-8 bg-zinc-700 rounded"></div>
              </div>
            </div>
          )}

          {/* Menu items */}
          <div className="py-2">
            <button
              onClick={() => {
                setIsOpen(false)
                // Navigate to dashboard (you'll create this later)
                window.location.href = '/dashboard'
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-3"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Dashboard
            </button>

            <button
              onClick={() => {
                setIsOpen(false)
                // Navigate to projects (you'll create this later)
                window.location.href = '/projects'
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-3"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              My Projects
            </button>

            <button
              onClick={() => {
                setIsOpen(false)
                // Navigate to settings (you'll create this later)
                window.location.href = '/settings'
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-3"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </div>

          {/* Sign out */}
          <div className="border-t border-zinc-800 py-2">
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors flex items-center gap-3"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

