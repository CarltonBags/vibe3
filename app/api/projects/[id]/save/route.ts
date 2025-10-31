import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getProjectFiles, createBuild, saveProjectFilesToBuild, finalizeBuild, getProjectById, saveFileChunks } from '@/lib/db'
import { uploadBuild } from '@/lib/storage'
import { codeAwareChunks, embedTexts } from '@/lib/embeddings'
import { Daytona } from '@daytonaio/sdk'

interface FileContent { path: string; content: string }

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const projectId = params.id
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID 
      ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
      : 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC || 'placeholder-key',
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
      }
    }
  )

  try {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await _req.json().catch(() => ({}))
    const files: FileContent[] = Array.isArray(body?.files) ? body.files : []
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    // Fetch current project files from DB
    const current = await getProjectFiles(projectId)
    const pathToFile = new Map<string, FileContent>()
    for (const f of current) pathToFile.set(f.file_path, { path: f.file_path, content: f.file_content })
    for (const f of files) pathToFile.set(f.path, f) // apply edits

    // Daytona sandbox setup
    const DAYTONA_KEY = process.env.DAYTONA_KEY
    if (!DAYTONA_KEY) {
      return NextResponse.json({ error: 'Missing DAYTONA_KEY' }, { status: 500 })
    }
    const daytona = new Daytona({ apiKey: DAYTONA_KEY, apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io' })
    const sandbox = await daytona.create({
      image: 'node:20-alpine',
      public: true,
      ephemeral: true,
    })

    try {
      // Upload all files to sandbox (dedupe)
      const allFiles: FileContent[] = Array.from(pathToFile.values())
      for (const f of allFiles) {
        const filePath = `/workspace/${f.path}`
        await sandbox.fs.uploadFile(Buffer.from(f.content), filePath)
      }

      // Install deps and build
      const installResult = await sandbox.process.executeCommand('cd /workspace && npm install')
      if (installResult.exitCode !== 0) {
        throw new Error('Dependency install failed')
      }

      const tscResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit')
      if (tscResult.exitCode !== 0) {
        throw new Error('TypeScript check failed')
      }

      const buildResult = await sandbox.process.executeCommand('cd /workspace && npm run build')
      if (buildResult.exitCode !== 0) {
        throw new Error('Build failed')
      }

      // Collect dist files
      const distListResult = await sandbox.process.executeCommand('cd /workspace && find dist -type f')
      if (!distListResult.result) {
        throw new Error('No dist files found')
      }
      const distFiles: { path: string; content: Buffer }[] = []
      for (const filePath of distListResult.result.trim().split('\n').filter(f => f)) {
        const content = await sandbox.fs.downloadFile(`/workspace/${filePath}`)
        distFiles.push({ path: filePath.replace(/^dist\//, ''), content: content as Buffer })
      }

      if (!distFiles.some(f => f.path === 'index.html')) {
        throw new Error('No index.html in build output')
      }

      // Versioned build + storage upload
      const project = await getProjectById(projectId)
      const buildRecord = await createBuild(projectId, userData.user.id, { status: 'building' })
      await saveProjectFilesToBuild(projectId, buildRecord.id, allFiles.map(f => ({ file_path: f.path, file_content: f.content })))

      const { url, buildHash } = await uploadBuild(userData.user.id, projectId, distFiles)
      const cacheBustUrl = `${url.split('?')[0]}?t=${Date.now()}`
      await finalizeBuild(buildRecord.id, 'completed', { storagePath: cacheBustUrl, buildHash })

      // Update vector chunks for modified files only
      const modified = files
      if (modified.length > 0) {
        const chunks = [] as { file_path: string; chunk_index: number; content: string; embedding: number[] }[]
        for (const f of modified) {
          const parts = codeAwareChunks(f.path, f.content)
          for (let i = 0; i < parts.length; i++) {
            chunks.push({ file_path: f.path, chunk_index: i, content: parts[i], embedding: [] as unknown as number[] })
          }
        }
        const embeddings = await embedTexts(chunks.map(c => c.content))
        for (let i = 0; i < chunks.length; i++) {
          (chunks[i] as any).embedding = embeddings[i]
        }
        await saveFileChunks(projectId, buildRecord.id, chunks)
      }

      return NextResponse.json({ success: true, url: cacheBustUrl, files: allFiles, buildHash })
    } finally {
      try { await daytona.delete(sandbox) } catch {}
    }
  } catch (err) {
    console.error('Save route error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}


