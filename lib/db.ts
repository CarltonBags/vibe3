import { supabaseAdmin } from './supabase'
import type { User, Project, ProjectFile, Generation } from './supabase'

/**
 * Check if user can generate (hasn't exceeded limits)
 */
export async function checkUserLimits(userId: string) {
  const { data, error } = await supabaseAdmin
    .rpc('check_user_limits', { p_user_id: userId })
    .single()

  if (error) {
    console.error('Error checking user limits:', error)
    throw new Error('Failed to check user limits')
  }

  return {
    canGenerate: data.can_generate,
    reason: data.reason,
    generationsRemaining: data.generations_remaining,
    projectsRemaining: data.projects_remaining
  }
}

/**
 * Increment user usage (generations, tokens, projects)
 */
export async function incrementUsage(
  userId: string,
  tokens: number = 0,
  isNewProject: boolean = false
) {
  const { error } = await supabaseAdmin.rpc('increment_user_usage', {
    p_user_id: userId,
    p_tokens: tokens,
    p_is_new_project: isNewProject
  })

  if (error) {
    console.error('Error incrementing usage:', error)
    throw new Error('Failed to increment usage')
  }
}

/**
 * Get user with tier information
 */
export async function getUserWithTier(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(`
      *,
      tier:pricing_tiers(*)
    `)
    .eq('id', userId)
    .single()

  if (error) {
    console.error('Error fetching user:', error)
    return null
  }

  return data
}

/**
 * Create a new project
 */
export async function createProject(
  userId: string,
  name: string,
  prompt: string,
  description?: string
) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({
      user_id: userId,
      name,
      prompt,
      description,
      status: 'generating'
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating project:', error)
    throw new Error('Failed to create project')
  }

  return data as Project
}

/**
 * Update project with sandbox information
 */
export async function updateProject(
  projectId: string,
  updates: {
    sandbox_id?: string
    preview_url?: string
    preview_token?: string
    status?: 'generating' | 'active' | 'archived' | 'error'
    last_generated_at?: string
    generation_count?: number
    github_repo_url?: string
  }
) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .select()
    .single()

  if (error) {
    console.error('Error updating project:', error)
    throw new Error('Failed to update project')
  }

  return data as Project
}

/**
 * Save project files to database
 */
export async function saveProjectFiles(
  projectId: string,
  files: Array<{ path: string; content: string }>
) {
  // Delete existing files for this project
  await supabaseAdmin
    .from('project_files')
    .delete()
    .eq('project_id', projectId)

  // Insert new files
  const filesToInsert = files.map(file => ({
    project_id: projectId,
    file_path: file.path,
    file_content: file.content,
    file_size: Buffer.from(file.content).length
  }))

  const { error } = await supabaseAdmin
    .from('project_files')
    .insert(filesToInsert)

  if (error) {
    console.error('Error saving project files:', error)
    throw new Error('Failed to save project files')
  }
}

/**
 * Get project files from database
 */
export async function getProjectFiles(projectId: string) {
  const { data, error } = await supabaseAdmin
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .order('file_path')

  if (error) {
    console.error('Error fetching project files:', error)
    throw new Error('Failed to fetch project files')
  }

  return data as ProjectFile[]
}

/**
 * Get user's projects
 */
export async function getUserProjects(userId: string, limit = 50) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching user projects:', error)
    throw new Error('Failed to fetch user projects')
  }

  return data as Project[]
}

/**
 * Get a single project with files
 */
export async function getProjectWithFiles(projectId: string, userId: string) {
  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()

  if (projectError) {
    console.error('Error fetching project:', projectError)
    return null
  }

  const { data: files, error: filesError } = await supabaseAdmin
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .order('file_path')

  if (filesError) {
    console.error('Error fetching project files:', filesError)
    return { ...project, files: [] }
  }

  return {
    ...project,
    files
  }
}

/**
 * Log a generation (for analytics and auditing)
 */
export async function logGeneration(
  userId: string,
  projectId: string | null,
  prompt: string,
  tokensUsed: number,
  cost: number,
  durationMs: number,
  status: 'success' | 'error',
  errorMessage?: string
) {
  const { error } = await supabaseAdmin
    .from('generations')
    .insert({
      user_id: userId,
      project_id: projectId,
      prompt,
      tokens_used: tokensUsed,
      cost,
      duration_ms: durationMs,
      status,
      error_message: errorMessage
    })

  if (error) {
    console.error('Error logging generation:', error)
    // Don't throw - logging failures shouldn't break the flow
  }
}

/**
 * Get user's current period usage
 */
export async function getUserUsage(userId: string) {
  const periodStart = new Date()
  periodStart.setDate(1)
  periodStart.setHours(0, 0, 0, 0)

  const { data, error } = await supabaseAdmin
    .from('user_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('period_start', periodStart.toISOString())
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    console.error('Error fetching user usage:', error)
    return null
  }

  return data
}

/**
 * Delete a project and its files
 */
export async function deleteProject(projectId: string, userId: string) {
  // Verify ownership
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== userId) {
    throw new Error('Unauthorized')
  }

  // Delete project (files will be cascade deleted)
  const { error } = await supabaseAdmin
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) {
    console.error('Error deleting project:', error)
    throw new Error('Failed to delete project')
  }
}

/**
 * Get all pricing tiers
 */
export async function getPricingTiers() {
  const { data, error } = await supabaseAdmin
    .from('pricing_tiers')
    .select('*')
    .order('price_monthly')

  if (error) {
    console.error('Error fetching pricing tiers:', error)
    throw new Error('Failed to fetch pricing tiers')
  }

  return data
}

/**
 * Update user's subscription tier
 */
export async function updateUserTier(
  userId: string,
  tierName: string,
  stripeCustomerId?: string,
  stripeSubscriptionId?: string
) {
  // Get tier ID
  const { data: tier } = await supabaseAdmin
    .from('pricing_tiers')
    .select('id')
    .eq('name', tierName)
    .single()

  if (!tier) {
    throw new Error('Invalid tier')
  }

  // Update user
  const { error } = await supabaseAdmin
    .from('users')
    .update({
      tier_id: tier.id,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      subscription_status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)

  if (error) {
    console.error('Error updating user tier:', error)
    throw new Error('Failed to update user tier')
  }
}

