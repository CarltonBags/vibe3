import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Await params (Next.js 15+ requirement)
    const { id: projectId } = await params;
    
    // Get authenticated user
    const cookieStore = await cookies()
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID 
        ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
        : 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC || 'placeholder-key',
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Verify project belongs to user
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Check for build targeting via query
    const url = new URL(req.url)
    const buildId = url.searchParams.get('buildId')
    const buildVersionParam = url.searchParams.get('buildVersion')

    let filesData: any[] | null = null
    let filesError: any = null

    if (buildId) {
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('file_path, file_content, created_at')
        .eq('project_id', projectId)
        .eq('build_id', buildId)
        .order('file_path', { ascending: true })
      filesData = data
      filesError = error
    } else if (buildVersionParam) {
      // Resolve build by version
      const version = parseInt(buildVersionParam, 10)
      const { data: buildRow } = await supabaseAdmin
        .from('builds')
        .select('id')
        .eq('project_id', projectId)
        .eq('version', isNaN(version) ? -1 : version)
        .maybeSingle()
      if (buildRow) {
        const { data, error } = await supabaseAdmin
          .from('project_files')
          .select('file_path, file_content, created_at')
          .eq('project_id', projectId)
          .eq('build_id', buildRow.id)
          .order('file_path', { ascending: true })
        filesData = data
        filesError = error
      }
    }

    // Default to latest by created_at per path if no build found/selected
    if (!filesData) {
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('file_path, file_content, created_at')
        .eq('project_id', projectId)
        .order('file_path', { ascending: true })
        .order('created_at', { ascending: false })
      filesData = data
      filesError = error
    }

    if (filesError) {
      console.error('Error fetching files:', filesError)
      return NextResponse.json(
        { error: 'Failed to fetch files' },
        { status: 500 }
      )
    }

    // Deduplicate by file_path, keeping latest by created_at
    const latestMap = new Map<string, { path: string; content: string }>()
    for (const f of filesData || []) {
      if (!latestMap.has(f.file_path)) {
        latestMap.set(f.file_path, { path: f.file_path, content: f.file_content })
      }
    }
    const files = Array.from(latestMap.values())

    return NextResponse.json({ files })
  } catch (error) {
    console.error('Error in files API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

