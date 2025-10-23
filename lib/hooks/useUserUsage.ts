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

  console.log('useUserUsage: user from auth context:', user ? `Authenticated (${user.id})` : 'Not authenticated')

  const fetchUsage = useCallback(async () => {
    // Don't fetch if no user
    if (!user) {
      setUsage(null)
      setLoading(false)
      return
    }

    console.log('useUserUsage: Fetching usage for user:', user.id)
    try {
      const res = await fetch('/api/user/usage')
      console.log('useUserUsage: Response status:', res.status)
      
      if (res.ok) {
        const data = await res.json()
        console.log('useUserUsage: Fetched data:', data)
        setUsage(data)
      } else {
        // Don't log error if it's just 401 (user not logged in)
        if (res.status !== 401) {
          const errorData = await res.json().catch(() => ({}))
          console.error('useUserUsage: Failed to fetch usage:', res.status, errorData)
        }
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

