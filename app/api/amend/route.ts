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
    const { amendmentPrompt, sandboxId, projectId, currentFiles, images = [], imageNames = [] } = await req.json();

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
    
    // Build a comprehensive type reference document from all project files
    const buildTypeReference = (files: any[]): string => {
      const typeRef: string[] = [];
      
      for (const file of files) {
        if (file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
          const content = file.content || '';
          const exports: string[] = [];
          
          // Extract all exports (more comprehensive pattern)
          const allExportMatches = [
            ...content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g),
            ...content.matchAll(/export\s+(?:default\s+)?class\s+(\w+)/g),
            ...content.matchAll(/export\s+(?:default\s+)?const\s+(\w+)/g),
            ...content.matchAll(/export\s+(?:default\s+)?let\s+(\w+)/g),
            ...content.matchAll(/export\s+(?:default\s+)?var\s+(\w+)/g),
          ];
          
          for (const match of allExportMatches) {
            if (match[1] && !exports.includes(match[1])) {
              exports.push(match[1]);
            }
          }
          
          // Named exports from export { ... }
          const namedExportMatch = content.match(/export\s*{\s*([^}]+)\s*}/);
          if (namedExportMatch) {
            const namedExports = namedExportMatch[1].split(',')
              .map((e: string) => e.trim().split(' as ')[0].trim().split('}')[0].trim())
              .filter(Boolean);
            exports.push(...namedExports);
          }
          
          // Extract interfaces (both exported and non-exported for context)
          const allInterfaces: string[] = [];
          const interfaceMatches = Array.from(content.matchAll(/interface\s+(\w+)([^{]*?)\{([\s\S]*?)\n\}/g));
          for (const match of interfaceMatches) {
            if (match && Array.isArray(match) && match[1] && match[3]) {
              const props = String(match[3]).trim().split('\n').slice(0, 20).map((l: string) => l.trim()).filter(Boolean).join('\n  ');
              allInterfaces.push(`interface ${match[1]} {\n  ${props}\n}`);
            }
          }
          
          // Extract type aliases
          const allTypes: string[] = [];
          const typeMatches = Array.from(content.matchAll(/type\s+(\w+)\s*=\s*([^;]+);/g));
          for (const match of typeMatches) {
            if (match && Array.isArray(match) && match[1] && match[2]) {
              const typeValue = String(match[2]).trim().replace(/\s+/g, ' ').substring(0, 150);
              allTypes.push(`type ${match[1]} = ${typeValue}`);
            }
          }
          
          // Only include files with meaningful exports or type definitions
          if (exports.length > 0 || allInterfaces.length > 0 || allTypes.length > 0) {
            typeRef.push(`\n--- ${file.path} ---`);
            if (exports.length > 0) {
              typeRef.push(`Exports: ${exports.join(', ')}`);
            }
            if (allInterfaces.length > 0) {
              typeRef.push(`Interfaces:\n${allInterfaces.join('\n\n')}`);
            }
            if (allTypes.length > 0) {
              typeRef.push(`Types:\n${allTypes.join('\n\n')}`);
            }
          }
        }
      }
      
      return typeRef.length > 0 ? `\n**TYPE REFERENCE** (exports, interfaces, types from ALL project files - USE THIS FOR TYPE COMPATIBILITY):\n${typeRef.join('\n')}\n` : '';
    };
    
    const typeReference = buildTypeReference(currentFiles);
    console.log(`[amend:${requestId}] type reference length=${typeReference.length}`)
    
    const allComponentFiles = narrowedFiles.map((f: any) => {
      if (f.path.startsWith('src/components/') || f.path.startsWith('app/components/') || f.path === 'app/page.tsx' || f.path === 'src/App.tsx' || f.path === 'description.md') {
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

    const fullContext = `${historyBlock}${typeReference}

Current codebase has these files (subset relevant to the request):
${narrowedFiles.map((f: any) => `- ${f.path}`).join('\n')}

Here are ALL the component files in the project:
${allComponentFiles}

---

**USER'S AMENDMENT REQUEST**: ${amendmentPrompt}

Please make ONLY the changes requested by the user. Read the files above to understand the current structure before making any modifications.`;

    // Build multimodal content with images if provided
    const contents: any[] = [{ text: fullContext }];
    
    if (images.length > 0) {
      contents.push(...images.map((imgData: string, idx: number) => ({
        inlineData: {
          data: imgData.split(',')[1], // Remove data:image/...;base64, prefix
          mimeType: imgData.split(';')[0].split(':')[1] // Extract MIME type
        }
      })));
      
      // Generate the actual file paths that will be created
      const imageFileNames = images.map((imgData: string, idx: number) => {
        const imgName = imageNames[idx] || `image-${idx + 1}`;
        const mimeType = imgData.split(';')[0].split(':')[1];
        const ext = mimeType === 'image/png' ? 'png' : 
                   mimeType === 'image/jpeg' || mimeType === 'image/jpg' ? 'jpg' :
                   mimeType === 'image/gif' ? 'gif' :
                   mimeType === 'image/webp' ? 'webp' :
                   mimeType === 'image/svg+xml' ? 'svg' : 'png';
        const sanitizedName = imgName.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
        return sanitizedName.endsWith(`.${ext}`) ? sanitizedName : `${sanitizedName}.${ext}`;
      });
      
      // In Vite, public folder files are served from root
      const imagePaths = imageFileNames.map((name: string) => `/${name}`).join(', ');
      
      // Enhance the prompt with image context
      contents[0] = { 
        text: fullContext + `\n\nUSER PROVIDED IMAGES: User has uploaded ${images.length} image(s)${imageNames.length > 0 ? `: ${imageNames.join(', ')}` : ''}. These images will be accessible at: ${imagePaths}. Reference them using these exact paths (e.g., <img src="${imagePaths.split(',')[0]}" />). Please incorporate these images into the requested changes.`
      };
    }

    const completion = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
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

    // Step 2: Get all project files from DB and merge with modifications
    const { getProjectFiles } = await import('@/lib/db');
    const allProjectFiles = await getProjectFiles(projectId);
    
    // Merge modified files into complete file set
    const mergedFiles = new Map<string, { path: string; content: string }>();
    
    // Start with all existing files from DB
    for (const file of allProjectFiles) {
      mergedFiles.set(file.file_path, {
        path: file.file_path,
        content: file.file_content
      });
    }
    
    // Override with modified files from AI
    for (const file of amendmentData.files) {
      mergedFiles.set(file.path, file);
    }
    
    const finalFiles = Array.from(mergedFiles.values());
    console.log(`📦 Merged file set: ${finalFiles.length} files (${amendmentData.files.length} modified)`);

    // Step 3: Apply changes to the existing Daytona sandbox
    const daytona = new Daytona({ 
      apiKey: process.env.DAYTONA_KEY || '',
      apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io'
    });

    const sandbox = await daytona.get(sandboxId);

    try {
      // Upload user-provided images to public folder if any
      if (images && images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          const imgData = images[i];
          const imgName = imageNames[i] || `image-${i + 1}`;
          
          // Extract base64 data and determine file extension
          const base64Data = imgData.split(',')[1];
          const mimeType = imgData.split(';')[0].split(':')[1];
          const ext = mimeType === 'image/png' ? 'png' : 
                     mimeType === 'image/jpeg' || mimeType === 'image/jpg' ? 'jpg' :
                     mimeType === 'image/gif' ? 'gif' :
                     mimeType === 'image/webp' ? 'webp' :
                     mimeType === 'image/svg+xml' ? 'svg' : 'png';
          
          // Sanitize filename and create path
          const sanitizedName = imgName.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
          const finalName = sanitizedName.endsWith(`.${ext}`) ? sanitizedName : `${sanitizedName}.${ext}`;
          const publicPath = `/workspace/public/${finalName}`;
          
          // Convert base64 to buffer and upload
          const imgBuffer = Buffer.from(base64Data, 'base64');
          await sandbox.fs.uploadFile(imgBuffer, publicPath);
          
          console.log(`Uploaded amendment image: ${publicPath}`);
        }
      }

      // Upload only modified/new files (sandbox should already have other files from reopen)
      // But if sandbox is empty/fresh, upload everything
      const filesForSandbox = amendmentData.files; // Only upload what changed
      console.log(`📤 Uploading ${filesForSandbox.length} modified files to sandbox...`);
      for (const file of filesForSandbox) {
        const filePath = `/workspace/${file.path}`;
        console.log(`Updating: ${filePath}`);
        
        // Create directory if needed (safe to run even if exists)
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dirPath && dirPath !== '/workspace') {
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
      let tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
      let tsErrors = tsCheckResult.result || '';

      // Auto-fix loop: try up to 2 times
      for (let attempt = 0; attempt < 2 && tsErrors.includes('error TS'); attempt++) {
        console.log(`⚠️ TypeScript errors detected (attempt ${attempt + 1}/2), attempting auto-fix...`);

        // Parse errors to find type mismatches
        const errorLines = tsErrors.split('\n').filter(line => line.includes('error TS'));
        const typeMismatches: { file: string; line: number; expected: string; actual: string }[] = [];

        const importExportErrors: { file: string; line: number; error: string }[] = [];

        for (const errorLine of errorLines) {
          // Match pattern: "file(path,line): error TS2322: Type 'X' is not assignable to type 'Y'."
          const match = errorLine.match(/([^(]+)\((\d+),\d+\):\s*error TS2322:\s*Type\s+['"](\w+)['"]\s+is not assignable to type\s+['"](\w+)['"]/);
          if (match) {
            const filePath = match[1].replace('/workspace/', '').trim();
            const line = parseInt(match[2]);
            const actual = match[3];
            const expected = match[4];
            
            // Only track string vs number mismatches
            if ((actual === 'string' && expected === 'number') || (actual === 'number' && expected === 'string')) {
              typeMismatches.push({ file: filePath, line, expected, actual });
            }
          }

          // Also match setter function type mismatches
          // "Type 'Dispatch<SetStateAction<string>>' is not assignable to type '(amount: number) => void'"
          const setterMatch = errorLine.match(/([^(]+)\((\d+),\d+\):\s*error TS2322:\s*Type\s+['"]Dispatch<SetStateAction<(\w+)>>['"]\s+is not assignable to type/);
          if (setterMatch) {
            const filePath = setterMatch[1].replace('/workspace/', '').trim();
            const line = parseInt(setterMatch[2]);
            const stateType = setterMatch[3];
            
            // Find the expected type from the error message
            const expectedMatch = errorLine.match(/type\s+\((\w+):\s+(\w+)\)/);
            if (expectedMatch && expectedMatch[2] !== stateType) {
              typeMismatches.push({ 
                file: filePath, 
                line, 
                expected: expectedMatch[2], 
                actual: stateType 
              });
            }
          }

          // Match import/export errors: "Module has no exported member 'X'. Did you mean to use 'import X from'?"
          const importError = errorLine.match(/([^(]+)\((\d+),\d+\):\s*error TS2614:\s*Module\s+.*has no exported member\s+['"](.+?)['"]/);
          if (importError) {
            const filePath = importError[1].replace('/workspace/', '').trim();
            const line = parseInt(importError[2]);
            const memberName = importError[3];
            importExportErrors.push({ file: filePath, line, error: `named import ${memberName}` });
          }

          // Match default export errors: "Module has no default export"
          const defaultExportError = errorLine.match(/([^(]+)\((\d+),\d+\):\s*error TS1192:\s*Module\s+.*has no default export/);
          if (defaultExportError) {
            const filePath = defaultExportError[1].replace('/workspace/', '').trim();
            const line = parseInt(defaultExportError[2]);
            importExportErrors.push({ file: filePath, line, error: 'default import' });
          }
        }

        // Fix type mismatches in affected files
        const fixedFiles = new Set<string>();
        for (const mismatch of typeMismatches) {
          if (fixedFiles.has(mismatch.file)) continue;

          try {
            const currentContent = await sandbox.fs.downloadFile(`/workspace/${mismatch.file}`);
            let content = currentContent.toString('utf-8');
            const lines = content.split('\n');

            // Find useState calls that need type fixing
            // Look for useState calls near the error line
            const searchStart = Math.max(0, mismatch.line - 10);
            const searchEnd = Math.min(lines.length, mismatch.line + 10);
            
            for (let i = searchStart; i < searchEnd; i++) {
              // Fix useState type declarations
              // Example: useState<string> -> useState<number>
              if (mismatch.actual === 'string' && mismatch.expected === 'number') {
                lines[i] = lines[i].replace(
                  /useState<string>\(/g, 
                  'useState<number>('
                );
                // Also fix initial values
                lines[i] = lines[i].replace(
                  /useState\(['"](\d+)['"]\)/g,
                  'useState($1)' // Remove quotes from numeric strings
                );
                lines[i] = lines[i].replace(
                  /useState\(['"](\d+\.\d+)['"]\)/g,
                  'useState($1)'
                );
              } else if (mismatch.actual === 'number' && mismatch.expected === 'string') {
                lines[i] = lines[i].replace(
                  /useState<number>\(/g,
                  'useState<string>('
                );
              }
            }

            content = lines.join('\n');
            await sandbox.fs.uploadFile(Buffer.from(content), `/workspace/${mismatch.file}`);
            fixedFiles.add(mismatch.file);
            console.log(`🔧 Fixed type mismatch in ${mismatch.file} (line ${mismatch.line})`);
          } catch (fixError) {
            console.log(`⚠️ Could not auto-fix ${mismatch.file}:`, fixError);
          }
        }

        // Fix import/export errors (named vs default imports)
        for (const impError of importExportErrors) {
          if (fixedFiles.has(impError.file)) continue;

          try {
            const currentContent = await sandbox.fs.downloadFile(`/workspace/${impError.file}`);
            let content = currentContent.toString('utf-8');
            const lines = content.split('\n');

            // Fix the import line - convert named import to default import
            if (impError.error.includes('named import')) {
              const memberName = impError.error.match(/named import (\w+)/)?.[1];
              if (memberName) {
                // Find import line near the error line
                const searchStart = Math.max(0, impError.line - 5);
                const searchEnd = Math.min(lines.length, impError.line + 2);
                
                for (let i = searchStart; i < searchEnd; i++) {
                  // Convert: import { SwapButton } from "./SwapButton"
                  // To: import SwapButton from "./SwapButton"
                  if (lines[i].includes(`import { ${memberName} }`)) {
                    lines[i] = lines[i].replace(
                      new RegExp(`import\\s+\\{\\s*${memberName}\\s*\\}`, 'g'),
                      `import ${memberName}`
                    );
                    console.log(`🔧 Fixed named import to default import for ${memberName} in ${impError.file}`);
                    break;
                  }
                }
              }
            }
            
            // Fix default import errors - convert to named import
            if (impError.error === 'default import') {
              // Find import line near the error line
              const searchStart = Math.max(0, impError.line - 5);
              const searchEnd = Math.min(lines.length, impError.line + 2);
              
              for (let i = searchStart; i < searchEnd; i++) {
                // Look for: import SwapInterface from "..."
                const defaultImportMatch = lines[i].match(/import\s+(\w+)\s+from\s+(['"][^'"]+['"])/);
                if (defaultImportMatch) {
                  const varName = defaultImportMatch[1];
                  const modulePath = defaultImportMatch[2];
                  // Convert: import SwapInterface from "./SwapInterface"
                  // To: import { SwapInterface } from "./SwapInterface"
                  lines[i] = lines[i].replace(
                    new RegExp(`import\\s+${varName}\\s+from`, 'g'),
                    `import { ${varName} } from`
                  );
                  console.log(`🔧 Fixed default import to named import for ${varName} in ${impError.file}`);
                  break;
                }
              }
            }

            content = lines.join('\n');
            await sandbox.fs.uploadFile(Buffer.from(content), `/workspace/${impError.file}`);
            fixedFiles.add(impError.file);
          } catch (fixError) {
            console.log(`⚠️ Could not auto-fix import error in ${impError.file}:`, fixError);
          }
        }

        // Re-run tsc check
        tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
        tsErrors = tsCheckResult.result || '';

        if (!tsErrors.includes('error TS')) {
          console.log('✅ All TypeScript errors fixed automatically');
          break;
        }

        // If still errors after auto-fix, try AI-assisted fix on all problematic files
        if (tsErrors.includes('error TS')) {
          // Get all unique files with errors
          const errorFiles = new Set<string>();
          const exportErrors: { file: string; missingExport: string; fromFile: string }[] = [];
          
          for (const errorLine of errorLines) {
            const fileMatch = errorLine.match(/([^(]+)\(/);
            if (fileMatch) {
              const filePath = fileMatch[1]?.replace('/workspace/', '').trim();
              if (filePath) errorFiles.add(filePath);
            }
            
            // Detect missing export errors: "Module 'X' has no exported member 'Y'"
            const exportMatch = errorLine.match(/([^(]+)\((\d+),\d+\):\s*error TS2305:\s*Module\s+['"](.+?)['"]\s+has no exported member\s+['"](.+?)['"]/);
            if (exportMatch) {
              const filePath = exportMatch[1]?.replace('/workspace/', '').trim();
              const modulePath = exportMatch[3];
              const missingExport = exportMatch[4];
              if (filePath) {
                exportErrors.push({ file: filePath, missingExport, fromFile: modulePath });
              }
            }
          }

          // Helper to resolve relative paths (used for finding related files)
          const resolveImportPath = (importPath: string, fromFile: string): string[] => {
            if (!importPath.startsWith('.')) return [];
            
            const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'));
            let resolved = importPath;
            
            // Handle ../
            while (resolved.startsWith('../')) {
              const parentDir = fromDir.substring(0, fromDir.lastIndexOf('/'));
              resolved = resolved.substring(3);
              if (parentDir) {
                resolved = parentDir + '/' + resolved;
              } else {
                resolved = resolved;
              }
            }
            
            // Handle ./
            if (resolved.startsWith('./')) {
              resolved = fromDir + '/' + resolved.substring(2);
            }
            
            // Try with and without extensions
            const paths = [];
            if (!resolved.endsWith('.tsx') && !resolved.endsWith('.ts')) {
              paths.push(`${resolved}.tsx`, `${resolved}.ts`);
            } else {
              paths.push(resolved);
            }
            
            // Also try in src/ if not already there
            if (!resolved.startsWith('src/')) {
              paths.push(`src/${resolved}`, ...paths.map(p => p.startsWith('src/') ? p : `src/${p}`));
            }
            
            return paths;
          };

          // Fix files one by one, starting with the most errors
          const filesWithErrorCounts = Array.from(errorFiles).map(file => ({
            file,
            errorCount: errorLines.filter(l => l.includes(file)).length
          })).sort((a, b) => b.errorCount - a.errorCount);

          for (const { file: errorFile } of filesWithErrorCounts.slice(0, 3)) { // Fix up to 3 files
            console.log(`🤖 Attempting AI-assisted fix for ${errorFile} (attempt ${attempt + 1})...`);
            try {
              const currentContent = await sandbox.fs.downloadFile(`/workspace/${errorFile}`);
              const fileContent = currentContent.toString('utf-8');
              
              // Get ALL related files (imports, type definitions, hooks, contexts)
              const importedModules: string[] = [];
              const allImports = Array.from(fileContent.matchAll(/import\s+.*?\s+from\s+['"](.+?)['"]/g));
              
              for (const match of allImports) {
                const importPath = match[1];
                if (importPath.startsWith('.') || importPath.startsWith('/')) {
                  const possiblePaths = resolveImportPath(importPath, errorFile);
                  
                  for (const path of possiblePaths) {
                    try {
                      const relatedContent = await sandbox.fs.downloadFile(`/workspace/${path}`).catch(() => null);
                      if (relatedContent) {
                        importedModules.push(`\n--- ${path} ---\n${relatedContent.toString('utf-8')}\n`);
                        break;
                      }
                    } catch {}
                  }
                }
              }
              
              // Also check for missing export errors - add the source file if needed
              for (const expError of exportErrors) {
                if (expError.file === errorFile) {
                  // Try to find the source file that should export this
                  const sourcePaths = resolveImportPath(expError.fromFile, errorFile);
                  for (const path of sourcePaths) {
                    try {
                      const sourceContent = await sandbox.fs.downloadFile(`/workspace/${path}`).catch(() => null);
                      if (sourceContent && !importedModules.some(m => m.includes(path))) {
                        importedModules.push(`\n--- ${path} (needs to export '${expError.missingExport}') ---\n${sourceContent.toString('utf-8')}\n`);
                        break;
                      }
                    } catch {}
                  }
                }
              }

              // Get all errors for this specific file
              const fileErrors = errorLines.filter(l => l.includes(errorFile)).slice(0, 15).join('\n');
              
              const relatedFilesContext = importedModules.length > 0 
                ? `\n\n**CRITICAL CONTEXT - Type Definitions and Related Files**:\n${importedModules.join('\n')}\n`
                : '';

              // Check if there are missing export errors for this file
              const missingExportsForFile = exportErrors.filter(e => e.file === errorFile);
              const missingExportsNote = missingExportsForFile.length > 0
                ? `\n\n**⚠️ MISSING EXPORTS DETECTED**:\n${missingExportsForFile.map(e => `- File tries to import '${e.missingExport}' from '${e.fromFile}' but it's not exported there. You may need to:\n  1. Fix the import to use what's actually exported\n  2. OR check the related file and ensure '${e.missingExport}' is exported\n`).join('\n')}`
                : '';

              const fixPrompt = `You are fixing TypeScript errors in a React/Vite project. 

**CRITICAL RULES**:
1. Match EXACT types - if a prop expects 'Token | null', pass 'Token | null', NOT 'string'
2. If a property is missing (e.g., 'tokens'), ADD it to the type definition OR fix the usage
3. If a function signature doesn't match, fix the function to match the expected signature
4. Preserve ALL existing functionality - only fix type errors
5. Use the exact type names from the related files shown below
6. If importing a type that doesn't exist, either: (a) use the correct export name from the source file, or (b) if the source file shows it exists but isn't exported, you'll need to fix both files

**TypeScript Errors to Fix**:
${fileErrors}${missingExportsNote}

**File to Fix**:
\`\`\`typescript
${fileContent}
\`\`\`${relatedFilesContext}

**Instructions**:
- Fix ALL type errors shown above
- If a type/export is missing: check related files to see what's actually exported, then either fix the import or add the export to the source file
- Match the exact types from related files (Token vs string, number vs string, etc.)
- Ensure all required properties exist on types
- Fix function signatures to match expected types
- Do NOT change functionality, only fix types and exports
- Return ONLY the corrected TypeScript code, no markdown, no explanations

**Return the complete fixed file code**`;

              const fixResponse = await gemini.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ text: fixPrompt }],
                config: {
                  temperature: 0.1,
                  maxOutputTokens: 32000,
                },
              });

              const fixedCode = fixResponse.text || '';
              // Extract code from markdown if present
              let codeToApply = '';
              const codeMatch = fixedCode.match(/```(?:typescript|tsx|ts)?\n([\s\S]*?)\n```/);
              if (codeMatch && codeMatch[1]) {
                codeToApply = codeMatch[1];
              } else {
                // Try to find code between markdown fences or just use the text
                const lines = fixedCode.split('\n');
                let inCodeBlock = false;
                const codeLines: string[] = [];
                for (const line of lines) {
                  if (line.match(/^```/)) {
                    inCodeBlock = !inCodeBlock;
                    continue;
                  }
                  if (inCodeBlock || (!inCodeBlock && line.trim() && !line.startsWith('**'))) {
                    codeLines.push(line);
                  }
                }
                codeToApply = codeLines.join('\n') || fixedCode;
              }

              if (codeToApply.trim().length > 100 && (codeToApply.includes('export') || codeToApply.includes('import'))) {
                await sandbox.fs.uploadFile(Buffer.from(codeToApply), `/workspace/${errorFile}`);
                console.log(`✅ AI-assisted fix applied to ${errorFile}`);
                
                // Re-check after each fix
                tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
                tsErrors = tsCheckResult.result || '';
                
                // If no more errors, break early
                if (!tsErrors.includes('error TS')) {
                  console.log('✅ All errors fixed by AI!');
                  break;
                }
                
                // Update errorLines for next iteration
                errorLines.length = 0;
                errorLines.push(...tsErrors.split('\n').filter(l => l.includes('error TS')));
                
                // If there are still missing export errors for this file, also try to fix the source file
                const remainingExportErrors = exportErrors.filter(e => e.file === errorFile && tsErrors.includes(`has no exported member '${e.missingExport}'`));
                for (const expError of remainingExportErrors.slice(0, 1)) { // Fix first source file only
                  const sourcePaths = resolveImportPath(expError.fromFile, errorFile);
                  for (const sourcePath of sourcePaths) {
                    try {
                      const sourceContent = await sandbox.fs.downloadFile(`/workspace/${sourcePath}`).catch(() => null);
                      if (sourceContent) {
                        const sourceCode = sourceContent.toString('utf-8');
                        // Check if the type/export exists but isn't exported
                        const hasInterface = sourceCode.match(new RegExp(`\\binterface\\s+${expError.missingExport}\\b`));
                        const hasType = sourceCode.match(new RegExp(`\\btype\\s+${expError.missingExport}\\b`));
                        const hasClass = sourceCode.match(new RegExp(`\\bclass\\s+${expError.missingExport}\\b`));
                        const hasConst = sourceCode.match(new RegExp(`\\bconst\\s+${expError.missingExport}\\b`));
                        const hasFunction = sourceCode.match(new RegExp(`\\bfunction\\s+${expError.missingExport}\\b`));
                        
                        if (hasInterface || hasType || hasClass || hasConst || hasFunction) {
                          console.log(`🔧 Fixing missing export in ${sourcePath}...`);
                          // Add export if missing - check for non-exported declaration
                          let fixedSource = sourceCode;
                          const declarationMatch = fixedSource.match(new RegExp(`(interface|type|class|const|function)\\s+${expError.missingExport}\\b`));
                          if (declarationMatch) {
                            const keyword = declarationMatch[1];
                            const needsExport = !fixedSource.match(new RegExp(`export\\s+${keyword}\\s+${expError.missingExport}\\b`));
                            
                            if (needsExport) {
                              // Add export keyword before the declaration
                              fixedSource = fixedSource.replace(
                                new RegExp(`(${keyword})\\s+${expError.missingExport}`, 'g'),
                                `export $1 ${expError.missingExport}`
                              );
                              await sandbox.fs.uploadFile(Buffer.from(fixedSource), `/workspace/${sourcePath}`);
                              console.log(`✅ Added export for ${expError.missingExport} in ${sourcePath}`);
                              
                              // Re-check
                              tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
                              tsErrors = tsCheckResult.result || '';
                              if (!tsErrors.includes('error TS')) {
                                console.log('✅ All errors fixed after export fix!');
                                break;
                              }
                            }
                          }
                        }
                        break;
                      }
                    } catch {}
                  }
                }
              } else {
                console.log(`⚠️ AI fix returned invalid code for ${errorFile}, skipping`);
              }
            } catch (aiError) {
              console.log(`⚠️ AI fix failed for ${errorFile}:`, aiError);
            }
          }
        }
      }

      if (tsErrors.includes('error TS')) {
        console.error('❌ TypeScript errors remain after auto-fix attempts:');
        console.error(tsErrors.split('\n').filter(l => l.includes('error TS')).slice(0, 10).join('\n'));
        console.error('🚫 NOT proceeding to build - code has unfixable TypeScript errors');
        throw new Error('TypeScript compilation failed: ' + tsErrors.split('\n').filter(l => l.includes('error TS')).slice(0, 5).join('; '));
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
          const content: Buffer = await sandbox.fs.downloadFile(`/workspace/${filePath}`) as Buffer;
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
      if (indexFile && Buffer.isBuffer(indexFile.content)) {
        const htmlContent = indexFile.content.toString('utf-8');
        const hasRamelow = htmlContent.includes('Ramelow');
        const hasAreo = htmlContent.includes('Areo') || htmlContent.includes('areo');
        console.log(`🔍 HTML verification: Contains 'Ramelow': ${hasRamelow}, Contains 'Areo': ${hasAreo}`);
      }

      // 🎯 CRITICAL: Only save to database if build succeeded
      console.log('💾 Saving successful build to database...');

      // Use the merged file set we created earlier (finalFiles)
      const updatedFiles = finalFiles.map(f => ({
        path: f.path,
        content: f.content
      }));

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

