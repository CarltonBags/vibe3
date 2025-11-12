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
    sandbox_id?: string | null
    preview_url?: string
    preview_token?: string
    status?: 'generating' | 'active' | 'archived' | 'error'
    last_generated_at?: string
    generation_count?: number
    github_repo_url?: string
    build_hash?: string
    build_version?: number
    storage_path?: string
    name?: string
    description?: string
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
 * @deprecated Use saveProjectFilesToBuild instead to ensure files are linked to builds
 */
export async function saveProjectFiles(
  projectId: string,
  files: Array<{ path: string; content: string }>,
  buildId?: string | null
): Promise<void> {
  // If buildId is provided, use the build-aware function
  if (buildId) {
    return saveProjectFilesToBuild(projectId, buildId, files)
  }
  
  // Legacy path: save without build_id (not recommended)
  console.warn(`⚠️ Saving files without build_id for project ${projectId}. Files will have build_id: null`)
  const filesToInsert = files.map(file => ({
    project_id: projectId,
    file_path: file.path,
    file_content: file.content,
    file_size: Buffer.from(file.content).length,
    build_id: null
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

/**
 * Get the latest build_id for a project
 */
export async function getLatestBuildId(projectId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('builds')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'success') // Only get successful builds
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    // Table may not exist yet, or no builds
    console.warn('Error fetching latest build_id:', error)
    return null
  }
  return data?.id || null
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
): Promise<void> {
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

/**
 * Save an asset (image, logo, etc.) to project_files with storage metadata
 * The actual file is stored in Supabase Storage, and metadata is stored in project_files
 */
export async function saveProjectAsset(
  projectId: string,
  buildId: string | null,
  filePath: string, // Path used in code (e.g., "public/logo.png")
  assetMetadata: {
    storagePath: string // Path in Supabase Storage
    publicUrl: string // Public/signed URL
    mimeType: string
    fileSize: number
    bucket?: string // Bucket name (optional)
  }
): Promise<void> {
  const assetData = {
    type: 'asset',
    storage_path: assetMetadata.storagePath,
    public_url: assetMetadata.publicUrl,
    mime_type: assetMetadata.mimeType,
    bucket: assetMetadata.bucket || 'project-assets'
  }

  const fileRecord = {
    project_id: projectId,
    build_id: buildId,
    file_path: filePath,
    file_content: JSON.stringify(assetData),
    file_size: assetMetadata.fileSize
  }

  const { error } = await supabaseAdmin
    .from('project_files')
    .insert(fileRecord)

  if (error) {
    console.error('Error saving project asset:', error)
    throw new Error('Failed to save project asset')
  }

  console.log(`✅ Saved asset metadata for ${filePath}`)
}

/**
 * Check if a project file is an asset (based on file_content being JSON with type: "asset")
 */
export function isAssetFile(file: { file_content: string }): boolean {
  try {
    const content = JSON.parse(file.file_content)
    return content.type === 'asset'
  } catch {
    return false
  }
}

/**
 * Get asset metadata from a project file
 */
export function getAssetMetadata(file: { file_content: string }): {
  storagePath: string
  publicUrl: string
  mimeType: string
  bucket: string
} | null {
  try {
    const content = JSON.parse(file.file_content)
    if (content.type === 'asset') {
      return {
        storagePath: content.storage_path,
        publicUrl: content.public_url,
        mimeType: content.mime_type,
        bucket: content.bucket || 'project-assets'
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Update asset records to link them to a build_id
 * This is called after a build is created to link assets to the build
 */
export async function linkAssetsToBuild(
  projectId: string,
  buildId: string | null
): Promise<void> {
  if (!buildId) {
    console.log('No build_id provided, skipping asset linking');
    return;
  }

  try {
    // Find all asset files for this project that don't have a build_id
    const { data: assetFiles, error: fetchError } = await supabaseAdmin
      .from('project_files')
      .select('id, file_path, file_content')
      .eq('project_id', projectId)
      .is('build_id', null);

    if (fetchError) {
      console.error('Error fetching asset files:', fetchError);
      return;
    }

    if (!assetFiles || assetFiles.length === 0) {
      console.log('No asset files found to link to build');
      return;
    }

    // Filter for asset files (type: "asset")
    const assets = assetFiles.filter((file: any) => {
      try {
        const content = JSON.parse(file.file_content);
        return content.type === 'asset';
      } catch {
        return false;
      }
    });

    if (assets.length === 0) {
      console.log('No asset files found to link to build');
      return;
    }

    // Update asset records to link them to the build_id
    const assetIds = assets.map((a: any) => a.id);
    const { error: updateError } = await supabaseAdmin
      .from('project_files')
      .update({ build_id: buildId })
      .in('id', assetIds);

    if (updateError) {
      console.error('Error linking assets to build:', updateError);
      throw new Error('Failed to link assets to build');
    }

    console.log(`✅ Linked ${assets.length} asset file(s) to build ${buildId}`);
  } catch (error: any) {
    console.error('Error linking assets to build:', error);
    // Don't throw - asset linking is not critical
  }
}

/**
 * Delete old chunks for specific files (before re-inserting updated chunks)
 */
export async function deleteFileChunks(
  projectId: string,
  filePaths: string[]
) {
  if (filePaths.length === 0) return
  const { error } = await supabaseAdmin
    .from('file_chunks')
    .delete()
    .eq('project_id', projectId)
    .in('file_path', filePaths)
  if (error) {
    console.error('Error deleting old file chunks:', error)
    // don't throw; embeddings are auxiliary
  } else {
    console.log(`🗑️ Deleted old chunks for ${filePaths.length} file(s)`)
  }
}

export async function saveFileChunks(
  projectId: string,
  buildId: string | null,
  chunks: Array<{ file_path: string; chunk_index: number; content: string; embedding: number[] }>
) {
  if (chunks.length === 0) return
  
  // Delete old chunks for the files we're updating
  const filePaths = Array.from(new Set(chunks.map(c => c.file_path)))
  await deleteFileChunks(projectId, filePaths)
  
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
  } else {
    console.log(`✅ Saved ${chunks.length} chunk(s) for ${filePaths.length} file(s)`)
  }
}

/**
 * Get project files from database
 */
export async function getProjectFiles(projectId: string, buildId?: string | null) {
  let query = supabaseAdmin
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
  
  // If buildId is provided, filter by it
  if (buildId) {
    query = query.eq('build_id', buildId)
  } else {
    // Otherwise, get the latest build_id and filter by it
    const latestBuildId = await getLatestBuildId(projectId)
    if (latestBuildId) {
      query = query.eq('build_id', latestBuildId)
      console.log(`📦 Fetching files from latest build: ${latestBuildId}`)
    } else {
      // Fallback: get latest per file path (for projects without builds table)
      console.log(`⚠️ No build_id found, using latest per file path`)
      // This will be handled by the ordering below
    }
  }
  
  const { data, error } = await query
    .order('file_path')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching project files:', error)
    throw new Error('Failed to fetch project files')
  }

  // If no build_id filtering, deduplicate by file_path (keep latest)
  if (!buildId) {
    const latestBuildId = await getLatestBuildId(projectId)
    if (!latestBuildId) {
      // Deduplicate by file_path, keeping the most recent
      const fileMap = new Map<string, ProjectFile>()
      for (const file of (data || [])) {
        const existing = fileMap.get(file.file_path)
        if (!existing || new Date(file.created_at) > new Date(existing.created_at)) {
          fileMap.set(file.file_path, file)
        }
      }
      return Array.from(fileMap.values())
    }
  }

  return data as ProjectFile[]
}

export async function matchFileChunks(
  projectId: string,
  embedding: number[],
  matchCount = 20,
  buildId?: string | null
) {
  // Get latest build_id if not provided
  let targetBuildId = buildId
  if (!targetBuildId) {
    targetBuildId = await getLatestBuildId(projectId)
    if (targetBuildId) {
      console.log(`🔍 Vector search using latest build_id: ${targetBuildId}`)
    }
  }
  
  // If we have a build_id, we need to filter chunks by it
  // The RPC function doesn't support build_id filtering, so we'll filter after
  const { data, error } = await supabaseAdmin
    .rpc('match_file_chunks', {
      p_project_id: projectId,
      p_query: embedding as unknown as any,
      p_match_count: targetBuildId ? matchCount * 2 : matchCount // Get more if filtering
    })
  if (error) {
    console.error('Error matching file chunks:', error)
    return []
  }
  
  let results = data as Array<{ id: string; project_id: string; build_id: string | null; file_path: string; chunk_index: number; content: string; similarity: number }>
  
  // Filter by build_id if provided
  if (targetBuildId) {
    results = results.filter(chunk => chunk.build_id === targetBuildId)
    // If we filtered out too many, take top matches
    results = results.slice(0, matchCount)
    console.log(`✅ Filtered to ${results.length} chunks from build ${targetBuildId}`)
  } else if (results.length > 0) {
    // If no build_id, warn about potential stale chunks
    const uniqueBuildIds = new Set(results.map(r => r.build_id).filter(Boolean))
    if (uniqueBuildIds.size > 1) {
      console.warn(`⚠️ Vector search returned chunks from ${uniqueBuildIds.size} different builds. Consider using latest build_id.`)
    }
  }
  
  return results
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

/**
 * Save conversation messages to database
 */
export async function saveConversationMessages(
  projectId: string,
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content?: string
    tool_name?: string
    tool_call_id?: string
    metadata?: any
  }>
): Promise<void> {
  const messageRows = messages
    .filter(m => m.role !== 'system') // Don't save system messages
    .map(m => ({
      project_id: projectId,
      role: m.role,
      content: m.content || null,
      tool_name: m.tool_name || null,
      tool_call_id: m.tool_call_id || null,
      metadata: m.metadata || {}
    }))

  if (messageRows.length === 0) return

  const { error } = await supabaseAdmin
    .from('conversation_messages')
    .insert(messageRows)

  if (error) {
    console.error('Error saving conversation messages:', error)
    // Don't throw - conversation history is nice-to-have
  }
}

/**
 * Load conversation history for a project
 * Returns last N messages (default 50) to maintain context
 */
export async function getConversationHistory(
  projectId: string,
  limit: number = 50
): Promise<Array<{
  role: 'user' | 'assistant' | 'tool'
  content?: string
  tool_name?: string
  tool_call_id?: string
  metadata?: any
}>> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('role, content, tool_name, tool_call_id, metadata')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Error loading conversation history:', error)
    return []
  }

  return data || []
}

