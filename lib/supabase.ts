import { createClient } from '@supabase/supabase-js'

const supabaseUrl = `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`
const supabaseAnonKey = process.env.SUPABASE_ANON_PUBLIC!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!

// Client for browser/client-side operations (uses anon key with RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Database types
export interface Database {
  public: {
    Tables: {
      users: {
        Row: User
        Insert: Omit<User, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<User, 'id' | 'created_at'>>
      }
      projects: {
        Row: Project
        Insert: Omit<Project, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Project, 'id' | 'created_at'>>
      }
      project_files: {
        Row: ProjectFile
        Insert: Omit<ProjectFile, 'id' | 'created_at'>
        Update: Partial<Omit<ProjectFile, 'id' | 'created_at'>>
      }
      pricing_tiers: {
        Row: PricingTier
        Insert: Omit<PricingTier, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<PricingTier, 'id' | 'created_at'>>
      }
      user_usage: {
        Row: UserUsage
        Insert: Omit<UserUsage, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<UserUsage, 'id' | 'created_at'>>
      }
      generations: {
        Row: Generation
        Insert: Omit<Generation, 'id' | 'created_at'>
        Update: Partial<Omit<Generation, 'id' | 'created_at'>>
      }
    }
  }
}

export interface User {
  id: string // UUID from Supabase Auth
  email: string
  full_name: string | null
  avatar_url: string | null
  tier_id: string // Foreign key to pricing_tiers
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: 'active' | 'canceled' | 'past_due' | 'trialing' | null
  subscription_end_date: string | null
  created_at: string
  updated_at: string
}

export interface PricingTier {
  id: string
  name: string // 'free', 'starter', 'pro', 'team', 'enterprise'
  display_name: string // 'Free Vibe', 'Starter Vibe', etc.
  price_monthly: number // in cents
  max_projects: number // -1 for unlimited
  max_generations_per_month: number // -1 for unlimited
  max_tokens_per_generation: number
  sandbox_duration_hours: number
  features: string[] // JSON array of features
  can_export_github: boolean
  can_use_custom_domain: boolean
  has_priority_queue: boolean
  has_api_access: boolean
  team_seats: number
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  user_id: string // Foreign key to users
  name: string
  description: string | null
  prompt: string // Original user prompt
  sandbox_id: string | null // Current Daytona sandbox ID
  preview_url: string | null
  preview_token: string | null
  status: 'generating' | 'active' | 'archived' | 'error'
  last_generated_at: string | null
  generation_count: number // Number of times regenerated
  is_public: boolean
  github_repo_url: string | null
  custom_domain: string | null
  created_at: string
  updated_at: string
}

export interface ProjectFile {
  id: string
  project_id: string // Foreign key to projects
  file_path: string // e.g., 'app/page.tsx'
  file_content: string // The actual code
  file_size: number // in bytes
  created_at: string
}

export interface UserUsage {
  id: string
  user_id: string // Foreign key to users
  period_start: string // Start of billing period
  period_end: string // End of billing period
  generations_used: number
  tokens_used: number
  projects_created: number
  created_at: string
  updated_at: string
}

export interface Generation {
  id: string
  user_id: string
  project_id: string | null
  prompt: string
  tokens_used: number // Total tokens (input + output)
  cost: number // Cost in cents
  duration_ms: number // Generation time in milliseconds
  status: 'success' | 'error'
  error_message: string | null
  created_at: string
}

