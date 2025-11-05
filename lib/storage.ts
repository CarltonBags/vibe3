import { supabaseAdmin } from './supabase'
import * as crypto from 'crypto'

const BUCKET_NAME = 'project-builds'

/**
 * Upload a project build to Supabase storage
 * Simple overwrite approach - latest build replaces previous
 */
export async function uploadBuild(
  userId: string,
  projectId: string,
  files: Array<{ path: string; content: Buffer }>
): Promise<{
  url: string
  buildHash: string
}> {
  console.log(`📦 Uploading build for project ${projectId}`)
  
  // Create a unique build hash based on file contents
  const fileContents = files.map(f => `${f.path}:${f.content.toString('base64')}`).join('\n')
  const buildHash = crypto.createHash('sha256').update(fileContents).digest('hex')

  // Delete all existing files in the project directory first to ensure clean state
  try {
    const storagePrefix = `${userId}/${projectId}/`
    const { data: existingFiles, error: listError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .list(storagePrefix.replace(/\/$/, ''), {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' }
      })
    
    if (!listError && existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles.map(f => `${storagePrefix}${f.name}`)
      console.log(`🗑️ Deleting ${filesToDelete.length} old build file(s) before upload...`)
      
      for (const filePath of filesToDelete) {
        const { error: deleteError } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .remove([filePath])
        if (deleteError) {
          console.warn(`⚠️ Failed to delete old file ${filePath}:`, deleteError)
        }
      }
      console.log(`✅ Cleaned ${filesToDelete.length} old file(s)`)
    }
  } catch (cleanupError) {
    console.warn('⚠️ Failed to cleanup old files (continuing anyway):', cleanupError)
  }

  // Upload files to Supabase storage
  for (const file of files) {
    const storagePath = `${userId}/${projectId}/${file.path}`
    
    const { error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(storagePath, file.content, {
        contentType: getContentType(file.path),
        upsert: true // Overwrite previous build (shouldn't be needed after cleanup, but safety net)
      })

    if (error) {
      console.error(`Error uploading ${file.path}:`, error)
      throw new Error(`Failed to upload ${file.path}: ${error.message}`)
    }
  }

  console.log(`✅ Uploaded ${files.length} files`)

  // Generate a signed URL for the main index file
  const indexPath = `${userId}/${projectId}/index.html`
  const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(indexPath, 3600)

  if (signedUrlError || !signedUrlData) {
    console.error('Error creating signed URL:', signedUrlError)
    throw new Error('Failed to create signed URL')
  }

  // Create a proxied URL that will serve the HTML with proper headers
  const proxyUrl = `/api/preview/${userId}/${projectId}`

  return {
    url: proxyUrl,
    buildHash
  }
}

/**
 * Get the latest build for a project
 */
export async function getLatestBuild(
  userId: string,
  projectId: string
): Promise<{
  url: string
  buildHash: string
} | null> {
  const indexPath = `${userId}/${projectId}/index.html`
  
  const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(indexPath, 3600)

  if (signedUrlError || !signedUrlData) {
    console.error('Error creating signed URL:', signedUrlError)
    return null
  }

  // Use a simple hash for now
  const buildHash = crypto.createHash('sha256')
    .update(`${projectId}-${Date.now()}`)
    .digest('hex')

  return {
    url: signedUrlData.signedUrl,
    buildHash
  }
}

/**
 * Generate a build hash from files
 */
export function generateBuildHash(files: Array<{ path: string; content: string | Buffer }>): string {
  const content = files
    .map(f => `${f.path}:${Buffer.isBuffer(f.content) ? f.content.toString() : f.content}`)
    .join('\n')
  
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Get content type from file extension
 */
function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject'
  }
  return types[ext || ''] || 'application/octet-stream'
}


