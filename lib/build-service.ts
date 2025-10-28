import { supabaseAdmin } from './supabase'
import type { Sandbox } from '@daytona/ts-sdk'
import fs from 'fs/promises'
import path from 'path'

export interface BuildResult {
  success: boolean
  buildHash?: string
  version?: number
  error?: string
}

/**
 * Build a Vite project in the sandbox
 */
export async function buildViteProject(sandbox: Sandbox): Promise<BuildResult> {
  try {
    console.log('🔨 Building Vite project...')

    // Clean previous build
    await sandbox.process.executeCommand('cd /workspace && rm -rf dist || true')

    // Build the project
    console.log('Running npm run build...')
    const buildResult = await sandbox.process.executeCommand(
      'cd /workspace && npm run build 2>&1 || true'
    )

    console.log('Build output:', buildResult.result?.substring(0, 500))

    // Check if build was successful by looking for dist directory
    const distCheck = await sandbox.process.executeCommand(
      'cd /workspace && ls -la dist/ 2>&1 || echo "NO_DIST"'
    )

    if (distCheck.result?.includes('NO_DIST') || distCheck.result?.includes('No such file')) {
      return {
        success: false,
        error: 'Build failed: dist directory not found'
      }
    }

    // List all files in dist
    const listResult = await sandbox.process.executeCommand(
      'cd /workspace && find dist -type f 2>&1 || echo "FAILED"'
    )

    if (listResult.result?.includes('FAILED')) {
      return {
        success: false,
        error: 'Failed to list build files'
      }
    }

    console.log('✅ Build successful!')
    return {
      success: true
    }
  } catch (error) {
    console.error('Build error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown build error'
    }
  }
}

/**
 * Upload build files from sandbox to Supabase storage
 */
export async function uploadBuildFiles(
  userId: string,
  projectId: string,
  sandbox: Sandbox,
  version: number
): Promise<{ urls: string[], buildHash: string } | null> {
  try {
    console.log(`📤 Uploading build files (version ${version})...`)

    // Get list of all files in dist
    const listResult = await sandbox.process.executeCommand(
      'cd /workspace && find dist -type f | head -100'
    )

    if (!listResult.result) {
      throw new Error('No build files found')
    }

    const files = listResult.result
      .trim()
      .split('\n')
      .filter(f => f && f.startsWith('dist/'))

    console.log(`Found ${files.length} files to upload`)

    const uploadedFiles: string[] = []
    const fileContents: string[] = []

    // Upload each file
    for (const filePath of files) {
      const content = await sandbox.fs.downloadFile(`/workspace/${filePath}`)
      const relativePath = filePath.replace('dist/', '')
      const storagePath = `${userId}/${projectId}/v${version}/${relativePath}`

      // Determine content type
      const contentType = getContentType(relativePath)

      const { error } = await supabaseAdmin.storage
        .from('project-builds')
        .upload(storagePath, content, {
          contentType,
          upsert: true
        })

      if (error) {
        console.error(`Error uploading ${relativePath}:`, error)
        continue
      }

      uploadedFiles.push(storagePath)
      fileContents.push(`${relativePath}:${content}`)
    }

    // Generate build hash
    const buildHash = require('crypto')
      .createHash('sha256')
      .update(fileContents.join('\n'))
      .digest('hex')

    console.log('✅ Upload complete. Build hash:', buildHash)

    return { urls: uploadedFiles, buildHash }
  } catch (error) {
    console.error('Upload error:', error)
    return null
  }
}

/**
 * Get content type from file path
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

