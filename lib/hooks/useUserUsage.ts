'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'

interface UserUsage {
  generationsUsed: number
  generationsLimit: number
  tokensUsed: number
  projectsCreated: number
  projectsLimit: number
  tierName: string
  tierDisplayName: string
}

export function useUserUsage() {
  const { user } = useAuth()
  const [usage, setUsage] = useState<UserUsage | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchUsage = useCallback(async () => {
    // Don't fetch if no user
    if (!user) {
      setUsage(null)
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/user/usage')
      
      if (res.ok) {
        const data = await res.json()
        setUsage(data)
      }
    } catch (error) {
      console.error('useUserUsage: Error fetching usage:', error)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    // Only fetch if user is logged in
    if (user) {
      fetchUsage()
      
      // Refresh every 30 seconds
      const interval = setInterval(fetchUsage, 30000)
      return () => clearInterval(interval)
    } else {
      // User not logged in, set loading to false
      setLoading(false)
      setUsage(null)
    }
  }, [user, fetchUsage])

  return { usage, loading, refetch: fetchUsage }
}

