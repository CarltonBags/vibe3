'use client'

import { createBrowserClient } from '@supabase/ssr'

const supabaseProjectId = process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC

const isSupabaseConfigured = Boolean(supabaseProjectId && supabaseAnonKey)

const supabaseUrl = supabaseProjectId 
  ? `https://${supabaseProjectId}.supabase.co` 
  : 'https://placeholder.supabase.co'

// Browser client that properly stores auth in cookies for SSR
export const supabase = isSupabaseConfigured
  ? createBrowserClient(supabaseUrl, supabaseAnonKey!)
  : createBrowserClient('https://placeholder.supabase.co', 'placeholder-key')

