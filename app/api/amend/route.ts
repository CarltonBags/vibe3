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
import { parseFilesMarkdown, executeSequentialWorkflow } from '../generate/sequential-workflow';
import { addStatus } from '@/lib/status-tracker';

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
    // CRITICAL: Use latest build_id to avoid stale chunks
    try {
      const { embedTexts } = await import('@/lib/embeddings')
      const { matchFileChunks, getLatestBuildId } = await import('@/lib/db')
      const latestBuildId = await getLatestBuildId(projectId)
      if (latestBuildId) {
        console.log(`[amend:${requestId}] Using latest build_id for vector search: ${latestBuildId}`)
      } else {
        console.warn(`[amend:${requestId}] No build_id found, vector search may include stale chunks`)
      }
      const [queryEmbedding] = await embedTexts([amendmentPrompt])
      const matches = await matchFileChunks(projectId, queryEmbedding, 30, latestBuildId)
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

    // Prepare narrowed files (used in planning)
    const narrowedFiles: any[] = (global as any).__amendRelevantFiles || currentFiles;

    // Step 1: GPT Planning Phase - Create amendment plan with component structure
    const planSystem = `You are an amendment planner for a React/Vite app. Create a detailed plan for the changes requested.

CRITICAL REQUIREMENTS:
1. Define EXACT TypeScript interfaces for EVERY component without using props. Props are strictly forbidden!
2. Specify which components need to be created/modified
3. Include exact file structure with imports/exports
4. All new components must have ZERO props - define all content internally

Return ONLY valid JSON with this EXACT structure:
{
  "amendment_summary": "brief description of changes",
  "task_flow": [
    {
      "step": 1,
      "task": "Modify Header component",
      "file": "src/components/Header.tsx",
      "description": "Update header styling/content",
      "dependencies": []
    },
    {
      "step": 2,
      "task": "Create NewComponent component",
      "file": "src/components/NewComponent.tsx",
      "description": "Create new component with zero props",
      "dependencies": []
    }
  ],
  "components": [
    {
      "name": "NewComponent",
      "file": "src/components/NewComponent.tsx",
      "task_step": 2,
      "interface": "NO PROPS - export function NewComponent() with no props",
      "props_required": [],
      "props_optional": [],
      "imports_from": ["Button from @/components/ui/button", "Music from lucide-react"],
      "exports": ["NewComponent"],
      "description": "Component description"
    }
  ]
}

⚠️ CRITICAL - ZERO PROPS RULE:
- All components must have ZERO props - NO props interface
- Use shadcn/ui components from "@/components/ui/" (lowercase paths)
- List ALL Lucide React icons in imports_from
- DO NOT import from "@/components/lib/" - these don't exist`;

    // Get package.json for planning context
    const packageJsonFile = currentFiles.find((f: any) => f.path === 'package.json');
    let planningPackageJson = '{}';
    if (packageJsonFile) {
      planningPackageJson = packageJsonFile.content || '{}';
    }

    // Read description.md if it exists (contains project structure and recent changes)
    const descriptionFile = currentFiles.find((f: any) => f.path === 'description.md');
    const projectDescription = descriptionFile?.content || 'No project description available.';

    const planUserPayload = {
      amendment_prompt: amendmentPrompt,
      project_description: projectDescription,
      existing_files: narrowedFiles.map((f: any) => f.path),
      package_json: JSON.parse(planningPackageJson),
      instruction: "Create a plan for amendments. All new components must have ZERO props. Use shadcn/ui components from '@/components/ui/'. List ALL Lucide React icons in imports_from. READ THE PROJECT DESCRIPTION CAREFULLY to understand the current project structure and recent changes."
    };

    addStatus(requestId, 'planning', 'Planning amendments...', 5);
    const planCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: planSystem },
        { role: 'user', content: JSON.stringify(planUserPayload) }
      ],
      response_format: { type: 'json_object' }
    });
    const planRaw = planCompletion.choices[0]?.message?.content || '{}';
    tokensUsed += planCompletion.usage?.total_tokens || 0;
    console.log(`[amend:${requestId}] plan tokens=${planCompletion.usage?.total_tokens||0}`);
    
    let planJson: any = {};
    try { 
      planJson = JSON.parse(planRaw);
      const taskFlow = planJson.task_flow || [];
      console.log(`[amend:${requestId}] plan created: ${taskFlow.length} tasks`);
    } catch (e) {
      console.error(`[amend:${requestId}] Failed to parse plan:`, e);
    }

    // Step 2: Use sequential workflow (same as generation) to build components  
    const taskFlow = planJson.task_flow || [];
    
    if (taskFlow.length === 0) {
      // Fallback: create a simple task from the amendment prompt
      console.warn(`[amend:${requestId}] No task flow in plan, creating fallback task`);
      taskFlow.push({
        step: 1,
        task: `Apply amendment: ${amendmentPrompt.substring(0, 50)}`,
        file: 'src/App.tsx',
        description: amendmentPrompt,
        dependencies: []
      });
    }

    // Step 2: Generate files using Gemini with retry logic
    addStatus(requestId, 'components', `Generating ${taskFlow.length} component(s)...`, 20);
    
    // Build context for Gemini
    const buildTypeReference = (files: any[]): string => {
      const typeRef: string[] = [];
      for (const file of files) {
        if (file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
          const content = file.content || '';
          const exports: string[] = [];
          const allExportMatches = [
            ...content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g),
            ...content.matchAll(/export\s+(?:default\s+)?class\s+(\w+)/g),
            ...content.matchAll(/export\s+(?:default\s+)?const\s+(\w+)/g),
          ];
          for (const match of allExportMatches) {
            if (match[1] && !exports.includes(match[1])) exports.push(match[1]);
          }
          if (exports.length > 0) {
            typeRef.push(`\n--- ${file.path} ---\nExports: ${exports.join(', ')}`);
          }
        }
      }
      return typeRef.length > 0 ? `\n**TYPE REFERENCE**:\n${typeRef.join('\n')}\n` : '';
    };
    
    const typeReference = buildTypeReference(narrowedFiles);
    const allComponentFiles = narrowedFiles.map((f: any) => {
      if (f.path.startsWith('src/components/') || f.path === 'src/App.tsx' || f.path === 'description.md') {
        return `\nFile: ${f.path}\n\`\`\`tsx\n${f.content}\n\`\`\``;
      }
      return '';
    }).filter(Boolean).join('\n\n');

    const fullContext = `${typeReference}\n\nCurrent codebase:\n${narrowedFiles.map((f: any) => `- ${f.path}`).join('\n')}\n\nComponent files:\n${allComponentFiles}\n\n**USER'S AMENDMENT REQUEST**: ${amendmentPrompt}\n\nPROJECT PLAN:\n${planRaw}\n\nGenerate ONLY the files from the task_flow. Use MARKDOWN format with FILE: and code blocks.`;
    
    // Build multimodal content
    const contents: any[] = [{ text: fullContext }];
    if (images.length > 0) {
      contents.push(...images.map((imgData: string, idx: number) => ({
        inlineData: {
          data: imgData.split(',')[1],
          mimeType: imgData.split(';')[0].split(':')[1]
        }
      })));
    }
    
    // Generate with retry logic
    let responseText = '';
    let retries = 0;
    const MAX_RETRIES = 3;
    const models = ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    
    while (retries < MAX_RETRIES && !responseText) {
      try {
        const model = models[retries] || 'gemini-1.5-pro';
        console.log(`[amend:${requestId}] Trying Gemini model: ${model} (attempt ${retries + 1})`);

    const completion = await gemini.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: instructions.toString(),
          }
        });
        
        responseText = completion.text || '';
        if (responseText) {
          console.log(`[amend:${requestId}] Success with ${model}, response length: ${responseText.length}`);
          tokensUsed += Math.ceil(responseText.length / 4);
          break;
        }
      } catch (error: any) {
        const errorMsg = error.message || JSON.stringify(error);
        console.error(`[amend:${requestId}] Gemini error (attempt ${retries + 1}):`, errorMsg);
        
        // Check if it's a retryable error (503, 404, overloaded, unavailable)
        const isRetryable = errorMsg.includes('503') || 
                           errorMsg.includes('404') || 
                           errorMsg.includes('overloaded') || 
                           errorMsg.includes('UNAVAILABLE') ||
                           errorMsg.includes('NOT_FOUND');
        
        if (isRetryable) {
          retries++;
          if (retries < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, retries - 1), 5000);
            console.log(`[amend:${requestId}] Retrying with next model in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        // If not retryable or all retries exhausted, throw
        if (retries >= MAX_RETRIES) {
          throw new Error(`Failed to generate after ${MAX_RETRIES} attempts with different models`);
        }
        throw error;
      }
    }
    
    if (!responseText) {
      return NextResponse.json({ error: 'Failed to generate amendments after retries' }, { status: 500 });
    }
    
    // Parse markdown response
    let amendmentData: { files: Array<{ path: string; content: string }>, summary?: string };
    try {
      const parsed = parseFilesMarkdown(responseText);
      if (!parsed || !parsed.files || parsed.files.length === 0) {
        throw new Error('No files found in markdown response');
      }
      amendmentData = { files: parsed.files, summary: planJson.amendment_summary || `Updated ${parsed.files.length} file(s)` };
      console.log(`✅ Parsed ${amendmentData.files.length} file(s) from markdown format`);
    } catch (parseError) {
      console.error('[amend] Failed to parse AI response:', parseError);
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // Validate and process amendmentData files
    try {
      // Validate component imports match actual file names (Vite structure: src/components/)
      const currentComponentFiles = currentFiles
        .filter((f: any) => f.path.startsWith('src/components/'))
        .map((f: any) => {
          const fileName = f.path.replace('src/components/', '').replace('.tsx', '').replace('.ts', '');
          return fileName;
        });

      console.log('Current component files:', currentComponentFiles);

      // Check if any modifications introduce new components that don't match
      for (const file of amendmentData.files) {
        if (file.path === 'src/App.tsx' || file.path.startsWith('src/')) {
          // Match imports from various patterns: ./components/X, @/components/X, ../components/X
          const importMatches = file.content.match(/import\s+[\w\s,{}]+\s+from\s+['"](?:\.\/|\.\.\/|@\/)?components\/(\w+)['"]/g);
          if (importMatches) {
            const importedComponents = importMatches.map(match => {
              const componentMatch = match.match(/['"](?:\.\/|\.\.\/|@\/)?components\/(\w+)['"]/);
              return componentMatch ? componentMatch[1] : null;
            }).filter((comp): comp is string => comp !== null);
            
            const missingComponents = importedComponents.filter(comp => {
              const exists = currentComponentFiles.includes(comp) || 
                            amendmentData.files.some(f => f.path === `src/components/${comp}.tsx` || f.path === `src/components/${comp}.ts`);
              return !exists;
            });

            if (missingComponents.length > 0) {
              console.error(`❌ Missing components detected: ${missingComponents.join(', ')}`);
              // Create placeholder components for missing ones (ZERO PROPS)
              for (const componentName of missingComponents) {
                const componentContent = `export default function ${componentName}() {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-2">${componentName}</h3>
      <p className="text-gray-600">Component placeholder</p>
    </div>
  );
}`;
                
                amendmentData.files.push({
                  path: `src/components/${componentName}.tsx`,
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
        //'package.json', // Allow package.json changes
        'vite.config.ts', // Core build config
        'tailwind.config.js', // Core styling config
        'postcss.config.js', // Core CSS config
        'tsconfig.json', // Core TypeScript config
        'tsconfig.app.json', // Core TypeScript config
        'tsconfig.node.json' // Core TypeScript config
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

      // 🚨 CRITICAL: Auto-detect new page components and ensure App.tsx is updated
      // Also fix duplicate imports/routes if AI added them twice
      try {
        const existingPaths = new Set<string>((currentFiles || []).map((f: any) => f.path))
        const newPageFiles = amendmentData.files.filter(f => 
          f.path.startsWith('src/pages/') && 
          (f.path.endsWith('.tsx') || f.path.endsWith('.ts')) &&
          !existingPaths.has(f.path)
        )
        
        // Get App.tsx content (prioritize AI-modified version if it exists)
        const appTsxFile = amendmentData.files.find(f => f.path === 'src/App.tsx')
        const existingAppTsx = currentFiles.find((f: any) => f.path === 'src/App.tsx')
        let appTsxContent = appTsxFile?.content || existingAppTsx?.content || ''
        
        if (appTsxContent) {
          // First, fix duplicate imports/routes if they exist
          // Remove duplicate imports for the same component
          const importLines = appTsxContent.split('\n')
          const seenImports = new Map<string, number>() // Map of import statement -> line index
          const duplicateImportIndices: number[] = []
          
          for (let i = 0; i < importLines.length; i++) {
            const line = importLines[i]
            // Match import statements: import { Component } from './pages/Page'
            const importMatch = line.match(/import\s+{([^}]+)}\s+from\s+['"]\.\/pages\/([^'"]+)['"]/)
            if (importMatch) {
              const components = importMatch[1].split(',').map((c: string) => c.trim())
              const pagePath = importMatch[2]
              const key = `${pagePath}:${components.join(',')}`
              
              if (seenImports.has(key)) {
                // Duplicate found - mark for removal
                duplicateImportIndices.push(i)
                console.warn(`⚠️ Found duplicate import: ${line.trim()}`)
              } else {
                seenImports.set(key, i)
              }
            }
          }
          
          // Remove duplicate import lines
          if (duplicateImportIndices.length > 0) {
            appTsxContent = importLines
              .filter((_: string, index: number) => !duplicateImportIndices.includes(index))
              .join('\n')
            console.log(`🔧 Removed ${duplicateImportIndices.length} duplicate import(s)`)
          }
          
          // Remove duplicate routes
          const routesMatch = appTsxContent.match(/<Routes>([\s\S]*?)<\/Routes>/)
          if (routesMatch) {
            const routesContent = routesMatch[1]
            const routeLines = routesContent.split('\n')
            const seenRoutes = new Set<string>()
            const uniqueRouteLines: string[] = []
            
            for (const line of routeLines) {
              // Match route paths: <Route path="/page" element={<Component />} />
              const routeMatch = line.match(/<Route\s+path=["']([^"']+)["']/)
              if (routeMatch) {
                const routePath = routeMatch[1]
                if (seenRoutes.has(routePath)) {
                  console.warn(`⚠️ Found duplicate route: ${line.trim()}`)
                  continue // Skip duplicate route
                }
                seenRoutes.add(routePath)
              }
              uniqueRouteLines.push(line)
            }
            
            if (uniqueRouteLines.length !== routeLines.length) {
              const uniqueRoutesContent = uniqueRouteLines.join('\n')
              appTsxContent = appTsxContent.replace(
                /(<Routes>)([\s\S]*?)(<\/Routes>)/,
                `$1${uniqueRoutesContent}$3`
              )
              console.log(`🔧 Removed ${routeLines.length - uniqueRouteLines.length} duplicate route(s)`)
            }
          }
          
          // Now check if new pages need routes added
          if (newPageFiles.length > 0) {
            console.log(`🔍 Detected ${newPageFiles.length} new page component(s): ${newPageFiles.map(f => f.path).join(', ')}`)
            
            for (const pageFile of newPageFiles) {
              const pageName = pageFile.path
                .replace('src/pages/', '')
                .replace('.tsx', '')
                .replace('.ts', '')
              
              // Extract component name (could be default export or named export)
              const componentMatch = pageFile.content.match(/export\s+(?:default\s+)?(?:function|const)\s+(\w+)/)
              const componentName = componentMatch ? componentMatch[1] : pageName
              
              // Check if route exists in App.tsx (after deduplication)
              const routePath = `/${pageName.toLowerCase()}`
              const hasRoute = appTsxContent.includes(`path="${routePath}"`) || 
                             appTsxContent.includes(`path='${routePath}'`) ||
                             appTsxContent.includes(`path="/${pageName}"`) ||
                             appTsxContent.includes(`path='/${pageName}'`)
              
              // Check if component is imported (after deduplication)
              const hasImport = appTsxContent.includes(`from './pages/${pageName}'`) ||
                              appTsxContent.includes(`from './pages/${componentName}'`) ||
                              appTsxContent.includes(`from '@/pages/${pageName}'`) ||
                              appTsxContent.includes(`from '@/pages/${componentName}'`) ||
                              appTsxContent.includes(`{ ${componentName} }`) ||
                              appTsxContent.includes(`{${componentName}}`)
              
              if (!hasRoute || !hasImport) {
                console.warn(`⚠️ New page ${pageName} created but App.tsx missing route/import - auto-fixing...`)
                
                let updatedAppTsx = appTsxContent
                
                // Add import if missing
                if (!hasImport) {
                  // Find where to add import (after existing imports, before component definition)
                  const importMatch = updatedAppTsx.match(/(import\s+.*?from\s+['"][^'"]+['"];?\n)+/)
                  const lastImportEnd = importMatch ? importMatch[0].length : 0
                  
                  // Check if Routes component is imported
                  const hasRoutesImport = updatedAppTsx.includes(`from 'react-router-dom'`) || 
                                         updatedAppTsx.includes(`from "react-router-dom"`)
                  
                  if (!hasRoutesImport) {
                    // Add Routes and Route imports
                    updatedAppTsx = updatedAppTsx.substring(0, lastImportEnd) +
                      `import { Routes, Route } from 'react-router-dom'\n` +
                      updatedAppTsx.substring(lastImportEnd)
                  }
                  
                  // Add page component import (check if it's already imported as part of another import)
                  const existingImportForPage = updatedAppTsx.match(new RegExp(`import\\s+{[^}]*${componentName}[^}]*}\\s+from\\s+['"]\\./pages/[^'"]+['"]`))
                  if (!existingImportForPage) {
                    updatedAppTsx = updatedAppTsx.substring(0, lastImportEnd) +
                      `import { ${componentName} } from './pages/${pageName}'\n` +
                      updatedAppTsx.substring(lastImportEnd)
                  }
                }
                
                // Add route if missing
                if (!hasRoute) {
                  // Find <Routes> component
                  const routesMatch = updatedAppTsx.match(/<Routes>([\s\S]*?)<\/Routes>/)
                  if (routesMatch) {
                    // Add route inside Routes
                    const routesContent = routesMatch[1]
                    const newRoute = `\n        <Route path="${routePath}" element={<${componentName} />} />`
                    updatedAppTsx = updatedAppTsx.replace(
                      /(<Routes>)([\s\S]*?)(<\/Routes>)/,
                      `$1${routesContent}${newRoute}\n      $3`
                    )
                  } else {
                    // No Routes found, wrap existing content
                    const appReturnMatch = updatedAppTsx.match(/(return\s+\([\s\S]*?)(<\/?[A-Z])/)
                    if (appReturnMatch) {
                      const beforeReturn = updatedAppTsx.substring(0, appReturnMatch.index)
                      const afterReturn = updatedAppTsx.substring(appReturnMatch.index! + appReturnMatch[1].length)
                      updatedAppTsx = beforeReturn + 
                        `return (\n    <Routes>\n      <Route path="/" element={<>${appReturnMatch[1].replace(/return\s+\(/, '')} />} />\n      <Route path="${routePath}" element={<${componentName} />} />\n    </Routes>\n  )` +
                        afterReturn
                    }
                  }
                }
                
                appTsxContent = updatedAppTsx
                console.log(`✅ Auto-updated App.tsx to include route for ${pageName} (${routePath})`)
              } else {
                console.log(`✅ App.tsx already includes route for ${pageName}`)
              }
            }
          }
          
          // Update App.tsx in amendment files if it was modified
          if (appTsxContent !== (appTsxFile?.content || existingAppTsx?.content || '')) {
            if (appTsxFile) {
              appTsxFile.content = appTsxContent
            } else {
              amendmentData.files.push({
                path: 'src/App.tsx',
                content: appTsxContent
              })
            }
            console.log(`✅ Updated App.tsx (removed duplicates and/or added missing routes)`)
          }
        }
      } catch (routeError) {
        console.error('Failed to auto-update App.tsx for new pages:', routeError)
        // Don't fail the request, just log the error
      }
      
    } catch (parseError) {
      console.error('Failed to parse AI amendment response:', parseError);
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    // Step 2: Get all project files from DB (latest build only) and merge with modifications
    const { getProjectFiles, getLatestBuildId } = await import('@/lib/db');
    const latestBuildId = await getLatestBuildId(projectId);
    if (latestBuildId) {
      console.log(`[amend:${requestId}] Fetching files from latest build: ${latestBuildId}`);
    } else {
      console.warn(`[amend:${requestId}] No build_id found, fetching all files (may include stale versions)`);
    }
    const allProjectFiles = await getProjectFiles(projectId, latestBuildId);
    console.log(`[amend:${requestId}] Loaded ${allProjectFiles.length} files from database`);
    
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

    // Step 3: Apply changes to the existing Daytona sandbox (recreate if needed)
    const daytona = new Daytona({ 
      apiKey: process.env.DAYTONA_KEY || '',
      apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io'
    });

    let sandbox;
    let actualSandboxId = sandboxId;
    let needsReopen = false;
    
    try {
      sandbox = await daytona.get(sandboxId);
      console.log(`[amend:${requestId}] Using existing sandbox: ${sandboxId}`);
      // Quick health check
      await sandbox.process.executeCommand('pwd');
    } catch (sandboxError) {
      console.warn(`[amend:${requestId}] Sandbox ${sandboxId} not found or dead, will recreate:`, sandboxError);
      needsReopen = true;
      sandbox = null;
    }
    
    // Recreate sandbox if it doesn't exist
    if (!sandbox) {
      console.log(`[amend:${requestId}] Recreating sandbox for project ${projectId}...`);
      // Get project files from database to restore the sandbox
      const { data: projectFiles, error: filesError } = await supabaseAdmin
        .from('project_files')
        .select('*')
        .eq('project_id', projectId);
      
      if (filesError || !projectFiles || projectFiles.length === 0) {
        return NextResponse.json(
          { error: 'Project files not found - cannot recreate sandbox' },
          { status: 404 }
        );
      }
      
      // Create new sandbox
      sandbox = await daytona.create({
        image: 'node:20-alpine',
        ephemeral: true,
        public: true,
        envVars: {
          NODE_ENV: 'development'
        }
      });
      actualSandboxId = sandbox.id;
      console.log(`[amend:${requestId}] Created new sandbox: ${actualSandboxId}`);
      
      // Auto-detect template type from package.json
      const packageJsonFile = projectFiles.find((f: any) => f.file_path === 'package.json');
      let isVite = false;
      if (packageJsonFile) {
        try {
          const pkg = JSON.parse(packageJsonFile.file_content);
          isVite = pkg.devDependencies && pkg.devDependencies.vite;
        } catch {}
      }
      
      // Setup template files
      if (isVite) {
        console.log(`[amend:${requestId}] Detected Vite template, setting up...`);
        const { ViteHandler } = await import('@/app/api/generate/templates/vite-handler');
        const handler = new ViteHandler();
        await handler.setupProject(sandbox);
      } else {
        console.log(`[amend:${requestId}] Detected Next.js template, setting up...`);
        const fs = await import('fs');
        const path = await import('path');
        const templatesPath = path.join(process.cwd(), 'sandbox-templates');
        const packageJson = fs.readFileSync(path.join(templatesPath, 'package.json'), 'utf-8');
        const nextConfig = fs.readFileSync(path.join(templatesPath, 'next.config.js'), 'utf-8');
        const tailwindConfig = fs.readFileSync(path.join(templatesPath, 'tailwind.config.js'), 'utf-8');
        const postcssConfig = fs.readFileSync(path.join(templatesPath, 'postcss.config.js'), 'utf-8');
        const tsConfig = fs.readFileSync(path.join(templatesPath, 'tsconfig.json'), 'utf-8');
        const globalsCss = '@tailwind base;\n@tailwind components;\n@tailwind utilities;';
        const layoutTsx = fs.readFileSync(path.join(templatesPath, 'app/layout.tsx'), 'utf-8');

        await sandbox.fs.createFolder('/workspace/app', '755');
        await sandbox.fs.createFolder('/workspace/app/components', '755');
        await sandbox.fs.createFolder('/workspace/app/types', '755');
        await sandbox.fs.createFolder('/workspace/app/utils', '755');
        
        await sandbox.fs.uploadFile(Buffer.from(packageJson), '/workspace/package.json');
        await sandbox.fs.uploadFile(Buffer.from(nextConfig), '/workspace/next.config.js');
        await sandbox.fs.uploadFile(Buffer.from(tailwindConfig), '/workspace/tailwind.config.js');
        await sandbox.fs.uploadFile(Buffer.from(postcssConfig), '/workspace/postcss.config.js');
        await sandbox.fs.uploadFile(Buffer.from(tsConfig), '/workspace/tsconfig.json');
        await sandbox.fs.uploadFile(Buffer.from(globalsCss), '/workspace/app/globals.css');
        await sandbox.fs.uploadFile(Buffer.from(layoutTsx), '/workspace/app/layout.tsx');
      }
      
      // Upload all project files to restore the sandbox state
      const uniqueFiles = Array.from(new Map(projectFiles.map((f: any) => [f.file_path, f])).values());
      console.log(`[amend:${requestId}] Uploading ${uniqueFiles.length} project files to sandbox...`);
      for (const file of uniqueFiles) {
        if (!file.file_content) continue;
        const filePath = `/workspace/${file.file_path}`;
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dirPath && dirPath !== '/workspace') {
          try {
            await sandbox.fs.createFolder(dirPath, '755');
          } catch (e) {
            // Folder might already exist
          }
        }
        await sandbox.fs.uploadFile(Buffer.from(file.file_content), filePath);
      }
      
      // Install dependencies
      console.log(`[amend:${requestId}] Installing dependencies...`);
      await sandbox.process.executeCommand('cd /workspace && npm install');
      
      // Update project with new sandbox ID
      await updateProject(projectId, { sandbox_id: actualSandboxId });
      console.log(`[amend:${requestId}] Sandbox recreated and restored, proceeding with amendment...`);
    }

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

      // CRITICAL: Upload ALL files from finalFiles to ensure sandbox is in sync with latest build
      // Don't just upload modified files - the sandbox might have stale files from old builds
      console.log(`📤 Uploading ${finalFiles.length} files to sandbox (ensuring all files are latest)...`);
      let uploadedCount = 0;
      for (const file of finalFiles) {
        const filePath = `/workspace/${file.path}`;
        // Only log every 10th file or if it's a modified file
        const isModified = amendmentData.files.some(f => f.path === file.path);
        if (uploadedCount % 10 === 0 || isModified) {
          console.log(`${isModified ? '✏️ Modified' : '📄 Syncing'}: ${file.path}`);
        }
        
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
        uploadedCount++;
      }
      console.log(`✅ Uploaded ${uploadedCount} files to sandbox (all files now in sync with latest build)`);

      // Remove FontAwesome imports (we use Lucide now)
      console.log('🔧 Checking for icon import issues...');
      for (const file of amendmentData.files) {
        if (file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
          let content = file.content;

          // Remove ALL FontAwesome imports (we don't use FontAwesome anymore)
          if (content.includes('@fortawesome') || content.includes('FontAwesomeIcon')) {
            console.log(`🔧 Removing FontAwesome imports from ${file.path}`);
            content = content.replace(/import\s+.*?from\s+['"]@fortawesome\/[^'"]+['"];?\s*\n?/g, '');
            content = content.replace(/import\s+.*?FontAwesomeIcon.*?from\s+['"][^'"]+['"];?\s*\n?/g, '');
            content = content.replace(/<FontAwesomeIcon[^>]*\/>/g, '<div className="icon-placeholder" />');
          }

          // Re-upload the fixed file
          const filePath = `/workspace/${file.path}`;
          await sandbox.fs.uploadFile(Buffer.from(content), filePath);
          if (content !== file.content) {
            console.log(`✅ Removed FontAwesome from ${file.path}`);
          }
        }
      }

      // Clear any existing build cache and dist folder completely
      console.log('🧹 Clearing build cache and dist folder...');
      await sandbox.process.executeCommand('cd /workspace && rm -rf dist node_modules/.vite node_modules/.cache .vite || true');
      
      // Verify dist is gone
      const distCheck = await sandbox.process.executeCommand('cd /workspace && test -d dist && echo "EXISTS" || echo "GONE"');
      if (distCheck.result?.includes('EXISTS')) {
        console.warn('⚠️ dist folder still exists after cleanup, forcing removal...');
        await sandbox.process.executeCommand('cd /workspace && rm -rf dist && mkdir -p dist');
      }
      console.log('✅ Build cache cleared');

      // Run preflight TypeScript check - use both --noEmit and --build to catch all errors
      console.log('🔍 Running preflight TypeScript check...');
      let tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
      let tsErrors = tsCheckResult.result || '';
      
      // Also try tsc --build to catch project reference errors
      if (!tsErrors.trim() || !tsErrors.includes('error')) {
        console.log('🔍 Preflight --noEmit had no errors, trying tsc --build...');
        const buildCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --build --dry 2>&1 || true');
        const buildCheckErrors = buildCheckResult.result || '';
        if (buildCheckErrors.includes('error') || buildCheckErrors.includes('TS2305')) {
          tsErrors = buildCheckErrors;
        }
      }
      
      // Log what we got from the preflight check
      if (tsErrors.trim()) {
        const errorPreview = tsErrors.substring(0, 500);
        console.log(`📋 Preflight check output (first 500 chars): ${errorPreview}`);
      } else {
        console.log('📋 Preflight check: No output (this might mean no errors or tsc failed silently)');
      }

      // Auto-fix loop: try up to 3 times (including Lucide icon fixes)
      // Check for errors in multiple formats: 'error TS', 'TS2305', 'error:', etc.
      const hasErrors = tsErrors.includes('error TS') || tsErrors.includes('TS2305') || tsErrors.includes('TS2304') || 
                        tsErrors.includes('TS2559') || tsErrors.includes('error:') || (tsErrors.match(/error\s+TS\d+/) !== null);
      
      console.log(`🔍 Error detection: hasErrors=${hasErrors}, checking for 'error TS': ${tsErrors.includes('error TS')}, checking for 'TS2305': ${tsErrors.includes('TS2305')}`);
      
      for (let attempt = 0; attempt < 3 && hasErrors; attempt++) {
        console.log(`⚠️ TypeScript errors detected (attempt ${attempt + 1}/3), attempting auto-fix...`);
        const errorCount = tsErrors.split('\n').filter(l => l.includes('error TS') || l.includes('TS2305') || l.includes('TS2304') || l.includes('error:')).length;
        console.log(`📋 Error summary: ${errorCount} error(s)`);

        // Fix Lucide icon errors first (TS2305: has no exported member or TS2304: Cannot find name)
        // Check for TS2305 errors related to lucide-react (more lenient check)
        const hasLucideError = tsErrors.includes('TS2305') && 
                              (tsErrors.includes('lucide-react') || tsErrors.includes('has no exported member'));
        const hasCannotFindName = tsErrors.includes('Cannot find name') && (tsErrors.includes('TS2304') || tsErrors.includes('TS2305'));

        console.log(`🔍 Lucide error check: hasLucideError=${hasLucideError}, hasCannotFindName=${hasCannotFindName}`);

        if (hasLucideError || hasCannotFindName) {
          console.log('🔧 Fixing invalid Lucide icon imports...');
          const invalidIcons = new Set<string>();
          
          // Extract invalid icon names from TS2305 errors: "Module 'lucide-react' has no exported member 'Violin'"
          // Pattern matches both: error TS2305: Module '"lucide-react"' has no exported member 'Violin'.
          const exportMatches = tsErrors.match(/(?:error TS2305|has no exported member)[^']*['"]([A-Z][a-zA-Z0-9]*)['"]/g) || [];
          for (const match of exportMatches) {
            const iconName = match.match(/['"]([A-Z][a-zA-Z0-9]*)['"]/) || match.match(/'([A-Z][a-zA-Z0-9]*)'/);
            if (iconName && iconName[1] && /^[A-Z][a-zA-Z0-9]*$/.test(iconName[1])) {
              // Check if this error is related to lucide-react
              const errorContext = tsErrors.substring(Math.max(0, tsErrors.indexOf(match) - 300), Math.min(tsErrors.length, tsErrors.indexOf(match) + 200));
              if (errorContext.includes('lucide-react') || errorContext.includes('"lucide-react"') || errorContext.includes("'lucide-react'")) {
                invalidIcons.add(iconName[1]);
              }
            }
          }
          
          // Also check for direct TS2305 errors with lucide-react context
          // Match pattern: "src/file.tsx(2,36): error TS2305: Module '"lucide-react"' has no exported member 'Violin'."
          const ts2305Lines = tsErrors.split('\n').filter(l => l.includes('TS2305') && (l.includes('lucide-react') || l.includes('has no exported member')));
          console.log(`📋 Found ${ts2305Lines.length} TS2305 lines with lucide-react`);
          for (const line of ts2305Lines) {
            // Extract icon name from patterns like: "has no exported member 'Violin'" 
            // The icon name appears after "has no exported member" and is in quotes
            const exportedMemberMatch = line.match(/has no exported member\s+['"]([A-Z][a-zA-Z0-9]*)['"]/);
            if (exportedMemberMatch && exportedMemberMatch[1]) {
              invalidIcons.add(exportedMemberMatch[1]);
              console.log(`  → Found invalid icon: ${exportedMemberMatch[1]}`);
            }
          }
          
          if (invalidIcons.size > 0) {
            console.log(`⚠️ Invalid Lucide icons detected: ${Array.from(invalidIcons).join(', ')}`);
            
            // Icon name mappings (invalid -> valid)
            const iconMappings: Record<string, string> = {
              'Violin': 'Music',
              'Trumpet': 'Music',
              'Flute': 'Music',
              'Ukulele': 'Music',
              'Saxophone': 'Music',
              'MusicNote': 'Music',
              'MusicNote2': 'Music',
              'MusicNote4': 'Music',
              'MusicNoteOff': 'Music',
              'MusicNotePlus': 'Music',
            };
            
            // Get all files with errors (not just amendmentData.files - files might already exist in sandbox)
            const errorFilePaths = new Set<string>();
            for (const errorLine of tsErrors.split('\n')) {
              if (errorLine.includes('TS2305') && errorLine.includes('lucide-react')) {
                const fileMatch = errorLine.match(/(src\/[^\s(]+)/);
                if (fileMatch) {
                  errorFilePaths.add(fileMatch[1]);
                }
              }
            }
            
            // Fix files with invalid icons (both amended files and existing files)
            const filesToFix = new Set<string>();
            for (const file of amendmentData.files) {
              if (file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
                filesToFix.add(file.path);
              }
            }
            for (const filePath of Array.from(errorFilePaths)) {
              filesToFix.add(filePath);
            }
            
            for (const filePath of Array.from(filesToFix)) {
              if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
                try {
                  const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
                  const currentContent = await sandbox.fs.downloadFile(fullPath);
                  let fixed = currentContent.toString('utf-8');
                  let modified = false;
                  
                  // Replace invalid icons in imports and usage
                  for (const invalidIcon of Array.from(invalidIcons)) {
                    const replacement = iconMappings[invalidIcon] || 'Music';
                    
                    // Remove from import
                    const lucideImportMatch = fixed.match(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/);
                    if (lucideImportMatch && lucideImportMatch[1].includes(invalidIcon)) {
                      const existingIcons = lucideImportMatch[1].split(',').map(i => i.trim()).filter(Boolean);
                      const validIcons = existingIcons.filter(icon => icon !== invalidIcon);
                      if (!validIcons.includes(replacement)) validIcons.push(replacement);
                      
                      fixed = fixed.replace(
                        /import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/,
                        `import { ${validIcons.join(', ')} } from 'lucide-react'`
                      );
                      modified = true;
                    }
                    
                    // Replace in JSX usage
                    fixed = fixed.replace(new RegExp(`<${invalidIcon}\\s*/?>`, 'g'), `<${replacement} />`);
                    fixed = fixed.replace(new RegExp(`{${invalidIcon}}`, 'g'), `{${replacement}}`);
                    
                    if (fixed !== currentContent.toString('utf-8')) {
                      modified = true;
                    }
                  }
                  
                  if (modified) {
                    await sandbox.fs.uploadFile(Buffer.from(fixed), fullPath);
                    console.log(`✅ Fixed Lucide icons in ${filePath}`);
                  }
                } catch (e) {
                  console.error(`Failed to fix icons in ${filePath}:`, e);
                }
              }
            }
            
            // Re-check after Lucide fixes
            tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
            tsErrors = tsCheckResult.result || '';
            
            // Check if errors are gone (multiple formats)
            const stillHasErrors = tsErrors.includes('error TS') || tsErrors.includes('TS2305') || tsErrors.includes('TS2304') || 
                                   tsErrors.includes('error:') || tsErrors.match(/error\s+TS\d+/);
            if (!stillHasErrors) {
              console.log('✅ All Lucide icon errors fixed');
              break;
            } else {
              console.log(`⚠️ Still have errors after Lucide fix (attempt ${attempt + 1}): ${tsErrors.split('\n').filter(l => l.includes('TS2305') || l.includes('error')).slice(0, 3).join('; ')}`);
            }
          }
        }

        // Fix TS2559: "Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes'"
        // This happens when props are passed to components that have zero props
        if (tsErrors.includes('TS2559') && tsErrors.includes('IntrinsicAttributes')) {
          console.log('🔧 Fixing TS2559: Removing props from zero-props components...');
          
          const errorLines = tsErrors.split('\n');
          const componentFiles = new Set<string>();
          const zeroPropsComponents = new Set<string>();
          
          for (const errorLine of errorLines) {
            // Match: "src/App.tsx(11,6): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes'."
            const ts2559Match = errorLine.match(/(src\/[^(]+)\((\d+),\d+\):\s*error TS2559.*IntrinsicAttributes/);
            if (ts2559Match) {
              const filePath = ts2559Match[1];
              const lineNum = parseInt(ts2559Match[2]);
              componentFiles.add(filePath);
              
              // Try to extract the component name from the line
              try {
                const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
                const fileContent = await sandbox.fs.downloadFile(fullPath);
                const lines = fileContent.toString('utf-8').split('\n');
                const errorLineContent = lines[lineNum - 1]; // lineNum is 1-based
                
                // Match JSX usage: <ComponentName {...props}> or <ComponentName>{children}</ComponentName>
                // Also check surrounding lines for JSX children
                const jsxMatch = errorLineContent.match(/<([A-Z][a-zA-Z0-9]*)\s+[^>]*>/);
                if (jsxMatch) {
                  zeroPropsComponents.add(jsxMatch[1]);
                  console.log(`  → Found component with props: ${jsxMatch[1]} in ${filePath}:${lineNum}`);
                } else {
                  // Check if it's a component with children between tags (next few lines)
                  const contextLines = lines.slice(Math.max(0, lineNum - 3), Math.min(lines.length, lineNum + 3)).join('\n');
                  const componentWithChildren = contextLines.match(/<([A-Z][a-zA-Z0-9]*)>\s*\{/);
                  if (componentWithChildren) {
                    zeroPropsComponents.add(componentWithChildren[1]);
                    console.log(`  → Found component with children: ${componentWithChildren[1]} in ${filePath}:${lineNum}`);
                  }
                }
              } catch (e) {
                console.warn(`  ⚠️ Could not read ${filePath} to extract component name:`, e);
              }
            }
          }
          
          // Fix all files with TS2559 errors
          for (const filePath of Array.from(componentFiles)) {
            try {
              const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
              const currentContent = await sandbox.fs.downloadFile(fullPath);
              let fixed = currentContent.toString('utf-8');
              let modified = false;
              
              // Remove props from all zero-props components found in errors
              for (const compName of Array.from(zeroPropsComponents)) {
                // First, handle children prop as attribute: <ComponentName children={...} />
                fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*/>`, 'g'), `<${compName} />`);
                fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*>`, 'g'), `<${compName}>`);
                
                // Handle JSX children: <ComponentName>{children}</ComponentName> -> <ComponentName /> (remove children)
                // Match opening tag, then content, then closing tag
                const childrenPattern = new RegExp(`<${compName}\\s*>[\\s\\S]*?</${compName}>`, 'g');
                const hasChildren = childrenPattern.test(fixed);
                if (hasChildren) {
                  // Remove children content - just keep the self-closing tag
                  fixed = fixed.replace(childrenPattern, `<${compName} />`);
                  modified = true;
                  console.log(`  ✅ Removed children from <${compName}> in ${filePath}`);
                }
                
                // Match: <ComponentName prop="value" ...> or <ComponentName prop="value" />
                const propPattern = new RegExp(`<${compName}\\s+[^>]*>`, 'g');
                const selfClosingPattern = new RegExp(`<${compName}\\s+[^>]*/>`, 'g');
                
                // Then remove all other props
                if (propPattern.test(fixed) || selfClosingPattern.test(fixed)) {
                  fixed = fixed.replace(propPattern, `<${compName}>`);
                  fixed = fixed.replace(selfClosingPattern, `<${compName} />`);
                  modified = true;
                  console.log(`  ✅ Removed props from <${compName}> in ${filePath}`);
                }
              }
              
              // Also check for common zero-props components even if not explicitly found
              const commonZeroProps = ['ThemeProvider', 'Header', 'Hero', 'Footer', 'FeatureCard'];
              for (const compName of commonZeroProps) {
                // First remove children prop
                fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*/>`, 'g'), `<${compName} />`);
                fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*>`, 'g'), `<${compName}>`);
                
                const propPattern = new RegExp(`<${compName}\\s+[^>]*>`, 'g');
                const selfClosingPattern = new RegExp(`<${compName}\\s+[^>]*/>`, 'g');
                
                if ((propPattern.test(fixed) || selfClosingPattern.test(fixed)) && !zeroPropsComponents.has(compName)) {
                  fixed = fixed.replace(propPattern, `<${compName}>`);
                  fixed = fixed.replace(selfClosingPattern, `<${compName} />`);
                  modified = true;
                  console.log(`  ✅ Removed props from <${compName}> in ${filePath} (common zero-props component)`);
                }
              }
              
              if (modified) {
                await sandbox.fs.uploadFile(Buffer.from(fixed), fullPath);
                console.log(`🔧 Fixed TS2559 errors in ${filePath}`);
              }
            } catch (fixError) {
              console.warn(`⚠️ Could not fix TS2559 in ${filePath}:`, fixError);
            }
          }
          
          // Re-run tsc check after fixing
          tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
          tsErrors = tsCheckResult.result || '';
          
          if (!tsErrors.includes('TS2559') || !tsErrors.includes('IntrinsicAttributes')) {
            console.log('✅ TS2559 errors fixed');
          }
        }

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

**🚫 ABSOLUTE ZERO PROPS RULE - NO EXCEPTIONS**:
- ALL components MUST have ZERO props - NO props interface, NO props parameter, NO children prop, NOTHING
- NEVER pass props to components - Use <ComponentName /> with NO attributes, NO children prop, NO props of any kind
- Components define all content internally - this is MANDATORY

**CRITICAL RULES**:
1. Match EXACT types - if a prop expects 'Token | null', pass 'Token | null', NOT 'string'
2. If a property is missing (e.g., 'tokens'), ADD it to the type definition OR fix the usage
3. If a function signature doesn't match, fix the function to match the expected signature
4. Preserve ALL existing functionality - only fix type errors
5. Use the exact type names from the related files shown below
6. If importing a type that doesn't exist, either: (a) use the correct export name from the source file, or (b) if the source file shows it exists but isn't exported, you'll need to fix both files
7. 🚫 Remove ALL props from components - if you see TS2559 errors about props, remove them completely

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

      // Final check - if we still have Lucide errors, try one more fix pass
      const hasFinalLucideErrors = tsErrors.includes('TS2305') && (tsErrors.includes('lucide-react') || tsErrors.includes('has no exported member'));
      if (hasFinalLucideErrors) {
        console.log('⚠️ Still have Lucide errors before build, running final fix pass...');
        const finalFixResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
        const finalErrors = finalFixResult.result || '';
        if (finalErrors.includes('TS2305') && finalErrors.includes('lucide-react')) {
          // Re-run the Lucide fix logic one more time
          const lucideErrorLines = finalErrors.split('\n').filter(l => l.includes('TS2305') && (l.includes('lucide-react') || l.includes('has no exported member')));
          const finalInvalidIcons = new Set<string>();
          for (const line of lucideErrorLines) {
            const match = line.match(/has no exported member\s+['"]([A-Z][a-zA-Z0-9]*)['"]/);
            if (match && match[1]) {
              finalInvalidIcons.add(match[1]);
            }
          }
          
          if (finalInvalidIcons.size > 0) {
            console.log(`🔧 Final fix pass: Invalid icons: ${Array.from(finalInvalidIcons).join(', ')}`);
            const iconMappings: Record<string, string> = {
              'Violin': 'Music', 'Trumpet': 'Music', 'Flute': 'Music', 'Ukulele': 'Music', 'Saxophone': 'Music',
              'MusicNote': 'Music', 'MusicNote2': 'Music', 'MusicNote4': 'Music', 'MusicNoteOff': 'Music', 'MusicNotePlus': 'Music',
            };
            
            const errorFilePaths = new Set<string>();
            for (const errorLine of finalErrors.split('\n')) {
              if (errorLine.includes('TS2305') && errorLine.includes('lucide-react')) {
                const fileMatch = errorLine.match(/(src\/[^\s(]+)/);
                if (fileMatch) errorFilePaths.add(fileMatch[1]);
              }
            }
            
            for (const filePath of Array.from(errorFilePaths)) {
              try {
                const fullPath = `/workspace/${filePath}`;
                const currentContent = await sandbox.fs.downloadFile(fullPath);
                let fixed = currentContent.toString('utf-8');
                let modified = false;
                
                for (const invalidIcon of Array.from(finalInvalidIcons)) {
                  const replacement = iconMappings[invalidIcon] || 'Music';
                  const lucideImportMatch = fixed.match(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/);
                  if (lucideImportMatch && lucideImportMatch[1].includes(invalidIcon)) {
                    const existingIcons = lucideImportMatch[1].split(',').map(i => i.trim()).filter(Boolean);
                    const validIcons = existingIcons.filter(icon => icon !== invalidIcon);
                    if (!validIcons.includes(replacement)) validIcons.push(replacement);
                    fixed = fixed.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/, `import { ${validIcons.join(', ')} } from 'lucide-react'`);
                    fixed = fixed.replace(new RegExp(`<${invalidIcon}\\s*/?>`, 'g'), `<${replacement} />`);
                    fixed = fixed.replace(new RegExp(`{${invalidIcon}}`, 'g'), `{${replacement}}`);
                    modified = true;
                  }
                }
                
                if (modified) {
                  await sandbox.fs.uploadFile(Buffer.from(fixed), fullPath);
                  console.log(`✅ Final fix applied to ${filePath}`);
                }
              } catch (e) {
                console.error(`Failed final fix for ${filePath}:`, e);
              }
            }
            
            // Re-check after final fix
            const afterFinalCheck = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
            tsErrors = afterFinalCheck.result || '';
          }
        }
      }

      // Check if errors remain (multiple formats)
      const stillHasErrors = tsErrors.includes('error TS') || tsErrors.includes('TS2305') || tsErrors.includes('TS2304') || 
                             tsErrors.includes('error:') || tsErrors.match(/error\s+TS\d+/);
      
      if (stillHasErrors) {
        console.error('❌ TypeScript errors remain after auto-fix attempts:');
        const errorLines = tsErrors.split('\n').filter(l => l.includes('error TS') || l.includes('TS2305') || l.includes('TS2304') || l.includes('error:'));
        console.error(errorLines.slice(0, 10).join('\n'));
        console.error('🚫 NOT proceeding to build - code has unfixable TypeScript errors');
        throw new Error('TypeScript compilation failed: ' + errorLines.slice(0, 5).join('; '));
      }

      // Build Vite project for production (not Next.js anymore)
      console.log('🔨 Building Vite project...');
      let buildCommand = await sandbox.process.executeCommand('cd /workspace && npm run build 2>&1');
      let buildOutput = buildCommand.result || '';
      console.log('Build result:', buildOutput.substring(0, 500));

      // Check if build failed due to TypeScript errors (especially Lucide icon errors or TS2559)
      // Check for TS2305 errors related to lucide-react (more lenient check)
      const hasLucideBuildError = (buildOutput.includes('TS2305') || buildOutput.includes('error TS2305')) && 
                                  (buildOutput.includes('lucide-react') || buildOutput.includes('has no exported member'));
      
      // Check for TS2559: props passed to zero-props components
      const hasTS2559Error = buildOutput.includes('TS2559') && buildOutput.includes('IntrinsicAttributes');
      
      console.log(`🔍 Build error check: hasLucideBuildError=${hasLucideBuildError}, hasTS2559Error=${hasTS2559Error}, has TS2305: ${buildOutput.includes('TS2305')}, has lucide-react: ${buildOutput.includes('lucide-react')}`);
      
      // Fix TS2559 errors first (props on zero-props components)
      if (hasTS2559Error) {
        console.log('⚠️ Build failed with TS2559 errors (props on zero-props components), attempting fix...');
        
        const errorLines = buildOutput.split('\n');
        const componentFiles = new Set<string>();
        const zeroPropsComponents = new Set<string>();
        
        for (const errorLine of errorLines) {
          const ts2559Match = errorLine.match(/(src\/[^(]+)\((\d+),\d+\):\s*error TS2559.*IntrinsicAttributes/);
          if (ts2559Match) {
            const filePath = ts2559Match[1];
            const lineNum = parseInt(ts2559Match[2]);
            componentFiles.add(filePath);
            
            try {
              const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
              const fileContent = await sandbox.fs.downloadFile(fullPath);
              const lines = fileContent.toString('utf-8').split('\n');
              const errorLineContent = lines[lineNum - 1];
              
              const jsxMatch = errorLineContent.match(/<([A-Z][a-zA-Z0-9]*)\s+[^>]*>/);
              if (jsxMatch) {
                zeroPropsComponents.add(jsxMatch[1]);
                console.log(`  → Found component with props: ${jsxMatch[1]} in ${filePath}:${lineNum}`);
              }
            } catch (e) {
              console.warn(`  ⚠️ Could not read ${filePath}:`, e);
            }
          }
        }
        
        for (const filePath of Array.from(componentFiles)) {
          try {
            const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
            const currentContent = await sandbox.fs.downloadFile(fullPath);
            let fixed = currentContent.toString('utf-8');
            let modified = false;
            
            for (const compName of Array.from(zeroPropsComponents)) {
              // First, handle children prop as attribute
              fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*/>`, 'g'), `<${compName} />`);
              fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*>`, 'g'), `<${compName}>`);
              
              // Handle JSX children: <ComponentName>{children}</ComponentName> -> <ComponentName />
              const childrenPattern = new RegExp(`<${compName}\\s*>[\\s\\S]*?</${compName}>`, 'g');
              if (childrenPattern.test(fixed)) {
                fixed = fixed.replace(childrenPattern, `<${compName} />`);
                modified = true;
                console.log(`  ✅ Removed children from <${compName}> in ${filePath}`);
              }
              
              const propPattern = new RegExp(`<${compName}\\s+[^>]*>`, 'g');
              const selfClosingPattern = new RegExp(`<${compName}\\s+[^>]*/>`, 'g');
              
              if (propPattern.test(fixed) || selfClosingPattern.test(fixed)) {
                fixed = fixed.replace(propPattern, `<${compName}>`);
                fixed = fixed.replace(selfClosingPattern, `<${compName} />`);
                modified = true;
                console.log(`  ✅ Removed props from <${compName}> in ${filePath}`);
              }
            }
            
            const commonZeroProps = ['ThemeProvider', 'Header', 'Hero', 'Footer', 'FeatureCard'];
            for (const compName of commonZeroProps) {
              // First remove children prop as attribute
              fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*/>`, 'g'), `<${compName} />`);
              fixed = fixed.replace(new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*>`, 'g'), `<${compName}>`);
              
              // Handle JSX children
              const childrenPattern = new RegExp(`<${compName}\\s*>[\\s\\S]*?</${compName}>`, 'g');
              if (childrenPattern.test(fixed) && !zeroPropsComponents.has(compName)) {
                fixed = fixed.replace(childrenPattern, `<${compName} />`);
                modified = true;
                console.log(`  ✅ Removed children from <${compName}> in ${filePath}`);
              }
              
              const propPattern = new RegExp(`<${compName}\\s+[^>]*>`, 'g');
              const selfClosingPattern = new RegExp(`<${compName}\\s+[^>]*/>`, 'g');
              
              if ((propPattern.test(fixed) || selfClosingPattern.test(fixed)) && !zeroPropsComponents.has(compName)) {
                fixed = fixed.replace(propPattern, `<${compName}>`);
                fixed = fixed.replace(selfClosingPattern, `<${compName} />`);
                modified = true;
                console.log(`  ✅ Removed props from <${compName}> in ${filePath}`);
              }
            }
            
            if (modified) {
              await sandbox.fs.uploadFile(Buffer.from(fixed), fullPath);
              console.log(`🔧 Fixed TS2559 errors in ${filePath}`);
            }
          } catch (fixError) {
            console.warn(`⚠️ Could not fix TS2559 in ${filePath}:`, fixError);
          }
        }
        
        // Retry build after fixing TS2559 errors
        console.log('🔨 Retrying build after TS2559 fix...');
        const retryBuildCommand = await sandbox.process.executeCommand('cd /workspace && npm run build 2>&1');
        const retryBuildOutput = retryBuildCommand.result || '';
        
        if (retryBuildOutput.includes('error TS') || retryBuildOutput.includes('TS2559')) {
          console.error('❌ Build still failed after TS2559 fix');
          throw new Error('Build failed after TS2559 auto-fix: ' + retryBuildOutput.substring(0, 500));
        }
        
        console.log('✅ Build succeeded after TS2559 fix');
        // Continue with the rest of the build process using retryBuildOutput
        // Update buildOutput to use the retry result
        buildOutput = retryBuildOutput;
      }
      
      if (hasLucideBuildError) {
        console.log('⚠️ Build failed with Lucide icon errors, attempting fix...');
        
        // Extract errors from build output
        const buildErrors = buildOutput;
        const lucideErrorLines = buildErrors.split('\n').filter(l => l.includes('TS2305') && (l.includes('lucide-react') || l.includes('has no exported member')));
        const finalInvalidIcons = new Set<string>();
        
        for (const line of lucideErrorLines) {
          const match = line.match(/has no exported member\s+['"]([A-Z][a-zA-Z0-9]*)['"]/);
          if (match && match[1]) {
            finalInvalidIcons.add(match[1]);
          }
        }
        
        if (finalInvalidIcons.size > 0) {
          console.log(`🔧 Fixing invalid icons from build errors: ${Array.from(finalInvalidIcons).join(', ')}`);
          const iconMappings: Record<string, string> = {
            'Violin': 'Music', 'Trumpet': 'Music', 'Flute': 'Music', 'Ukulele': 'Music', 'Saxophone': 'Music',
            'MusicNote': 'Music', 'MusicNote2': 'Music', 'MusicNote4': 'Music', 'MusicNoteOff': 'Music', 'MusicNotePlus': 'Music',
          };
          
          const errorFilePaths = new Set<string>();
          for (const errorLine of buildErrors.split('\n')) {
            if (errorLine.includes('TS2305') && errorLine.includes('lucide-react')) {
              const fileMatch = errorLine.match(/(src\/[^\s(]+)/);
              if (fileMatch) errorFilePaths.add(fileMatch[1]);
            }
          }
          
          for (const filePath of Array.from(errorFilePaths)) {
            try {
              const fullPath = `/workspace/${filePath}`;
              const currentContent = await sandbox.fs.downloadFile(fullPath);
              let fixed = currentContent.toString('utf-8');
              let modified = false;
              
              for (const invalidIcon of Array.from(finalInvalidIcons)) {
                const replacement = iconMappings[invalidIcon] || 'Music';
                
                // First, replace all usages in the code before fixing the import
                // Replace JSX usage: <Violin />, <Violin/>, <Violin className="..."/>
                fixed = fixed.replace(new RegExp(`<${invalidIcon}\\s+`, 'g'), `<${replacement} `);
                fixed = fixed.replace(new RegExp(`<${invalidIcon}\\s*/?>`, 'g'), `<${replacement} />`);
                
                // Replace in expressions: {Violin}, {Violin,}, Violin={...}
                fixed = fixed.replace(new RegExp(`{${invalidIcon}\\b`, 'g'), `{${replacement}`);
                fixed = fixed.replace(new RegExp(`\\b${invalidIcon}\\s*:`, 'g'), `${replacement}:`);
                fixed = fixed.replace(new RegExp(`\\b${invalidIcon}\\s*=`, 'g'), `${replacement}=`);
                
                // Replace standalone usage: Violin, (but not in import statements)
                // This is a bit tricky - we want to replace Violin when it's used as a component/identifier
                // but not when it's part of other words or strings
                fixed = fixed.replace(new RegExp(`\\b${invalidIcon}\\b(?!['"\\w])`, 'g'), replacement);
                
                // Now fix the import statement
                const lucideImportMatch = fixed.match(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/);
                if (lucideImportMatch && lucideImportMatch[1].includes(invalidIcon)) {
                  const existingIcons = lucideImportMatch[1].split(',').map(i => i.trim()).filter(Boolean);
                  const validIcons = existingIcons.filter(icon => icon !== invalidIcon);
                  if (!validIcons.includes(replacement)) validIcons.push(replacement);
                  fixed = fixed.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/, `import { ${validIcons.join(', ')} } from 'lucide-react'`);
                  modified = true;
                } else if (!lucideImportMatch || !lucideImportMatch[1].includes(replacement)) {
                  // If there's no lucide import at all, or the replacement isn't in it, add it
                  if (lucideImportMatch) {
                    const existingIcons = lucideImportMatch[1].split(',').map(i => i.trim()).filter(Boolean);
                    if (!existingIcons.includes(replacement)) {
                      existingIcons.push(replacement);
                      fixed = fixed.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/, `import { ${existingIcons.join(', ')} } from 'lucide-react'`);
                      modified = true;
                    }
                  } else {
                    // No lucide import exists, add one
                    fixed = `import { ${replacement} } from 'lucide-react';\n${fixed}`;
                    modified = true;
                  }
                }
              }
              
              if (modified) {
                await sandbox.fs.uploadFile(Buffer.from(fixed), fullPath);
                console.log(`✅ Fixed Lucide icons in ${filePath} from build errors`);
              }
            } catch (e) {
              console.error(`Failed to fix ${filePath}:`, e);
            }
          }
          
          // Retry build after fixing
          console.log('🔨 Retrying build after Lucide icon fixes...');
          const retryBuildCommand = await sandbox.process.executeCommand('cd /workspace && npm run build 2>&1');
          const retryBuildOutput = retryBuildCommand.result || '';
          
          const retryHasLucideError = (retryBuildOutput.includes('TS2305') || retryBuildOutput.includes('error TS2305')) && 
                                      (retryBuildOutput.includes('lucide-react') || retryBuildOutput.includes('has no exported member'));
          
          if (retryHasLucideError) {
            console.error('❌ Build still failed with Lucide errors after fix');
            console.error('🚫 NOT saving broken code to database - build failed');
            throw new Error('Build failed: ' + retryBuildOutput.substring(0, 500));
          } else if (retryBuildOutput.includes('error') || retryBuildOutput.includes('Error')) {
            console.error('❌ Build failed:', retryBuildOutput.substring(0, 500));
            console.error('🚫 NOT saving broken code to database - build failed');
            throw new Error('Build failed: ' + retryBuildOutput.substring(0, 500));
          } else {
            console.log('✅ Build succeeded after Lucide icon fixes');
            // Continue with success - update buildOutput for rest of the code
            buildCommand.result = retryBuildOutput;
          }
        }
      }
      
      // Check for default export errors (TS2613: Module has no default export)
      const hasDefaultExportError = buildOutput.includes('TS2613') && 
                                   buildOutput.includes('has no default export') &&
                                   (buildOutput.includes('App') || buildOutput.includes('main.tsx'))
      
      if (hasDefaultExportError) {
        console.log('⚠️ Build failed with default export error, attempting fix...')
        
        try {
          // Check if App.tsx has a named export instead of default export
          const appTsxPath = '/workspace/src/App.tsx'
          const appContent = await sandbox.fs.downloadFile(appTsxPath)
          const appText = appContent.toString('utf-8')
          
          // Check if it's a named export: export function App() or export const App = ...
          const hasNamedExport = /export\s+(?:function|const)\s+App\s*[=(]/.test(appText)
          const hasDefaultExport = /export\s+default/.test(appText)
          
          if (hasNamedExport && !hasDefaultExport) {
            console.log('🔧 App.tsx has named export but main.tsx expects default export - fixing...')
            
            // Convert named export to default export
            let fixedApp = appText
            // Replace: export function App() with export default function App()
            fixedApp = fixedApp.replace(/export\s+(function\s+App\s*\()/, 'export default $1')
            // Replace: export const App = with export default const App = (less common)
            fixedApp = fixedApp.replace(/export\s+(const\s+App\s*=)/, 'export default $1')
            
            await sandbox.fs.uploadFile(Buffer.from(fixedApp), appTsxPath)
            console.log('✅ Converted App.tsx to default export')
            
            // Retry build
            console.log('🔨 Retrying build after default export fix...')
            const retryBuildCommand = await sandbox.process.executeCommand('cd /workspace && npm run build 2>&1')
            const retryBuildOutput = retryBuildCommand.result || ''
            
            if (retryBuildOutput.includes('error TS2613') && retryBuildOutput.includes('App')) {
              console.error('❌ Build still failed with default export error after fix')
              throw new Error('Build failed: ' + retryBuildOutput.substring(0, 500))
            } else if (retryBuildOutput.includes('error') || retryBuildOutput.includes('Error')) {
              console.error('❌ Build failed:', retryBuildOutput.substring(0, 500))
              throw new Error('Build failed: ' + retryBuildOutput.substring(0, 500))
            } else {
              console.log('✅ Build succeeded after default export fix')
              buildOutput = retryBuildOutput
              buildCommand.result = retryBuildOutput
            }
          } else {
            // Maybe main.tsx needs to be fixed instead
            const mainTsxPath = '/workspace/src/main.tsx'
            const mainContent = await sandbox.fs.downloadFile(mainTsxPath)
            const mainText = mainContent.toString('utf-8')
            
            // Check if main.tsx uses default import but App is named export
            if (mainText.includes('import App from') && hasNamedExport) {
              console.log('🔧 main.tsx uses default import but App.tsx has named export - fixing main.tsx...')
              let fixedMain = mainText
              // Replace: import App from './App.tsx' with import { App } from './App.tsx'
              fixedMain = fixedMain.replace(/import\s+App\s+from\s+['"]\.\/App(?:\.tsx)?['"]/, "import { App } from './App.tsx'")
              fixedMain = fixedMain.replace(/import\s+App\s+from\s+['"]\.\/App(?:\.tsx)?['"]/, "import { App } from './App.tsx'")
              
              await sandbox.fs.uploadFile(Buffer.from(fixedMain), mainTsxPath)
              console.log('✅ Fixed main.tsx to use named import')
              
              // Retry build
              console.log('🔨 Retrying build after main.tsx fix...')
              const retryBuildCommand = await sandbox.process.executeCommand('cd /workspace && npm run build 2>&1')
              const retryBuildOutput = retryBuildCommand.result || ''
              
              if (retryBuildOutput.includes('error TS2613') && retryBuildOutput.includes('App')) {
                console.error('❌ Build still failed with default export error after fix')
                throw new Error('Build failed: ' + retryBuildOutput.substring(0, 500))
              } else if (retryBuildOutput.includes('error') || retryBuildOutput.includes('Error')) {
                console.error('❌ Build failed:', retryBuildOutput.substring(0, 500))
                throw new Error('Build failed: ' + retryBuildOutput.substring(0, 500))
              } else {
                console.log('✅ Build succeeded after main.tsx fix')
                buildOutput = retryBuildOutput
                buildCommand.result = retryBuildOutput
              }
            } else {
              throw new Error('Build failed: Could not auto-fix default export error')
            }
          }
        } catch (exportError) {
          console.error('Failed to fix default export error:', exportError)
          throw new Error('Build failed: ' + buildOutput.substring(0, 500))
        }
      } else if (buildOutput.includes('error') || buildOutput.includes('Error')) {
        console.error('❌ Build failed:', buildOutput.substring(0, 500));
        console.error('🚫 NOT saving broken code to database - build failed');
        throw new Error('Build failed: ' + buildOutput.substring(0, 500));
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

      // Verify the HTML content contains the changes - check for recent component names
      const indexFile = filesToUpload.find(f => f.path === 'index.html');
      if (indexFile && Buffer.isBuffer(indexFile.content)) {
        const htmlContent = indexFile.content.toString('utf-8');
        console.log(`🔍 HTML content length: ${htmlContent.length} chars`);
        console.log(`🔍 HTML preview (first 500 chars): ${htmlContent.substring(0, 500)}`);
        
        // Check for any JavaScript bundles that might contain the app code
        const jsFiles = filesToUpload.filter(f => f.path.endsWith('.js'));
        for (const jsFile of jsFiles.slice(0, 3)) { // Check first 3 JS files
          if (Buffer.isBuffer(jsFile.content)) {
            const jsContent = jsFile.content.toString('utf-8');
            console.log(`🔍 JS file ${jsFile.path}: ${jsContent.length} chars`);
            // Look for component names or key strings from the amendment
            const componentMatches = jsContent.match(/SwapBox|SwapInterface|InstrumentsOffered/g);
            if (componentMatches) {
              console.log(`✅ Found component references in ${jsFile.path}: ${componentMatches.slice(0, 5).join(', ')}`);
            }
          }
        }
      }

      // 🎯 CRITICAL: Only save to database if build succeeded
      console.log('💾 Saving successful build to database...');

      // Create a new build record for this amendment
      const { createBuild, finalizeBuild, saveProjectFilesToBuild, updateBuild } = await import('@/lib/db')
      let buildRecord: any = null
      try {
        const storagePath = `${userId}/${projectId}`
        buildRecord = await createBuild(projectId, userId, { 
          storage_path: storagePath, 
          build_hash: buildResult.buildHash 
        })
        console.log(`📦 Created build record: ${buildRecord.id} (version ${buildRecord.version})`)
      } catch (buildError) {
        console.error('Failed to create build record:', buildError)
        // Continue anyway, but files won't be linked to a build
      }

      // Use the merged file set we created earlier (finalFiles)
      const updatedFiles = finalFiles.map(f => ({
        path: f.path,
        content: f.content
      }));

      // CRITICAL: Save files with build_id to ensure continuity
      if (buildRecord?.id) {
        await saveProjectFilesToBuild(projectId, buildRecord.id, updatedFiles);
        console.log(`✅ Project files saved to database with build_id: ${buildRecord.id}`);
        
        // Finalize the build as successful
        await finalizeBuild(buildRecord.id, 'success');
        console.log(`✅ Build ${buildRecord.id} finalized as successful`);
      } else {
        // Fallback: save without build_id (not ideal, but better than failing)
      await saveProjectFiles(projectId, updatedFiles);
        console.warn('⚠️ Project files saved without build_id (build record creation failed)');
      }

      // Update project with build information
      await updateProject(projectId, {
        build_hash: buildResult.buildHash,
        build_version: buildRecord?.version ?? undefined,
        storage_path: `${userId}/${projectId}`,
        preview_url: cacheBustUrl, // Update the preview URL with cache-busting
        last_generated_at: new Date().toISOString(),
        status: 'active'
      });

      // Generate/update description.md with current project structure
      try {
        const componentFiles = finalFiles.filter(f => 
          f.path.startsWith('src/components/') && (f.path.endsWith('.tsx') || f.path.endsWith('.ts'))
        );
        const componentNames = componentFiles.map(f => {
          const name = f.path.split('/').pop()?.replace(/\.(tsx|ts)$/, '') || '';
          return name;
        }).filter(Boolean).sort();
        
        const recentChanges = amendmentData.summary || `Updated ${amendmentData.files.length} file(s)`;
        const lastModified = new Date().toISOString();
        
        const descriptionContent = `# Project Description

## Last Updated
${lastModified}

## Recent Changes
${recentChanges}

## Project Structure
This is a React/Vite application using TypeScript, shadcn/ui components, and Lucide React icons.

## Components
${componentNames.map(name => `- ${name}`).join('\n')}

## Key Files
- \`src/App.tsx\` - Main application entry point
- \`src/components/\` - React components (all with ZERO props)
- \`src/components/ui/\` - shadcn/ui pre-built components
- \`public/\` - Static assets (images, etc.)

## Important Rules
- All custom components have ZERO props - content is defined internally
- Use shadcn/ui components from \`@/components/ui/\` (lowercase paths)
- Use Lucide React icons for visual elements
- Do NOT import from \`@/components/lib/\` - these don't exist
`;

        // Add description.md to finalFiles
        const descriptionIndex = finalFiles.findIndex(f => f.path === 'description.md');
        if (descriptionIndex >= 0) {
          finalFiles[descriptionIndex].content = descriptionContent;
        } else {
          finalFiles.push({
            path: 'description.md',
            content: descriptionContent
          });
        }
        
        // Update updatedFiles to include description.md
        updatedFiles.push({
          path: 'description.md',
          content: descriptionContent
        });
        
        console.log('✅ Generated/updated description.md');
      } catch (descErr) {
        console.error('Failed to generate description.md:', descErr);
      }

      // Update vector index for ALL modified files (from finalFiles, not just amendmentData.files)
      // CRITICAL: Use the new build_id to ensure chunks are linked to the latest build
      try {
        const { embedTexts, codeAwareChunks } = await import('@/lib/embeddings')
        const { saveFileChunks, getLatestBuildId } = await import('@/lib/db')
        
        // Get the latest build_id (should be the one we just created above)
        // Use buildRecord.id if available, otherwise fetch latest
        const latestBuildIdForChunks = buildRecord?.id || await getLatestBuildId(projectId);
        if (!latestBuildIdForChunks) {
          console.warn('⚠️ No build_id found for vector index update, chunks may not be linked to latest build');
        } else {
          console.log(`📦 Linking vector chunks to build ${latestBuildIdForChunks}`);
        }
        
        // Get all files that were modified (either directly or through merging)
        const modifiedFilePaths = new Set<string>();
        amendmentData.files.forEach(f => modifiedFilePaths.add(f.path));
        // Also include description.md
        modifiedFilePaths.add('description.md');
        
        // Re-chunk ALL modified files from finalFiles
        const allChunks: Array<{ file_path: string; chunk_index: number; content: string }> = []
        for (const filePath of Array.from(modifiedFilePaths)) {
          const file = finalFiles.find(f => f.path === filePath);
          if (file) {
            const parts = codeAwareChunks(file.path, file.content)
            parts.forEach((p, i) => allChunks.push({ file_path: file.path, chunk_index: i, content: p }))
          }
        }
        
        console.log(`📦 Re-chunking ${modifiedFilePaths.size} modified file(s) into ${allChunks.length} chunk(s)`);
        
        // Validate chunk sizes (should all be < 2000 chars after fix)
        const oversizedChunks = allChunks.filter(c => c.content.length > 2000);
        if (oversizedChunks.length > 0) {
          console.warn(`⚠️ Found ${oversizedChunks.length} oversized chunk(s):`, oversizedChunks.map(c => `${c.file_path}[${c.chunk_index}]: ${c.content.length} chars`));
        }
        
        const embeddings = await embedTexts(allChunks.map(c => c.content))
        const chunkRows = allChunks.map((c, idx) => ({ file_path: c.file_path, chunk_index: c.chunk_index, content: c.content, embedding: embeddings[idx] }))
        // CRITICAL: Save chunks with the latest build_id to ensure they're linked to the correct build
        await saveFileChunks(projectId, latestBuildIdForChunks, chunkRows) // This will delete old chunks for these files first
        console.log(`✅ Updated vector index for ${chunkRows.length} chunks (linked to build ${latestBuildIdForChunks || 'none'})`)
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

