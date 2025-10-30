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

  const result = data as {
    can_generate: boolean
    reason: string | null
    generations_remaining: number
    projects_remaining: number
  }

  return {
    canGenerate: result.can_generate,
    reason: result.reason,
    generationsRemaining: result.generations_remaining,
    projectsRemaining: result.projects_remaining
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
    build_hash?: string
    build_version?: number
    storage_path?: string
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
  // Prepare files to insert (do NOT overwrite previous versions)
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
 * Build-aware file saving and build bookkeeping
 */
export async function getLatestBuildVersion(projectId: string): Promise<number> {
  // Attempts to read builds table; falls back to counting distinct file sets if missing
  const { data, error } = await supabaseAdmin
    .from('builds')
    .select('version')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    // Table may not exist yet
    return 0
  }
  return data?.version || 0
}

export async function createBuild(
  projectId: string,
  userId: string,
  options?: { storage_path?: string; build_hash?: string }
) {
  try {
    const current = await getLatestBuildVersion(projectId)
    const nextVersion = current + 1
    const { data, error } = await supabaseAdmin
      .from('builds')
      .insert({
        project_id: projectId,
        user_id: userId,
        version: nextVersion,
        storage_path: options?.storage_path || null,
        build_hash: options?.build_hash || null,
        status: 'pending'
      })
      .select()
      .single()
    if (error) throw error
    return data
  } catch (e) {
    // If builds table missing, return a shim
    return { id: null, version: null }
  }
}

export async function finalizeBuild(
  buildId: string | null,
  status: 'success' | 'failed'
) {
  if (!buildId) return
  await supabaseAdmin
    .from('builds')
    .update({ status })
    .eq('id', buildId)
}

export async function updateBuild(
  buildId: string,
  updates: { git_repo_url?: string | null; git_commit_sha?: string | null; git_tag?: string | null }
) {
  const { error } = await supabaseAdmin
    .from('builds')
    .update(updates)
    .eq('id', buildId)
  if (error) {
    console.error('Error updating build:', error)
  }
}

export async function getProjectById(projectId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (error) return null
  return data
}

export async function saveAmendment(
  projectId: string,
  buildId: string | null,
  prompt: string,
  summary: string | null,
  filePaths: string[]
) {
  const { error } = await supabaseAdmin
    .from('amendments')
    .insert({
      project_id: projectId,
      build_id: buildId,
      prompt,
      summary,
      file_paths: filePaths
    })
  if (error) {
    console.error('Error saving amendment:', error)
  }
}

export async function getRecentAmendments(
  projectId: string,
  limit = 5
) {
  const { data, error } = await supabaseAdmin
    .from('amendments')
    .select('prompt, summary, file_paths, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('Error fetching amendments:', error)
    return []
  }
  return data as Array<{ prompt: string; summary: string | null; file_paths: string[]; created_at: string }>
}

export async function saveProjectFilesToBuild(
  projectId: string,
  buildId: string | null,
  files: Array<{ path: string; content: string }>
) {
  if (!buildId) {
    // Fallback to legacy saving
    return saveProjectFiles(projectId, files)
  }
  const filesToInsert = files.map(file => ({
    project_id: projectId,
    build_id: buildId,
    file_path: file.path,
    file_content: file.content,
    file_size: Buffer.from(file.content).length
  }))

  const { error } = await supabaseAdmin
    .from('project_files')
    .insert(filesToInsert)

  if (error) {
    console.error('Error saving project files (build-scoped):', error)
    throw new Error('Failed to save project files for build')
  }
}

export async function saveFileChunks(
  projectId: string,
  buildId: string | null,
  chunks: Array<{ file_path: string; chunk_index: number; content: string; embedding: number[] }>
) {
  if (chunks.length === 0) return
  const payload = chunks.map(c => ({
    project_id: projectId,
    build_id: buildId,
    file_path: c.file_path,
    chunk_index: c.chunk_index,
    content: c.content,
    embedding: c.embedding as unknown as any
  }))
  const { error } = await supabaseAdmin
    .from('file_chunks')
    .insert(payload)
  if (error) {
    console.error('Error saving file chunks:', error)
    // don't throw; embeddings are auxiliary
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

export async function matchFileChunks(
  projectId: string,
  embedding: number[],
  matchCount = 20
) {
  const { data, error } = await supabaseAdmin
    .rpc('match_file_chunks', {
      p_project_id: projectId,
      p_query: embedding as unknown as any,
      p_match_count: matchCount
    })
  if (error) {
    console.error('Error matching file chunks:', error)
    return []
  }
  return data as Array<{ id: string; project_id: string; build_id: string | null; file_path: string; chunk_index: number; content: string; similarity: number }>
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

