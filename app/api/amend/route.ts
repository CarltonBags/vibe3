import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import instructions from './systemPrompt';
import { GoogleGenAI } from "@google/genai";
import { 
  incrementUsage, 
  updateProject, 
  saveProjectFiles,
  getUserWithTier
} from '@/lib/db';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_KEY });

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
    /*
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an ELITE Next.js developer making targeted improvements to existing code while ensuring code is valid..

**YOUR TASK**: Apply the user's requested changes to the existing codebase WITHOUT rewriting everything.

**CRITICAL RULES**:
1. Only modify files that NEED to change based on the user's request. Create every component that you import elsewhere. The application MUST compile withuout errors.
2. Keep all existing functionality that isn't being changed
3. The application must be functional and complete, with all the features and components the user requested
4. Preserve existing components, styling, and structure unless specifically asked to change them
5. Make surgical, precise edits - don't rebuild from scratch
6. Maintain code quality and consistency with the existing codebase
7. **NEVER MODIFY THESE CORE FILES**: app/layout.tsx, app/globals.css, package.json, next.config.js, tailwind.config.js, tsconfig.json
8. Only modify user-facing files: app/page.tsx, app/components/*.tsx, app/types/*.ts, app/utils/*.ts

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
    });*/

    const completions = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a senior Next.js developer specializing in precise, minimal code updates.



Your job: apply the user's requested change to the existing Next.js codebase **with the smallest necessary modifications**.

**RULES**:
0. read the description.md file in the root of the project to understand the application and the user's request.
1. Only modify or create files that are directly impacted by the user’s request. 
2. Keep all other functionality, imports, and styles unchanged.
3. Never touch these files: 
   - app/layout.tsx 
   - app/globals.css 
   - package.json 
   - next.config.js 
   - tailwind.config.js 
   - tsconfig.json
4. Ensure the app compiles with no TypeScript or runtime errors.
5. Use "use client" at the top of any client component.
6. Use Tailwind CSS for styling.
7. Output must be valid JSON (no markdown fences, no backticks).

---

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
`
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

    // Prepare the full context with all files for Gemini
    const allComponentFiles = currentFiles.map((f: any) => {
      if (f.path.startsWith('app/components/') || f.path === 'app/page.tsx' || f.path === 'description.md') {
        return `\nFile: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``;
      }
      return '';
    }).filter(Boolean).join('\n\n');

    const fullContext = `Current codebase has these files:
${currentFiles.map((f: any) => `- ${f.path}`).join('\n')}

Here are ALL the component files in the project:
${allComponentFiles}

---

**USER'S AMENDMENT REQUEST**: ${amendmentPrompt}

Please make ONLY the changes requested by the user. Read the files above to understand the current structure before making any modifications.`;

    const completion = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{text: fullContext}],
      config:{systemInstruction: instructions.toString()}
    });

    let responseText = completion.text || '';
    
    // Try to get token usage from Gemini response
    // Gemini doesn't expose usage like OpenAI, so we estimate
    tokensUsed = Math.ceil(responseText.length / 4); // Rough estimate: 1 token ≈ 4 characters
    
    // Log for debugging
    console.log(`Estimated tokens used for amendment: ${tokensUsed}, response length: ${responseText.length}`);


    /*let responseText = completion.choices[0]?.message?.content || '';
    tokensUsed = completion.usage?.total_tokens || 0;*/
    
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

      // Validate component imports match actual file names
      const currentComponentFiles = currentFiles
        .filter((f: any) => f.path.startsWith('app/components/'))
        .map((f: any) => {
          const fileName = f.path.replace('app/components/', '').replace('.tsx', '');
          return fileName;
        });

      console.log('Current component files:', currentComponentFiles);

      // Check if any modifications introduce new components that don't match
      for (const file of amendmentData.files) {
        if (file.path.startsWith('app/page.tsx')) {
          const importMatches = file.content.match(/import\s+[\w\s,{}]+\s+from\s+['"]\.\/components\/(\w+)['"]/g);
          if (importMatches) {
            const importedComponents = importMatches.map(match => {
              const componentMatch = match.match(/import\s+[\w\s,{}]+\s+from\s+['"]\.\/components\/(\w+)['"]/);
              return componentMatch ? componentMatch[1] : null;
            }).filter((comp): comp is string => comp !== null);
            
            const missingComponents = importedComponents.filter(comp => {
              const exists = currentComponentFiles.includes(comp) || 
                            amendmentData.files.some(f => f.path === `app/components/${comp}.tsx`);
              return !exists;
            });

            if (missingComponents.length > 0) {
              console.error(`❌ Missing components detected: ${missingComponents.join(', ')}`);
              // Create placeholder components for missing ones
              for (const componentName of missingComponents) {
                const componentContent = `'use client'

interface Props {
  // Add props as needed
}

export default function ${componentName}({}: Props) {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-2">${componentName}</h3>
      <p className="text-gray-600">Component placeholder</p>
    </div>
  );
}`;
                
                amendmentData.files.push({
                  path: `app/components/${componentName}.tsx`,
                  content: componentContent
                });
                console.log(`✅ Created missing component: ${componentName}.tsx`);
              }
            }
          }
        }
      }

      // Validate: reject modifications to core template files
      const forbiddenFiles = [
        'app/layout.tsx',
        'app/globals.css',
        'package.json',
        'next.config.js',
        'tailwind.config.js',
        'postcss.config.js',
        'tsconfig.json'
      ];

      const invalidFiles = amendmentData.files.filter(f => 
        forbiddenFiles.includes(f.path)
      );

      if (invalidFiles.length > 0) {
        console.warn(`AI tried to modify forbidden files: ${invalidFiles.map(f => f.path).join(', ')}`);
        // Filter them out instead of rejecting the entire request
        amendmentData.files = amendmentData.files.filter(f => 
          !forbiddenFiles.includes(f.path)
        );
        console.log(`Filtered to ${amendmentData.files.length} valid file updates`);
      }

      if (amendmentData.files.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'No valid files to modify. Core template files cannot be changed.'
        }, { status: 400 });
      }
      
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

      // Hard restart Next.js dev server to clear cache and apply changes
      console.log('Restarting Next.js dev server...');
      await sandbox.process.executeCommand('cd /workspace && pkill -9 node || true');
      await sandbox.process.executeCommand('cd /workspace && rm -rf .next || true');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await sandbox.process.executeCommand('cd /workspace && nohup npm run dev > /tmp/next.log 2>&1 &');
      
      // Wait longer for server to fully restart (amendment case)
      console.log('Waiting for Next.js to rebuild...');
      await new Promise(resolve => setTimeout(resolve, 15000));

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

