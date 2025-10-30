import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import instructions from './systemPrompt-vite';
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
    const requestId = Math.random().toString(36).slice(2, 8)

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

    console.log(`[amend:${requestId}] start project=${projectId} sandbox=${sandboxId} promptLen=${(amendmentPrompt||'').length}`);

    // Semantic target selection: find relevant files via vector search
    try {
      const { embedTexts } = await import('@/lib/embeddings')
      const { matchFileChunks } = await import('@/lib/db')
      const [queryEmbedding] = await embedTexts([amendmentPrompt])
      const matches = await matchFileChunks(projectId, queryEmbedding, 30)
      const topFiles = Array.from(new Set(matches.map(m => m.file_path))).slice(0, 12)
      console.log(`[amend:${requestId}] vector matches=${matches.length} top=${topFiles.slice(0,10).join(', ')}`)
      if (Array.isArray(currentFiles) && currentFiles.length) {
        // Narrow currentFiles to only relevant ones, but keep a small buffer
        let narrowed = currentFiles.filter((f: any) => topFiles.includes(f.path)).slice(0, 20)
        // Literal search fallback: include files with prompt terms
        try {
          const terms = Array.from(new Set((amendmentPrompt.match(/[A-Za-z][A-Za-z0-9]{2,}/g) || []).map((w: string) => w.toLowerCase()))).slice(0,5)
          if (terms.length) {
            const literalHits = currentFiles.filter((f: any) => {
              const text = (f.content || '').toLowerCase()
              return terms.some(t => text.includes(t))
            }).map((f: any) => f.path)
            const merged = new Set<string>([...narrowed.map((f:any)=>f.path), ...literalHits])
            narrowed = currentFiles.filter((f: any) => merged.has(f.path)).slice(0, 24)
          }
        } catch {}
        if (narrowed.length >= 1) {
          // Replace currentFiles context for AI with narrowed set
          (global as any).__amendRelevantFiles = narrowed
          console.log(`[amend:${requestId}] narrowed files=${narrowed.length}`)
        }
      }
    } catch (e) {
      console.error(`[amend:${requestId}] vector search failed:`, e)
    }

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
    const narrowedFiles: any[] = (global as any).__amendRelevantFiles || currentFiles
    const allComponentFiles = narrowedFiles.map((f: any) => {
      if (f.path.startsWith('app/components/') || f.path === 'app/page.tsx' || f.path === 'description.md') {
        return `\nFile: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``;
      }
      return '';
    }).filter(Boolean).join('\n\n');

    // Pull short amendment history for context (last 5)
    let historyBlock = ''
    try {
      const { getRecentAmendments } = await import('@/lib/db')
      const recent = await getRecentAmendments(projectId, 5)
      if (recent && recent.length) {
        const lines = recent.map((a: any) => {
          const when = new Date(a.created_at).toISOString()
          const files = Array.isArray(a.file_paths) ? a.file_paths.slice(0, 6).join(', ') : ''
          const summary = a.summary || ''
          return `- ${when}: ${summary} [files: ${files}]`
        }).join('\n')
        historyBlock = `\nRECENT AMENDMENTS (most recent first, short):\n${lines}\n\n`
      }
    } catch (e) {
      // ignore
    }

    const fullContext = `${historyBlock}Current codebase has these files (subset relevant to the request):
${narrowedFiles.map((f: any) => `- ${f.path}`).join('\n')}

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
    console.log(`[amend:${requestId}] gemini len=${responseText.length} snippet=${responseText.slice(0,300)}`)
    
    // Try to get token usage from Gemini response
    // Gemini doesn't expose usage like OpenAI, so we estimate
    tokensUsed = Math.ceil(responseText.length / 4); // Rough estimate: 1 token ≈ 4 characters
    
    // Log for debugging
    console.log(`Estimated tokens used for amendment: ${tokensUsed}, response length: ${responseText.length}`);


    /*let responseText = completion.choices[0]?.message?.content || '';
    tokensUsed = completion.usage?.total_tokens || 0;*/
    
    // Parse JSON response with robust error handling
    let amendmentData: { files: Array<{ path: string; content: string }>, summary?: string };
    try {
      // Clean markdown formatting if present
      let cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      // Try to extract JSON if it's embedded in text
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*"files"[\s\S]*\}/);
      if (jsonMatch) {
        cleanedResponse = jsonMatch[0];
      }

      // Fix common JSON issues
      cleanedResponse = cleanedResponse.replace(/,(\s*[}\]])/g, '$1');

      try {
        amendmentData = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('❌ Failed to parse cleaned JSON:', parseError);
        // Fallback: Try manual cleanup
        let fallbackJson = cleanedResponse
          .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
          .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
          .replace(/,\s*([})\]])/g, '$1'); // Remove commas before closing brackets

        amendmentData = JSON.parse(fallbackJson);
        console.log('✅ Successfully parsed with fallback cleanup');
      }

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

      // Allow modifications to most application files, only forbid truly core system files
      const forbiddenFiles = [
        'package.json',
        'next.config.js',
        'tsconfig.json',
        'vite.config.ts',
        'tailwind.config.js',
        'postcss.config.js'
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
          error: 'No valid files to modify. Core system files cannot be changed.'
        }, { status: 400 });
      }

      // Safely allow a small number of new files to extend the app (whitelist + cap)
      try {
        const existingPaths = new Set<string>((currentFiles || []).map((f: any) => f.path))
        const allowedPrefixes = [
          'src/components/',
          'src/pages/',
          'src/lib/',
          'src/hooks/',
          'src/assets/',
          'public/'
        ]
        const isSafePath = (p: string) => !p.startsWith('/') && !p.includes('..') && allowedPrefixes.some(pref => p.startsWith(pref))
        const newFiles = amendmentData.files.filter(f => !existingPaths.has(f.path))
        const unsafe = newFiles.filter(f => !isSafePath(f.path))
        if (unsafe.length) {
          // Remove unsafe new files
          const unsafeSet = new Set(unsafe.map(f => f.path))
          amendmentData.files = amendmentData.files.filter(f => !unsafeSet.has(f.path))
        }
        // Cap number of new files
        const safeNewFiles = amendmentData.files.filter(f => !existingPaths.has(f.path))
        if (safeNewFiles.length > 3) {
          const keepSet = new Set(safeNewFiles.slice(0, 3).map(f => f.path))
          amendmentData.files = amendmentData.files.filter(f => existingPaths.has(f.path) || keepSet.has(f.path))
        }
      } catch (e) {
        console.error('New file safety filtering failed:', e)
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

      // Fix FontAwesome imports in all modified files
      console.log('🔧 Checking for FontAwesome import issues...');
      for (const file of amendmentData.files) {
        if (file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
          let content = file.content;

          // Fix FontAwesome imports and prevent wrong imports
          if (content.includes('FontAwesomeIcon') || content.includes('fa') || content.includes('@fortawesome/free-brands-svg-icons')) {
            // Remove wrong brand imports (they don't exist)
            if (content.includes('@fortawesome/free-brands-svg-icons')) {
              console.log(`🔧 Removing incorrect FontAwesome brand import from ${file.path}`);
              content = content.replace(/import\s+.*?from\s+['"]@fortawesome\/free-brands-svg-icons['"];?\s*/g, '');
            }

            // Add FontAwesomeIcon import
            if (!content.includes('@fortawesome/react-fontawesome')) {
              console.log(`🔧 Adding missing FontAwesomeIcon import to ${file.path}`);
              const importLine = "import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';\n";
              const firstImportIndex = content.indexOf("import ");
              if (firstImportIndex !== -1) {
                content = content.slice(0, firstImportIndex) + importLine + content.slice(firstImportIndex);
              } else {
                content = importLine + content;
              }
            }

          // Extract fa icon names from the content
          const faIconMatches = content.match(/fa[A-Z]\w+/g) || [];
          if (faIconMatches.length > 0) {
            const uniqueIcons = Array.from(new Set(faIconMatches));

            // Categorize icons by package
            const solidIcons = [];
            const brandIcons = [];
            const regularIcons = [];

            for (const icon of uniqueIcons) {
              // Social media and brand icons go to brands package
              if (icon.includes('Twitter') || icon.includes('Discord') || icon.includes('Github') ||
                  icon.includes('Facebook') || icon.includes('Instagram') || icon.includes('Linkedin') ||
                  icon.includes('Youtube') || icon.includes('Gitlab') || icon.includes('Slack') ||
                  icon.includes('Telegram') || icon.includes('Whatsapp')) {
                brandIcons.push(icon);
              }
              // Regular icons (circle, square, etc.) go to regular package
              else if (icon.includes('Circle') || icon.includes('Square') || icon.includes('Rectangle') ||
                       icon.includes('Triangle') || icon.includes('Diamond') || icon.includes('Hexagon')) {
                regularIcons.push(icon);
              }
              // Everything else goes to solid (default)
              else {
                solidIcons.push(icon);
              }
            }

            // Add solid icons import
            if (solidIcons.length > 0 && !content.includes('@fortawesome/free-solid-svg-icons')) {
              const iconImportLine = `import { ${solidIcons.join(', ')} } from '@fortawesome/free-solid-svg-icons';\n`;
              const firstImportIndex = content.indexOf("import ");
              if (firstImportIndex !== -1) {
                content = content.slice(0, firstImportIndex) + iconImportLine + content.slice(firstImportIndex);
              } else {
                content = iconImportLine + content;
              }
            }

            // Add brand icons import
            if (brandIcons.length > 0 && !content.includes('@fortawesome/free-brands-svg-icons')) {
              const iconImportLine = `import { ${brandIcons.join(', ')} } from '@fortawesome/free-brands-svg-icons';\n`;
              const firstImportIndex = content.indexOf("import ");
              if (firstImportIndex !== -1) {
                content = content.slice(0, firstImportIndex) + iconImportLine + content.slice(firstImportIndex);
              } else {
                content = iconImportLine + content;
              }
            }

            // Add regular icons import
            if (regularIcons.length > 0 && !content.includes('@fortawesome/free-regular-svg-icons')) {
              const iconImportLine = `import { ${regularIcons.join(', ')} } from '@fortawesome/free-regular-svg-icons';\n`;
              const firstImportIndex = content.indexOf("import ");
              if (firstImportIndex !== -1) {
                content = content.slice(0, firstImportIndex) + iconImportLine + content.slice(firstImportIndex);
              } else {
                content = iconImportLine + content;
              }
            }
          }

            // Re-upload the fixed file
            const filePath = `/workspace/${file.path}`;
            await sandbox.fs.uploadFile(Buffer.from(content), filePath);
            console.log(`✅ Fixed FontAwesome imports in ${file.path}`);
          }

          // Fix union type issues (status must be literal values)
          if (content.includes('status:') || content.includes('status=')) {
            // Look for status assignments and ensure they use literal strings
            const statusPatterns = [
              /status:\s*["']?(\w+)["']?/g,  // status: "value" or status: value
              /status=\s*["']?(\w+)["']?/g   // status="value" or status=value
            ];

            for (const pattern of statusPatterns) {
              content = content.replace(pattern, (match, statusValue) => {
                // Convert generic status values to valid literals
                if (statusValue === 'completed' || statusValue === 'current' || statusValue === 'upcoming') {
                  return match; // Already correct
                } else if (statusValue.includes('complete') || statusValue.includes('done')) {
                  return match.replace(statusValue, 'completed');
                } else if (statusValue.includes('current') || statusValue.includes('active') || statusValue.includes('now')) {
                  return match.replace(statusValue, 'current');
                } else {
                  return match.replace(statusValue, 'upcoming'); // Default fallback
                }
              });
            }

            // Re-upload if we made changes
            const filePath = `/workspace/${file.path}`;
            await sandbox.fs.uploadFile(Buffer.from(content), filePath);
            console.log(`✅ Fixed union type issues in ${file.path}`);
          }
        }
      }

      // Clear any existing build cache
      console.log('🧹 Clearing build cache...');
      await sandbox.process.executeCommand('cd /workspace && rm -rf dist node_modules/.vite node_modules/.cache || true');

      // Run preflight TypeScript check
      console.log('🔍 Running preflight TypeScript check...');
      const tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
      const tsErrors = tsCheckResult.result || '';

      if (tsErrors.includes('error TS')) {
        console.log('⚠️ TypeScript errors detected, attempting auto-fix...');

        // Try to fix common issues
        for (const file of amendmentData.files) {
          if (file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
            let content = file.content;

            // If the file has issues, try to read the current content and fix it
            try {
              const currentContent = await sandbox.fs.downloadFile(`/workspace/${file.path}`);
              content = currentContent.toString('utf-8');

              // Check for common issues and fix them
              if (tsErrors.includes('FontAwesomeIcon') && content.includes('FontAwesomeIcon') && !content.includes('@fortawesome/react-fontawesome')) {
                console.log(`🔧 Adding missing FontAwesome import to ${file.path}`);
                const importLine = "import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';\n";
                const firstImportIndex = content.indexOf("import ");
                if (firstImportIndex !== -1) {
                  content = content.slice(0, firstImportIndex) + importLine + content.slice(firstImportIndex);
                } else {
                  content = importLine + content;
                }
                await sandbox.fs.uploadFile(Buffer.from(content), `/workspace/${file.path}`);
              }

              // Re-check after fixes
              const recheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
              if (!recheckResult.result?.includes('error TS')) {
                console.log('✅ TypeScript errors fixed');
              } else {
                console.log('⚠️ Some TypeScript errors remain, proceeding with build anyway');
              }
            } catch (fixError) {
              console.log(`⚠️ Could not auto-fix ${file.path}:`, fixError);
            }
          }
        }
      }

      // Build Vite project for production (not Next.js anymore)
      console.log('🔨 Building Vite project...');
      const buildCommand = await sandbox.process.executeCommand('cd /workspace && npm run build');
      console.log('Build result:', buildCommand.result?.substring(0, 500));

      if (buildCommand.result?.includes('error') || buildCommand.result?.includes('Error')) {
        console.error('❌ Build failed:', buildCommand.result);
        console.error('🚫 NOT saving broken code to database - build failed');
        throw new Error('Build failed: ' + buildCommand.result);
      }

      // Additional validation: check that index.html was actually built
      try {
        const indexExists = await sandbox.process.executeCommand('cd /workspace && test -f dist/index.html && echo "EXISTS" || echo "MISSING"');
        if (!indexExists.result?.includes('EXISTS')) {
          console.error('❌ Build failed: index.html not found in dist/');
          console.error('🚫 NOT saving broken code to database - missing index.html');
          throw new Error('Build validation failed: index.html not generated');
        }
      } catch (validationError) {
        console.error('❌ Build validation error:', validationError);
        const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
        throw new Error('Build validation failed: ' + errorMessage);
      }

      // Get all build files from dist
      console.log('📦 Collecting build files...');
      const listResult = await sandbox.process.executeCommand('cd /workspace && find dist -type f');
      console.log('List result:', listResult.result);
      
      if (!listResult.result) {
        throw new Error('Build produced no files');
      }

      const buildFiles = listResult.result
        .trim()
        .split('\n')
        .filter(f => f && f.startsWith('dist/'));

      console.log(`Found ${buildFiles.length} build files:`, buildFiles.slice(0, 5));

      // Download all build files
      const filesToUpload: Array<{ path: string; content: Buffer }> = [];
      for (const filePath of buildFiles) {
        try {
          const content = await sandbox.fs.downloadFile(`/workspace/${filePath}`);
          const relativePath = filePath.replace('dist/', '');
          filesToUpload.push({
            path: relativePath,
            content: content
          });
          console.log(`📁 Downloaded: ${relativePath} (${content.length} bytes)`);
        } catch (error) {
          console.error(`❌ Failed to download ${filePath}:`, error);
        }
      }

      console.log(`📦 Total files to upload: ${filesToUpload.length}`);

      // Upload to Supabase storage
      console.log('📤 Uploading to Supabase storage...');
      const { uploadBuild } = await import('@/lib/storage');
      
      const buildResult = await uploadBuild(userId, projectId, filesToUpload);

      console.log('✅ Build uploaded successfully');

      // Add cache-busting parameter to ensure fresh loads
      const cacheBustUrl = `${buildResult.url}?t=${Date.now()}`;

      // Verify the HTML content contains the changes
      const indexFile = filesToUpload.find(f => f.path === 'index.html');
      if (indexFile) {
        const htmlContent = indexFile.content.toString();
        const hasRamelow = htmlContent.includes('Ramelow');
        const hasAreo = htmlContent.includes('Areo') || htmlContent.includes('areo');
        console.log(`🔍 HTML verification: Contains 'Ramelow': ${hasRamelow}, Contains 'Areo': ${hasAreo}`);
        console.log(`📄 HTML preview (first 200 chars):`, htmlContent.substring(0, 200));
      }

      // 🎯 CRITICAL: Only save to database if build succeeded
      console.log('💾 Saving successful build to database...');

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
      console.log('✅ Project files saved to database');

      // Update project with build information
      await updateProject(projectId, {
        build_hash: buildResult.buildHash,
        storage_path: `${userId}/${projectId}`,
        preview_url: cacheBustUrl, // Update the preview URL with cache-busting
        last_generated_at: new Date().toISOString(),
        status: 'active'
      });

      // Update vector index for modified/new files
      try {
        const { embedTexts, codeAwareChunks } = await import('@/lib/embeddings')
        const { saveFileChunks } = await import('@/lib/db')
        const changed = amendmentData.files
        const allChunks: Array<{ file_path: string; chunk_index: number; content: string }> = []
        for (const f of changed) {
          const parts = codeAwareChunks(f.path, f.content)
          parts.forEach((p, i) => allChunks.push({ file_path: f.path, chunk_index: i, content: p }))
        }
        const embeddings = await embedTexts(allChunks.map(c => c.content))
        const chunkRows = allChunks.map((c, idx) => ({ file_path: c.file_path, chunk_index: c.chunk_index, content: c.content, embedding: embeddings[idx] }))
        await saveFileChunks(projectId, null, chunkRows) // build_id unknown here; pass null retains search across versions
      } catch (embErr) {
        console.error('Embedding update failed:', embErr)
      }

      // Persist amendment history (lightweight context)
      try {
        const { saveAmendment } = await import('@/lib/db')
        const filePaths = amendmentData.files.map(f => f.path)
        await saveAmendment(projectId, null, amendmentPrompt, amendmentData.summary || null, filePaths)
      } catch (histErr) {
        console.error('Amendment history save failed:', histErr)
      }

      // Increment token usage (but not generation count)
      await incrementUsage(userId, tokensUsed, false);

      return NextResponse.json({
        success: true,
        url: buildResult.url,
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

