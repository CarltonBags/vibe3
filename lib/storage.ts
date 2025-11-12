import { supabaseAdmin } from './supabase'
import * as crypto from 'crypto'

const BUCKET_NAME = 'project-builds'
const ASSETS_BUCKET_NAME = 'project-assets'

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
 * Upload a project asset (image, logo, etc.) to Supabase Storage
 * Returns the storage path and public URL
 */
export async function uploadProjectAsset(
  userId: string,
  projectId: string,
  file: { name: string; content: Buffer | string; mimeType?: string }
): Promise<{ storagePath: string; publicUrl: string }> {
  console.log(`📤 Uploading asset ${file.name} for project ${projectId}`)
  
  // Generate unique filename to avoid conflicts
  const timestamp = Date.now()
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const filename = `${timestamp}-${sanitizedName}`
  const storagePath = `${userId}/${projectId}/assets/${filename}`
  
  // Convert string to Buffer if needed
  const buffer = Buffer.isBuffer(file.content) 
    ? file.content 
    : Buffer.from(file.content, 'base64')
  
  // Determine content type
  const contentType = file.mimeType || getContentType(file.name)
  
  // Upload to assets bucket (or project-builds/assets if assets bucket doesn't exist)
  const bucketName = ASSETS_BUCKET_NAME
  const { data, error } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true
    })

  if (error) {
    console.error(`Error uploading asset ${file.name}:`, error)
    // Fallback to project-builds bucket if assets bucket doesn't exist
    if (error.message?.includes('Bucket not found')) {
      console.warn(`⚠️ Assets bucket not found, using project-builds bucket`)
      const fallbackPath = `${userId}/${projectId}/assets/${filename}`
      const { data: fallbackData, error: fallbackError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .upload(fallbackPath, buffer, {
          contentType,
          upsert: true
        })
      
      if (fallbackError) {
        throw new Error(`Failed to upload asset: ${fallbackError.message}`)
      }
      
      // Generate public URL (signed URL for private buckets)
      const { data: urlData } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .createSignedUrl(fallbackPath, 31536000) // 1 year
      
      return {
        storagePath: fallbackPath,
        publicUrl: urlData?.signedUrl || `/api/assets/${userId}/${projectId}/${filename}`
      }
    }
    throw new Error(`Failed to upload asset: ${error.message}`)
  }

  console.log(`✅ Uploaded asset ${file.name} to ${storagePath}`)

  // Generate public URL (signed URL for private buckets, or public URL for public buckets)
  const { data: urlData, error: urlError } = await supabaseAdmin.storage
    .from(bucketName)
    .createSignedUrl(storagePath, 31536000) // 1 year expiry

  if (urlError || !urlData) {
    console.warn(`⚠️ Failed to create signed URL for asset, using proxy URL`)
    return {
      storagePath,
      publicUrl: `/api/assets/${userId}/${projectId}/${filename}`
    }
  }

  return {
    storagePath,
    publicUrl: urlData.signedUrl
  }
}

/**
 * Download a project asset from Supabase Storage
 */
export async function downloadProjectAsset(
  storagePath: string,
  bucketName: string = ASSETS_BUCKET_NAME
): Promise<Buffer | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucketName)
      .download(storagePath)

    if (error) {
      // Fallback to project-builds bucket
      if (bucketName === ASSETS_BUCKET_NAME) {
        return downloadProjectAsset(storagePath, BUCKET_NAME)
      }
      console.error(`Error downloading asset ${storagePath}:`, error)
      return null
    }

    return Buffer.from(await data.arrayBuffer())
  } catch (err) {
    console.error(`Error downloading asset ${storagePath}:`, err)
    return null
  }
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
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject'
  }
  return types[ext || ''] || 'application/octet-stream'
}


