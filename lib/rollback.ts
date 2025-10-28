import { supabaseAdmin } from './supabase'
import { getBuildVersion } from './storage'

/**
 * Roll back a project to a previous version
 */
export async function rollbackProject(
  userId: string,
  projectId: string,
  targetVersion: number
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the build for the target version
    const buildData = await getBuildVersion(userId, projectId, targetVersion)
    
    if (!buildData) {
      return {
        success: false,
        error: `Version ${targetVersion} not found`
      }
    }

    // Update project to point to the rolled-back version
    const { error } = await supabaseAdmin
      .from('projects')
      .update({
        build_version: targetVersion,
        build_hash: buildData.buildHash,
        storage_path: `/${userId}/${projectId}/v${targetVersion}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', projectId)
      .eq('user_id', userId)

    if (error) {
      console.error('Error rolling back project:', error)
      return {
        success: false,
        error: 'Failed to update project'
      }
    }

    console.log(`✅ Rolled back project ${projectId} to version ${targetVersion}`)
    return { success: true }
  } catch (error) {
    console.error('Rollback error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get rollback history for a project
 */
export async function getRollbackHistory(
  userId: string,
  projectId: string
): Promise<Array<{ version: number; buildHash: string; createdAt: string }>> {
  // Get the project to find current version
  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('build_version, build_hash, created_at')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()

  if (projectError || !project) {
    return []
  }

  // List available versions
  const { data: files, error: filesError } = await supabaseAdmin.storage
    .from('project-builds')
    .list(`${userId}/${projectId}`, {
      sortBy: { column: 'created_at', order: 'desc' }
    })

  if (filesError || !files) {
    return []
  }

  // Extract version numbers
  const versions = files
    .filter(file => file.name.match(/^v\d+$/))
    .map(file => {
      const version = parseInt(file.name.replace('v', ''), 10)
      return {
        version,
        buildHash: version === project.build_version ? project.build_hash : '',
        createdAt: file.created_at || new Date().toISOString()
      }
    })
    .sort((a, b) => b.version - a.version)

  return versions
}

