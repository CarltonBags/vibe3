import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

// GET endpoint for viewing project preview (no sandbox spawning)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    // Return the preview URL directly
    return NextResponse.json({
      success: true,
      url: project.preview_url,
      projectId: project.id,
      projectName: project.name
    });

  } catch (error) {
    console.error('Error getting project preview:', error);
    return NextResponse.json(
      { error: 'Failed to get project preview' },
      { status: 500 }
    );
  }
}

// POST endpoint for reopening with sandbox (for amendments)
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

    // Try to reuse existing sandbox, or create a new one if it doesn't exist
    let sandbox;
    let sandboxId;
    let isNewSandbox = false;
    if (project.sandbox_id) {
      try {
        console.log(`Checking if existing sandbox ${project.sandbox_id} is still alive...`);
        sandbox = await daytona.get(project.sandbox_id);
        sandboxId = project.sandbox_id;
        console.log('✅ Reusing existing sandbox:', sandboxId);
        
        // Quick health check - try to list files
        await sandbox.process.executeCommand('pwd');
      } catch (getError) {
        console.log('⚠️ Existing sandbox not found or dead, creating new one:', getError);
        sandbox = null;
      }
    }
    
    // Create new sandbox if needed
    if (!sandbox) {
      console.log('Creating new sandbox...');
      sandbox = await daytona.create({
        image: 'node:20-alpine',
        ephemeral: true,
        public: true,
        envVars: {
          NODE_ENV: 'development'
        }
      });
      sandboxId = sandbox.id;
      isNewSandbox = true;
      console.log('Sandbox created:', sandboxId);
    }

    try {
      // Only setup sandbox if it's new
      if (isNewSandbox) {
        // Auto-detect template type from package.json
        const packageJsonFile = files.find((f: any) => f.file_path === 'package.json');
        let isVite = false;
        if (packageJsonFile) {
          try {
            const pkg = JSON.parse(packageJsonFile.file_content);
            isVite = pkg.devDependencies && pkg.devDependencies.vite;
          } catch {}
        }
        
        if (isVite) {
          console.log('📦 Detected Vite template, using Vite handler');
          // Use Vite handler
          const { ViteHandler } = await import('@/app/api/generate/templates/vite-handler');
          const handler = new ViteHandler();
          await handler.setupProject(sandbox);
        } else {
          console.log('📦 Detected Next.js template, using Next.js config');
          // Read template files (Next.js)
          const templatesPath = path.join(process.cwd(), 'sandbox-templates');
          const packageJson = fs.readFileSync(path.join(templatesPath, 'package.json'), 'utf-8');
          const nextConfig = fs.readFileSync(path.join(templatesPath, 'next.config.js'), 'utf-8');
          const tailwindConfig = fs.readFileSync(path.join(templatesPath, 'tailwind.config.js'), 'utf-8');
          const postcssConfig = fs.readFileSync(path.join(templatesPath, 'postcss.config.js'), 'utf-8');
          const tsConfig = fs.readFileSync(path.join(templatesPath, 'tsconfig.json'), 'utf-8');
          const globalsCss = '@tailwind base;\n@tailwind components;\n@tailwind utilities;';
          const layoutTsx = fs.readFileSync(path.join(templatesPath, 'app/layout.tsx'), 'utf-8');

          // Create project structure in sandbox
          await sandbox.fs.createFolder('/workspace/app', '755');
          await sandbox.fs.createFolder('/workspace/app/components', '755');
          await sandbox.fs.createFolder('/workspace/app/types', '755');
          await sandbox.fs.createFolder('/workspace/app/utils', '755');
        
          // Write configuration files
          await sandbox.fs.uploadFile(Buffer.from(packageJson), '/workspace/package.json');
          await sandbox.fs.uploadFile(Buffer.from(nextConfig), '/workspace/next.config.js');
          await sandbox.fs.uploadFile(Buffer.from(tailwindConfig), '/workspace/tailwind.config.js');
          await sandbox.fs.uploadFile(Buffer.from(postcssConfig), '/workspace/postcss.config.js');
          await sandbox.fs.uploadFile(Buffer.from(tsConfig), '/workspace/tsconfig.json');
          await sandbox.fs.uploadFile(Buffer.from(globalsCss), '/workspace/app/globals.css');
          await sandbox.fs.uploadFile(Buffer.from(layoutTsx), '/workspace/app/layout.tsx');
        }

        // Upload saved project files (dedup by path)
        const uniqueFiles = Array.from(new Map(files.map(f => [f.file_path, f])).values());
        console.log(`Uploading ${uniqueFiles.length} saved files...`);
        for (const file of uniqueFiles) {
          if (!file.file_content) {
            console.warn(`Skipping file with no content: ${file.file_path}`);
            continue;
          }
          const filePath = `/workspace/${file.file_path}`;
          console.log(`Uploading: ${filePath}`);
          await sandbox.fs.uploadFile(Buffer.from(file.file_content), filePath);
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
        
        // Update project with new sandbox info only if this was a new sandbox
        await supabaseAdmin
          .from('projects')
          .update({
            sandbox_id: sandboxId,
            sandbox_url: url,
            updated_at: new Date().toISOString()
          })
          .eq('id', projectId);

        return NextResponse.json({
          success: true,
          sandboxId: sandboxId,
          url,
          projectId,
          projectName: project.name
        });
      } else {
        // Reusing existing sandbox - just return its info
        console.log('✅ Returning existing sandbox info');
        return NextResponse.json({
          success: true,
          sandboxId: sandboxId,
          url: project.sandbox_url || project.preview_url,
          projectId,
          projectName: project.name
        });
      }

    } catch (execError) {
      // If setup fails, clean up the sandbox
      console.error('Failed to set up sandbox, cleaning up...', execError);
      try {
        await daytona.delete(sandbox);
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

