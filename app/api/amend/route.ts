import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { 
  incrementUsage, 
  updateProject, 
  saveProjectFiles,
  getUserWithTier
} from '@/lib/db';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

export async function POST(req: Request) {
  const startTime = Date.now();
  let tokensUsed = 0;

  try {
    const { amendmentPrompt, sandboxId, projectId, currentFiles } = await req.json();

    if (!amendmentPrompt || !sandboxId || !projectId) {
      return NextResponse.json(
        { error: 'Amendment prompt, sandbox ID, and project ID are required' },
        { status: 400 }
      );
    }

    // Get authenticated user from cookies
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
    )

    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get user tier info for token limits
    const userWithTier = await getUserWithTier(userId);
    if (!userWithTier) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Cap at model's maximum
    const maxTokens = Math.min(userWithTier.tier.max_tokens_per_generation, 16384);

    console.log(`Processing amendment for project ${projectId}, sandbox ${sandboxId}`);

    // Step 1: Use AI to generate the amendments
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an ELITE Next.js developer making targeted improvements to existing code.

**YOUR TASK**: Apply the user's requested changes to the existing codebase WITHOUT rewriting everything.

**CRITICAL RULES**:
1. Only modify files that NEED to change based on the user's request
2. Keep all existing functionality that isn't being changed
3. Preserve existing components, styling, and structure unless specifically asked to change them
4. Make surgical, precise edits - don't rebuild from scratch
5. Maintain code quality and consistency with the existing codebase

**OUTPUT FORMAT**:
Return a JSON object with ONLY the files that need to be modified:
\`\`\`json
{
  "files": [
    {
      "path": "app/page.tsx",
      "content": "... the UPDATED code ..."
    },
    {
      "path": "app/components/NewComponent.tsx",
      "content": "... new component if needed ..."
    }
  ],
  "summary": "Brief description of changes made"
}
\`\`\`

**IMPORTANT**:
- Only include files that are NEW or MODIFIED
- Do NOT include unchanged files
- Ensure all modified files are complete and functional
- Use TypeScript with proper types
- Use Tailwind CSS for styling
- Maintain 'use client' directive where needed
- AVOID hydration errors: Don't use dynamic content that differs between server/client
- Use stable, consistent rendering (avoid random values, dates, Math.random() in initial render)
- If you need dynamic content, load it in useEffect after mount`
        },
        {
          role: "user",
          content: `Current codebase has these files:
${currentFiles.map((f: any) => `- ${f.path}`).join('\n')}

Here's the main page.tsx content:
\`\`\`typescript
${currentFiles.find((f: any) => f.path === 'app/page.tsx')?.content || 'Not found'}
\`\`\`

**User's amendment request**: ${amendmentPrompt}

Generate ONLY the files that need to change. Return JSON with files array and summary.`
        }
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    });

    let responseText = completion.choices[0]?.message?.content || '';
    tokensUsed = completion.usage?.total_tokens || 0;
    
    // Parse JSON response
    let amendmentData: { files: Array<{ path: string; content: string }>, summary?: string };
    try {
      responseText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      amendmentData = JSON.parse(responseText);
      
      if (!amendmentData.files || !Array.isArray(amendmentData.files)) {
        throw new Error('Invalid response format');
      }

      // Unescape content
      amendmentData.files = amendmentData.files.map(file => ({
        ...file,
        content: file.content
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      }));

      console.log(`AI generated ${amendmentData.files.length} file updates`);
      
    } catch (parseError) {
      console.error('Failed to parse AI amendment response:', parseError);
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    // Step 2: Apply changes to the existing Daytona sandbox
    const daytona = new Daytona({ 
      apiKey: process.env.DAYTONA_KEY || '',
      apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io'
    });

    const sandbox = await daytona.get(sandboxId);

    try {
      // Upload modified files to sandbox
      console.log(`Uploading ${amendmentData.files.length} modified files...`);
      for (const file of amendmentData.files) {
        const filePath = `/workspace/${file.path}`;
        console.log(`Updating: ${filePath}`);
        
        // Create directory if it's a new file in a new location
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dirPath !== '/workspace/app' && dirPath !== '/workspace') {
          try {
            await sandbox.fs.createFolder(dirPath, '755');
          } catch (e) {
            // Folder might already exist, that's fine
          }
        }
        
        await sandbox.fs.uploadFile(Buffer.from(file.content), filePath);
      }

      // Restart Next.js dev server to apply changes
      console.log('Restarting Next.js dev server...');
      await sandbox.process.executeCommand('cd /workspace && pkill -f "next dev" || true');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await sandbox.process.executeCommand('cd /workspace && nohup npm run dev > /tmp/next.log 2>&1 &');
      
      // Wait for server to restart
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Get the preview URL (should be the same)
      const previewLink = await sandbox.getPreviewLink(3000);

      // Merge modified files with existing files for database storage
      const updatedFiles = [...currentFiles];
      for (const modifiedFile of amendmentData.files) {
        const existingIndex = updatedFiles.findIndex(f => f.path === modifiedFile.path);
        if (existingIndex >= 0) {
          updatedFiles[existingIndex] = modifiedFile;
        } else {
          updatedFiles.push(modifiedFile);
        }
      }

      // Update project in database with new files
      await saveProjectFiles(projectId, updatedFiles);

      // Increment token usage (but not generation count)
      await incrementUsage(userId, tokensUsed, false);

      return NextResponse.json({
        success: true,
        url: previewLink.url,
        files: updatedFiles,
        modifiedFiles: amendmentData.files,
        summary: amendmentData.summary || `Updated ${amendmentData.files.length} files`,
        tokensUsed
      });

    } catch (execError) {
      console.error('Amendment execution error:', execError);
      return NextResponse.json({
        success: false,
        error: 'Failed to apply amendments to sandbox',
        details: execError instanceof Error ? execError.message : 'Unknown error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Amendment API error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to process amendment', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

