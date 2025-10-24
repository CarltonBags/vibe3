import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Get authenticated user
    const cookieStore = await cookies();
    
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
    );

    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const projectId = params.id;

    // Get project from database
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Get project files
    const { data: files, error: filesError } = await supabaseAdmin
      .from('project_files')
      .select('*')
      .eq('project_id', projectId);

    if (filesError || !files || files.length === 0) {
      return NextResponse.json(
        { error: 'Project files not found' },
        { status: 404 }
      );
    }

    console.log(`Reopening project: ${project.name} (${files.length} files)`);

    // Initialize Daytona
    const daytona = new Daytona({
      apiKey: process.env.DAYTONA_KEY || '',
      target: process.env.DAYTONA_URL || '',
    });

    // Create new sandbox
    const sandbox = await daytona.create();
    console.log('Sandbox created:', sandbox.id);

    // Upload template files (package.json, etc.)
    const templatesDir = path.join(process.cwd(), 'sandbox-templates');
    const templateFiles = [
      'package.json',
      'tsconfig.json',
      'tailwind.config.js',
      'postcss.config.js',
      'next.config.js',
      '.env.local'
    ];

    for (const file of templateFiles) {
      const filePath = path.join(templatesDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        await sandbox.fs.writeFile(file, content);
      }
    }

    // Upload saved project files
    for (const file of files) {
      await sandbox.fs.writeFile(file.file_path, file.content);
      console.log(`Uploaded: ${file.file_path}`);
    }

    // Install dependencies
    console.log('Installing dependencies...');
    await sandbox.process.executeCommand('npm install');

    // Start dev server
    console.log('Starting dev server...');
    await sandbox.process.executeCommand('npm run dev', {
      background: true,
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get public URL
    const url = await sandbox.getUrl(3000);
    console.log('Public URL:', url);

    // Update project with new sandbox URL
    await supabaseAdmin
      .from('projects')
      .update({
        sandbox_url: url,
        updated_at: new Date().toISOString()
      })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      sandboxId: sandbox.id,
      url,
      projectId,
      projectName: project.name
    });

  } catch (error) {
    console.error('Error reopening project:', error);
    return NextResponse.json(
      { error: 'Failed to reopen project' },
      { status: 500 }
    );
  }
}

