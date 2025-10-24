import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Await params (Next.js 15+ requirement)
    const { id: projectId } = await params;
    
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
      apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io',
    });

    // Clean up old sandbox if it exists (to free up runner capacity)
    if (project.sandbox_id) {
      try {
        console.log(`Cleaning up old sandbox: ${project.sandbox_id}`);
        const oldSandbox = await daytona.get(project.sandbox_id);
        await oldSandbox.remove();
        console.log('Old sandbox removed successfully');
      } catch (cleanupError) {
        console.warn('Could not remove old sandbox (might already be deleted):', cleanupError);
        // Continue anyway - old sandbox might already be gone
      }
    }

    // Create new sandbox (same as /api/generate)
    console.log('Creating fresh sandbox...');
    const sandbox = await daytona.create();
    console.log('Sandbox created:', sandbox.id);

    try {
      // Read template files
      const templatesPath = path.join(process.cwd(), 'sandbox-templates');
      const packageJson = fs.readFileSync(path.join(templatesPath, 'package.json'), 'utf-8');
      const nextConfig = fs.readFileSync(path.join(templatesPath, 'next.config.js'), 'utf-8');
      const tailwindConfig = fs.readFileSync(path.join(templatesPath, 'tailwind.config.js'), 'utf-8');
      const postcssConfig = fs.readFileSync(path.join(templatesPath, 'postcss.config.js'), 'utf-8');
      const tsConfig = fs.readFileSync(path.join(templatesPath, 'tsconfig.json'), 'utf-8');
      const globalsCss = '@tailwind base;\n@tailwind components;\n@tailwind utilities;';
      const layoutTsx = fs.readFileSync(path.join(templatesPath, 'app/layout.tsx'), 'utf-8');

      // Create project structure in sandbox
      // Try to create folders, ignore errors if they already exist
      try {
        await sandbox.fs.createFolder('/workspace/app', '755');
      } catch (e) {
        console.log('Folder /workspace/app might already exist, continuing...');
      }
      try {
        await sandbox.fs.createFolder('/workspace/app/components', '755');
      } catch (e) {
        console.log('Folder /workspace/app/components might already exist, continuing...');
      }
      try {
        await sandbox.fs.createFolder('/workspace/app/types', '755');
      } catch (e) {
        console.log('Folder /workspace/app/types might already exist, continuing...');
      }
      try {
        await sandbox.fs.createFolder('/workspace/app/utils', '755');
      } catch (e) {
        console.log('Folder /workspace/app/utils might already exist, continuing...');
      }
    
    // Write configuration files
    await sandbox.fs.uploadFile(Buffer.from(packageJson), '/workspace/package.json');
    await sandbox.fs.uploadFile(Buffer.from(nextConfig), '/workspace/next.config.js');
    await sandbox.fs.uploadFile(Buffer.from(tailwindConfig), '/workspace/tailwind.config.js');
    await sandbox.fs.uploadFile(Buffer.from(postcssConfig), '/workspace/postcss.config.js');
    await sandbox.fs.uploadFile(Buffer.from(tsConfig), '/workspace/tsconfig.json');
    await sandbox.fs.uploadFile(Buffer.from(globalsCss), '/workspace/app/globals.css');
    await sandbox.fs.uploadFile(Buffer.from(layoutTsx), '/workspace/app/layout.tsx');

    // Upload saved project files
    console.log(`Uploading ${files.length} saved files...`);
    for (const file of files) {
      const filePath = `/workspace/${file.file_path}`;
      console.log(`Uploading: ${filePath}`);
      await sandbox.fs.uploadFile(Buffer.from(file.content), filePath);
    }

    // Install dependencies
    console.log('Installing dependencies...');
    await sandbox.process.executeCommand('cd /workspace && npm install');

    // Start dev server
    console.log('Starting Next.js dev server...');
    await sandbox.process.executeCommand('cd /workspace && nohup npm run dev > /tmp/next.log 2>&1 &');

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 12000));

    // Get the preview URL
    const previewLink = await sandbox.getPreviewLink(3000);
    const url = previewLink.url;
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

    } catch (execError) {
      // If setup fails, clean up the sandbox
      console.error('Failed to set up sandbox, cleaning up...', execError);
      try {
        const sandboxToRemove = await daytona.get(sandbox.id);
        await sandboxToRemove.remove();
        console.log('Failed sandbox cleaned up successfully');
      } catch (cleanupErr) {
        console.warn('Could not cleanup failed sandbox:', cleanupErr);
      }
      throw execError; // Re-throw to outer catch
    }

  } catch (error) {
    console.error('Error reopening project:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check for specific Daytona errors
    if (errorMessage.includes('No available runners')) {
      return NextResponse.json(
        { error: 'Daytona has no available compute resources right now. Please try again in a few minutes or contact support.' },
        { status: 503 } // Service Unavailable
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to reopen project', details: errorMessage },
      { status: 500 }
    );
  }
}

