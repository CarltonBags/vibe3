'use client'

import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!user) {
      setUsage(null)
      setLoading(false)
      return
    }

    fetchUsage()
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchUsage, 30000)
    return () => clearInterval(interval)
  }, [user])

  const fetchUsage = async () => {
    try {
      const res = await fetch('/api/user/usage')
      if (res.ok) {
        const data = await res.json()
        setUsage(data)
      }
    } catch (error) {
      console.error('Failed to fetch usage:', error)
    } finally {
      setLoading(false)
    }
  }

  return { usage, loading, refetch: fetchUsage }
}

