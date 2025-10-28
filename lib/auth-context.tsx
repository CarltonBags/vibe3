'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { User as SupabaseUser } from '@supabase/supabase-js'
import { supabase } from './supabase-browser'

interface AuthContextType {
  user: SupabaseUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<any>
  signOut: () => Promise<void>
  signInWithGoogle: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  signInWithGoogle: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if Supabase is configured
    const isConfigured = process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID && process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC
    
    if (!isConfigured) {
      setLoading(false)
      return
    }

    // Check active sessions
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    }).catch((error) => {
      console.error('Auth session error:', error)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID || !process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC) {
      throw new Error('Authentication is not configured. Please add Supabase credentials to .env.local')
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID || !process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC) {
      throw new Error('Authentication is not configured. Please add Supabase credentials to .env.local')
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })
    if (error) throw error
    return data
  }

  const signOut = async () => {
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID || !process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC) {
      throw new Error('Authentication is not configured. Please add Supabase credentials to .env.local')
    }

    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const signInWithGoogle = async () => {
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID || !process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC) {
      throw new Error('Authentication is not configured. Please add Supabase credentials to .env.local')
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        signOut,
        signInWithGoogle,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

