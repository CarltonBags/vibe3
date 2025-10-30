import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { Octokit } from '@octokit/rest'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const body = await req.json().catch(() => ({})) as { repoName?: string }
    const repoName = (body.repoName || '').trim()

    if (!process.env.GITHUB_TOKEN) {
      return NextResponse.json({ error: 'GitHub token not configured' }, { status: 500 })
    }

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

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = session.user.id

    // Verify project ownership and get project row
    const { data: project, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single()
    if (projErr || !project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Load project files (latest per path)
    const { data: filesData, error: filesError } = await supabaseAdmin
      .from('project_files')
      .select('file_path, file_content, created_at')
      .eq('project_id', projectId)
      .order('file_path', { ascending: true })
      .order('created_at', { ascending: false })
    if (filesError) return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    const latestMap = new Map<string, { path: string; content: string }>()
    for (const f of filesData || []) {
      if (!latestMap.has(f.file_path)) latestMap.set(f.file_path, { path: f.file_path, content: f.file_content })
    }
    const files = Array.from(latestMap.values())

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
    // Get authenticated user (owner)
    const { data: authUser } = await octokit.users.getAuthenticated()
    const owner = authUser.login

    const finalRepoName = repoName || (project.name?.toString().trim().replace(/\s+/g, '-').toLowerCase() || `vibe-project-${projectId.slice(0, 8)}`)

    // Ensure repo exists (create if not)
    let repoUrl = `https://github.com/${owner}/${finalRepoName}`
    try {
      await octokit.repos.get({ owner, repo: finalRepoName })
    } catch {
      await octokit.repos.createForAuthenticatedUser({ name: finalRepoName, private: true })
    }

    // Get default branch and base sha
    const { data: repo } = await octokit.repos.get({ owner, repo: finalRepoName })
    const branch = repo.default_branch
    const ref = await octokit.git.getRef({ owner, repo: finalRepoName, ref: `heads/${branch}` })
    const baseSha = ref.data.object.sha

    // Create tree with files
    const tree = await octokit.git.createTree({
      owner,
      repo: finalRepoName,
      base_tree: baseSha,
      tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }))
    })

    // Create commit
    const commit = await octokit.git.createCommit({ owner, repo: finalRepoName, message: `Initial import for project ${projectId}`, tree: tree.data.sha, parents: [baseSha] })
    await octokit.git.updateRef({ owner, repo: finalRepoName, ref: `heads/${branch}`, sha: commit.data.sha })

    // Update project row with repo url
    await supabaseAdmin
      .from('projects')
      .update({ github_repo_url: repoUrl })
      .eq('id', projectId)

    return NextResponse.json({ success: true, repoUrl })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}


