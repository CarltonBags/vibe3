import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import instruction from './systemPrompt-vite';
import { 
  checkUserLimits, 
  incrementUsage, 
  createProject, 
  updateProject, 
  saveProjectFiles,
  logGeneration,
  getUserWithTier
} from '@/lib/db';
import { GoogleGenAI } from "@google/genai";
import { executeSequentialWorkflow, Task, GeneratedFile, parseFilesMarkdown, compileFile, fixCompilationErrors } from './sequential-workflow';
import { addStatus, clearStatus } from '@/lib/status-tracker';
import { generateAiImageToSandbox } from '@/lib/ai-image';


const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_KEY
});

async function materializeRemoteImages(content: string, sandbox: any, requestId: string): Promise<string> {
  if (!content || !content.includes('<img')) {
    return content;
  }

  const remoteImgRegex = /<img[^>]*src=["'](https?:[^"']+)["'][^>]*>/gi;
  const matches = Array.from(content.matchAll(remoteImgRegex));
  if (matches.length === 0) {
    return content;
  }

  await sandbox.fs.createFolder('/workspace/public/generated-images', '755').catch(() => {});

  let updatedContent = content;
  const replacements = new Map<string, string>();

  for (const match of matches) {
    const fullTag = match[0];
    const src = match[1];
    if (replacements.has(src)) {
      const replacement = replacements.get(src)!;
      updatedContent = updatedContent.replace(new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
      continue;
    }

    const tagAltMatch = fullTag.match(/alt=["']([^"']*)["']/i);
    const altText = (tagAltMatch?.[1] || 'Generated visual').slice(0, 80);
    const sanitizedAlt = altText.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));

    const aiImage = await generateAiImageToSandbox({
      description: sanitizedAlt,
      sandbox,
      requestId,
    });

    replacements.set(src, aiImage.src);
    updatedContent = updatedContent.replace(new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), aiImage.src);
    if (!tagAltMatch) {
      const escapedNewSrc = aiImage.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const withoutAlt = new RegExp(`<img([^>]*?)src=["']${escapedNewSrc}["']([^>]*?)>`, 'i');
      updatedContent = updatedContent.replace(
        withoutAlt,
        `<img$1src="${aiImage.src}" alt="${sanitizedAlt}"$2>`
      );
    }
    console.log(`[generate:${requestId}] Replaced ${src} with ${aiImage.src} (origin=${aiImage.origin})`);
  }

  return updatedContent;
}

export async function POST(req: Request) {
  const startTime = Date.now();
  let projectId: string | null = null;
  let tokensUsed = 0;

  try {
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (e) {
      console.error('❌ Failed to parse request body:', e);
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }
    
    const { prompt, projectId: existingProjectId, template = 'vite-react', images = [], imageNames = [], requestId: clientRequestId } = requestBody;

    // Generate or use client requestId IMMEDIATELY for status tracking
    // Match frontend format: Math.random().toString(36).slice(2, 8) + Date.now().toString(36)
    const requestId = clientRequestId || (Math.random().toString(36).slice(2, 8) + Date.now().toString(36));
    
    // Initialize status tracking IMMEDIATELY so frontend polling works
    // Do this BEFORE any early returns so polling always works
    addStatus(requestId, 'initializing', 'Starting project generation...', 0);
    console.log(`[generate:${requestId}] Status initialized, clientRequestId=${clientRequestId}, using=${requestId}`);

    if (!prompt) {
      addStatus(requestId, 'error', 'Prompt is required', 0);
      return NextResponse.json(
        { error: 'Prompt is required', requestId },
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

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      addStatus(requestId, 'error', 'Unauthorized - Please sign in', 0);
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in', requestId },
        { status: 401 }
      );
    }

    const userId = userData.user.id;
    console.log(`[generate:${requestId}] start user=${userId} template=${template} promptLen=${(prompt||'').length}`)
    
    // Status already initialized above

    // Check user limits
    const limits = await checkUserLimits(userId);
    if (!limits.canGenerate) {
      return NextResponse.json(
        { 
          error: limits.reason,
          generationsRemaining: limits.generationsRemaining,
          upgradeRequired: true
        },
        { status: 403 }
      );
    }

    // Get user tier info for token limits
    const userWithTier = await getUserWithTier(userId);
    if (!userWithTier) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Cap at model's maximum (gpt-4o-mini supports max 16384 completion tokens)
    const maxTokens = Math.min(userWithTier.tier.max_tokens_per_generation, 100000);

    // Preflight: Daytona env check for clearer errors
    if (!process.env.DAYTONA_KEY) {
      console.error('[generate] Missing DAYTONA_KEY env');
      return NextResponse.json({ error: 'Server not configured: DAYTONA_KEY is missing' }, { status: 500 });
    }

    // Prepare template context for planning (default to Vite; modular later via template param)
    const { getTemplateFiles } = await import('@/lib/templates');
    const planningTemplate = {
      id: 'vite-react',
      name: 'Vite + React + TypeScript',
      description: 'Fast React development with Vite, TypeScript, and Tailwind CSS',
      templatePath: 'templates/vite',
      systemPromptPath: 'app/api/chat/systemPrompt.ts',
      buildCommand: 'npm run build',
      devCommand: 'npm run dev',
      buildDir: 'dist'
    };
    const planningTemplateFiles = getTemplateFiles(planningTemplate);
    const planningPackageJson = planningTemplateFiles['package.json'] || '{}';

    // Phase 1: Create a detailed plan with gpt-4o-mini including exact component interfaces
    const planSystem = `You are a project planner for a web app generator. Your plan will be used by code generation AI to build the exact application.

CRITICAL REQUIREMENTS:
1. Define EXACT TypeScript interfaces for EVERY component without using props. Props are stritly forbidden!
2. Specify which components import which other components
3. Include exact file structure with imports/exports

Return ONLY valid JSON with this EXACT structure. Plan components that make sense for the users request:
{
  "app_summary": "brief description",
  "tech_stack": ["react", "vite", "typescript", "tailwind"],
  "folders": [{"name": "src/components", "purpose": "..."}],
  "task_flow": [
    {
      "step": 1,
      "task": "Create types",
      "file": "src/types/index.ts",
      "description": "Define TypeScript interfaces and types",
      "dependencies": []
    },
    {
      "step": 2,
      "task": "Create Header component",
      "file": "src/components/Header.tsx",
      "description": "Navigation header with zero props",
      "dependencies": ["src/types/index.ts"]
    },
    {
      "step": 3,
      "task": "Create Hero component",
      "file": "src/components/Hero.tsx",
      "description": "Hero section with zero props",
      "dependencies": ["src/types/index.ts"]
    }
  ],
  "components": [
    {
      "name": "Header",
      "file": "src/components/Header.tsx",
      "task_step": 2,
      "interface": "NO PROPS - export function Header() with no props",
      "props_required": [],
      "props_optional": [],
      "imports_from": ["Button from @/components/ui/button", "Menu from lucide-react", "X from lucide-react"],
      "exports": ["Header"],
      "description": "Main navigation header component with zero props"
    }
  ],
  "types": [
    {
      "name": "Service",
      "file": "src/types/index.ts",
      "interface": "export interface Service { id: string; title: string; description: string; icon: string; }",
      "usage_in": ["src/pages/Services.tsx", "src/hooks/useServices.ts"]
    }
  ]
}


PRE-BUILT COMPONENTS:
The template includes pre-built UI and library components that should be USED, not created:

UI COMPONENTS (shadcn/ui - lowercase filenames):
- All shadcn/ui components in src/components/ui/ (button, card, input, label, dialog, dropdown-menu, select, tabs, badge, avatar, alert, table, form, textarea, checkbox, radio-group, slider, progress, etc.)
- Import from "@/components/ui/button", "@/components/ui/card", etc. (lowercase paths)
- NEVER create files in src/components/ui/ - they already exist

⚠️ CRITICAL - CREATE COMPONENTS WITH ZERO PROPS:
- ❌ DO NOT import from "@/components/lib/" - these components do NOT exist and will cause build errors
- ✅ The AI must CREATE Header.tsx, Hero.tsx, Footer.tsx, FeatureCard.tsx, etc. as SEPARATE component files in src/components/
- ✅ All components must have ZERO props - NO props interface, define all content internally
- ✅ Use shadcn/ui components (Button, Card, Input, etc.) from "@/components/ui/" as building blocks
- ⚠️ CRITICAL - LUCIDE ICON IMPORTS: List EVERY icon that will be used and ensure imports are specified
- ⚠️ Example: If Header.tsx uses <Menu /> and <X />, imports_from must include "Menu from lucide-react" and "X from lucide-react"

When planning:
- Plan to create Header.tsx, Hero.tsx, Footer.tsx, etc. as SEPARATE component files in src/components/
- List ALL icons each component will use in the imports_from field
- Components must have ZERO props - export function Footer() { return <footer>...</footer> } with NO props`;

    const planUserPayload = {
      prompt: prompt,
      template: planningTemplate.id,
      template_package_json: JSON.parse(planningPackageJson),
      available_ui_components: [
        "Button", "Card", "Input", "Label", "Dialog", "DropdownMenu", "Select", "Tabs", "Badge",
        "Avatar", "Alert", "Table", "Form", "Textarea", "Checkbox", "RadioGroup", "Slider", "Progress"
      ],
      ui_component_path: "@/components/ui",
      icons_library: "lucide-react",
      instruction: "DO NOT import from '@/components/lib/' - these components do NOT exist. Create Header.tsx, Hero.tsx, Footer.tsx, etc. as SEPARATE component files with ABSOLUTE ZERO PROPS - NO props interface, NO props parameter, NO children prop, NOTHING. Use shadcn/ui components from '@/components/ui/' as building blocks. CRITICAL: List ALL Lucide React icons in imports_from (e.g., 'Menu from lucide-react', 'ArrowRight from lucide-react') to prevent build errors. 🚫 NEVER pass props - Use <ComponentName /> with NO attributes, NO children prop, NO props of any kind."
    };
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
    console.log(`[generate:${requestId}] plan tokens=${planCompletion.usage?.total_tokens||0} snippet=${(planRaw||'').slice(0,300)}`)
    addStatus(requestId, 'planning', 'Project plan created', 10);

    // Normalize plan.files to array
    let planJson: any = {};
    try { planJson = JSON.parse(planRaw) } catch {}
    let planFiles: Array<{ path: string; purpose?: string }> = []
    if (Array.isArray(planJson?.files)) {
      planFiles = planJson.files
    } else if (planJson?.files && typeof planJson.files === 'object') {
      planFiles = Object.keys(planJson.files).map(k => ({ path: k, purpose: planJson.files[k] }))
    }
    console.log(`[generate:${requestId}] plan files count=${planFiles.length}`)

    // Start sandbox creation in parallel with AI generation
    const sandboxPromise = (async () => {
      try {
        const daytona = new Daytona({
          apiKey: process.env.DAYTONA_KEY || '',
          apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io'
        });

        console.log('[generate] Creating Daytona sandbox...');
        addStatus(requestId, 'sandbox', 'Creating sandbox environment...', 15);
        const sandbox = await daytona.create({
          image: 'node:20-alpine',
          public: true,
          ephemeral: true,
        });
        const sandboxId = sandbox.id;
        console.log('[generate] Sandbox created:', sandboxId);
        return { sandbox, sandboxId };
      } catch (e) {
        console.error('[generate] Daytona sandbox creation failed:', e);
        throw new Error('Sandbox creation failed');
      }
    })();

    // Helper: parse markdown format files (NEW APPROACH - no JSON escaping issues)
    // Expected format:
    // FILE: path/to/file.tsx
    // ```tsx
    // code content here
    // ```
    //
    // FILE: another/file.tsx
    // ```tsx
    // more code
    // ```
    const parseFilesMarkdown = (raw: string) => {
      const files: Array<{ path: string; content: string }> = [];
      try {
        // Remove any markdown wrapper if present
        let cleaned = raw.trim();
        
        // Match FILE: path followed by code block
        const filePattern = /FILE:\s*([^\n]+)\n\s*```(?:tsx?|ts|jsx?|js|json)?\n([\s\S]*?)```/g;
        let match;
        
        while ((match = filePattern.exec(cleaned)) !== null) {
          const filePath = match[1].trim();
          const content = match[2].trim();
          
          if (filePath && content) {
            files.push({ path: filePath, content });
          }
        }
        
        // Fallback: if no FILE: markers, try to find code blocks with path hints
        if (files.length === 0) {
          // Try pattern: ```tsx:path/to/file.tsx
          const altPattern = /```(?:tsx?|ts|jsx?|js|json):\s*([^\n]+)\n([\s\S]*?)```/g;
          while ((match = altPattern.exec(cleaned)) !== null) {
            const filePath = match[1].trim();
            const content = match[2].trim();
            if (filePath && content) {
              files.push({ path: filePath, content });
            }
          }
        }
        
        return files.length > 0 ? { files, summary: 'Parsed from markdown' } : null;
      } catch (e) {
        console.error('[parseFilesMarkdown] Error:', e);
        return null;
      }
    };

    // Helper: quick file validity checks (cheap heuristics)
    const isLikelyValidFile = (path: string, content: string) => {
      if (!content || content.length < 10) return false;
      if (/```/.test(content)) return false; // markdown fences leaked
      if (content.trim().startsWith('{') && content.includes('"files"')) return false; // nested JSON instead of code
      if (path.endsWith('.tsx')) {
        // cheap JSX sanity: has a return ( ... ) and matching parentheses count
        const hasReturn = /return\s*\(/.test(content);
        const parenBalance = (content.match(/\(/g)?.length || 0) - (content.match(/\)/g)?.length || 0);
        if (!hasReturn || Math.abs(parenBalance) > 2) return false;
      }
      return true;
    };

    // Helper: regenerate a single file with focused prompt
    const regenerateSingleFile = async (targetPath: string, reason: string, already: Array<{ path: string; size: number }>) => {
      // Extract relevant interfaces from plan for this file
      let relevantInterfaces = '';
      try {
        const plan = JSON.parse(planRaw);
        if (plan.components && Array.isArray(plan.components)) {
          const relevant = plan.components.filter((c: any) => c.file === targetPath);
          if (relevant.length > 0) {
            relevantInterfaces = relevant.map((c: any) => 
              `Component ${c.name} interface: ${c.interface}\nProps required: ${(c.props_required || []).join(', ') || 'none'}\nProps optional: ${(c.props_optional || []).join(', ') || 'all'}`
            ).join('\n\n');
          }
        }
        if (plan.types && Array.isArray(plan.types)) {
          const relevant = plan.types.filter((t: any) => t.file === targetPath || (t.usage_in || []).includes(targetPath));
          if (relevant.length > 0) {
            relevantInterfaces += (relevantInterfaces ? '\n\n' : '') + relevant.map((t: any) => 
              `Type ${t.name} interface: ${t.interface}`
            ).join('\n\n');
          }
        }
      } catch (e) {
        console.error('[generate] Failed to extract interfaces for regeneration:', e);
      }
      
      const singlePrompt = `Regenerate ONE file for this project following the EXACT interfaces from the plan. Output ONLY JSON {"files":[{"path":"${targetPath}","content":"..."}]}. Ensure TS/JSX correctness, no markdown fences, and no nested JSON. Reason: ${reason}.\n\n${relevantInterfaces ? 'RELEVANT INTERFACES FROM PLAN:\n' + relevantInterfaces + '\n\n' : ''}PROJECT PLAN:\n${planRaw}\n\nALREADY GENERATED (paths and sizes):\n${JSON.stringify(already)}`;
      const tryModel = async (model: string) =>
        gemini.models.generateContent({
          model,
          contents: [{ text: singlePrompt }],
          config: { systemInstruction: instruction.toString(), responseMimeType: 'application/json' as any, temperature: 0.2 }
        });
      try {
        const out = await tryModel('gemini-2.5-flash')
          .catch(() => tryModel('gemini-1.5-flash'))
          .catch(() => tryModel('gemini-1.5-pro'));
        const payload = parseFilesMarkdown(out.text || '');
        if (payload && payload.files && payload.files[0] && payload.files[0].path === targetPath) {
          const file = payload.files[0];
        return {
            path: file.path,
            content: file.content
          };
        }
      } catch {}
      return null;
    };

    // Extract task flow from plan
    let taskFlow: Task[] = [];
    try {
      if (planJson.task_flow && Array.isArray(planJson.task_flow)) {
        taskFlow = planJson.task_flow.map((t: any) => ({
          step: t.step || 0,
          task: t.task || '',
          file: t.file || '',
          description: t.description || '',
          dependencies: Array.isArray(t.dependencies) ? t.dependencies : []
        })).sort((a: Task, b: Task) => a.step - b.step);
      } else {
        // Fallback: create tasks from components/files
        const components = planJson.components || [];
        const types = planJson.types || [];
        let step = 1;
        
        // Add types first
        types.forEach((t: any) => {
          if (t.file) {
            taskFlow.push({
              step: step++,
              task: `Create ${t.name} type`,
              file: t.file,
              description: `Define ${t.name} interface`,
              dependencies: []
            });
          }
        });
        
        // Add components
        components.forEach((c: any) => {
          if (c.file && !c.file.includes('App.tsx')) {
            taskFlow.push({
              step: step++,
              task: `Create ${c.name} component`,
              file: c.file,
              description: c.description || `Create ${c.name} component with zero props`,
              dependencies: types.map((t: any) => t.file).filter(Boolean)
            });
          }
        });
      }
    } catch (e) {
      console.error('[generate] Failed to parse task flow:', e);
    }
    
    console.log(`[generate:${requestId}] task flow: ${taskFlow.length} tasks`);
    
    let collected: GeneratedFile[] = [];
    const aiReasons: string[] = []

    // Wait for sandbox before sequential generation
    const { sandbox, sandboxId } = await sandboxPromise;
    
    // Setup template files first (needed for compilation checks)
    try {
      const { getTemplate } = await import('@/lib/templates')
      const templateInfo = getTemplate(template);
      // Infer framework from template ID (vite-react -> vite, next -> next)
      const framework = templateInfo.id.includes('vite') ? 'vite' : 'next';
      
      if (framework === 'vite') {
        const { ViteHandler } = await import('./templates/vite-handler');
        const handler = new ViteHandler();
        
        addStatus(requestId, 'setup', 'Setting up project template...', 20);
        await handler.setupProject(sandbox);
        console.log(`[generate:${requestId}] Template setup complete`);
        
        // Install dependencies BEFORE starting component generation (required for TypeScript compilation)
        addStatus(requestId, 'setup', 'Installing dependencies...', 23);
        console.log(`[generate:${requestId}] Installing dependencies...`);
        await sandbox.process.executeCommand('cd /workspace && npm install');
        console.log(`[generate:${requestId}] Dependencies installed`);
        addStatus(requestId, 'setup', 'Template setup complete', 25);
      } else {
        // For Next.js, we'd import NextHandler here
        console.warn(`[generate:${requestId}] Template ${template} not yet supported`);
      }
    } catch (e) {
      console.error(`[generate:${requestId}] Template setup failed:`, e);
      addStatus(requestId, 'setup', `Template setup failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 25);
      throw e; // Re-throw to prevent continuing with broken setup
    }

    // Execute sequential workflow if we have tasks
    let rawAiResponses: Array<{ task: string; file: string; rawResponse: string; timestamp: string }> = [];
    const rawFilesMap: Map<string, string> = new Map();
    
    if (taskFlow.length > 0) {
      console.log(`[generate:${requestId}] Starting sequential component generation`);
      addStatus(requestId, 'components', `Starting to build ${taskFlow.length} components...`, 30);
      
      const workflowResult = await executeSequentialWorkflow(
        gemini,
        openai,
        sandbox,
        instruction.toString(),
        planRaw,
        taskFlow,
        images,
        imageNames,
        requestId,
        prompt // Pass user's original prompt
      );
      
      collected = workflowResult.files;
      rawAiResponses = workflowResult.rawResponses;
      
      // Store raw content for debugging
      collected.forEach(f => rawFilesMap.set(f.path, f.content));
      
      console.log(`[generate:${requestId}] Sequential workflow complete: ${collected.length} files`);
      addStatus(requestId, 'components', `All components built successfully`, 80);
    } else {
      console.warn(`[generate:${requestId}] No task flow found, falling back to old batch method`);
      addStatus(requestId, 'components', 'No task flow found', 30);
      // TODO: Could add fallback here if needed
    }

    // Generate App.tsx after all components are built
    // This will import all the generated components and create the main app structure
    if (collected.length > 0 && !collected.some(f => f.path === 'src/App.tsx')) {
      console.log(`[generate:${requestId}] Generating App.tsx with ${collected.length} components`);
      addStatus(requestId, 'app', 'Generating main App.tsx...', 85);
      
      try {
        const componentPaths = collected
          .filter(f => f.path.startsWith('src/components/') && f.path.endsWith('.tsx'))
          .map(f => f.path);
        
        console.log(`[generate:${requestId}] App.tsx generation - components to import: ${componentPaths.join(', ')}`);
        
        const appPrompt = `🚨 CRITICAL TASK: Generate ONLY the file src/App.tsx 🚨

🚫 ABSOLUTE ZERO PROPS RULE - NO EXCEPTIONS:
- ALL components MUST have ZERO props - NO props interface, NO props parameter, NO children prop, NOTHING
- NEVER pass props to components - Use <ComponentName /> with NO attributes, NO children prop, NO props of any kind
- Components define all content internally - this is MANDATORY

🚨 **CRITICAL - THIS IS NOT A COUNTER APP** 🚨
**THE USER EXPLICITLY REQUESTED:**
"${prompt}"

DO NOT generate any other files. ONLY src/App.tsx.

USER REQUEST: "${prompt}"

COMPONENTS TO IMPORT (you MUST import and use ALL of these):
${componentPaths.map(p => {
  const compName = p.split('/').pop()?.replace('.tsx', '') || '';
  const importPath = p.replace('src/', '@/');
  return `- import { ${compName} } from '${importPath}';`;
}).join('\n')}

MANDATORY CODE STRUCTURE:
\`\`\`tsx
${componentPaths.map(p => {
  const compName = p.split('/').pop()?.replace('.tsx', '') || '';
  const importPath = p.replace('src/', '@/');
  return `import { ${compName} } from '${importPath}';`;
}).join('\n')}

function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <Hero />
      ${componentPaths.filter(p => !p.includes('Header') && !p.includes('Hero') && !p.includes('Footer')).map(p => {
        const compName = p.split('/').pop()?.replace('.tsx', '') || '';
        return `      <${compName} />`;
      }).join('\n')}
      <Footer />
    </div>
  );
}

export default App;
\`\`\`

CRITICAL RULES - ZERO PROPS:
- ✅ MUST output file path: FILE: src/App.tsx
- ✅ MUST use markdown code block with \`\`\`tsx
- ✅ MUST import ALL components listed above
- ✅ MUST use ALL components in JSX
- 🚫 **ZERO PROPS**: ALL components have ZERO props - use them like: <Header />, <Hero />, <FeatureCard /> (NO props!)
- 🚫 **NEVER pass props**: Do NOT write <FeatureCard title="..." /> or <Header logoHref="..." /> - these components have NO props!
- ✅ NO useState for counters
- ✅ NO "Click me" buttons
- ✅ Follow user request: "${prompt}"
- ✅ Dark theme: bg-black text-white
- ❌ DO NOT generate description.md or any other files
- ❌ DO NOT generate Header.tsx, Hero.tsx, or any component files (they already exist)
- ❌ ONLY generate src/App.tsx

EXAMPLE (CORRECT - NO PROPS):
<Header />
<Hero />
<FeatureCard />
<Footer />

EXAMPLE (WRONG - HAS PROPS):
<Header logoHref="/" />
<Hero title="Welcome" />
<FeatureCard title="Feature" description="Desc" icon="icon" />`;

        console.log(`[generate:${requestId}] Calling Gemini for App.tsx generation...`);
        
        // Create a specialized system instruction for App.tsx that overrides the general one
        const appSystemInstruction = `You are a TypeScript/React code generator. Generate ONLY the file requested. Do NOT generate any other files. Output ONLY in markdown format with FILE: path and code block.`;
        
        const appResponse = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ text: appPrompt }],
          config: {
            systemInstruction: appSystemInstruction, // Use specialized instruction instead of general one
            temperature: 0.2 // Lower temperature for more deterministic output
          }
        });
        
        console.log(`[generate:${requestId}] Gemini responded for App.tsx, length: ${(appResponse.text || '').length}`);
        console.log(`[generate:${requestId}] Raw App.tsx response (first 1000 chars): ${(appResponse.text || '').slice(0, 1000)}`);
        const appParsed = parseFilesMarkdown(appResponse.text || '');
        
        if (!appParsed || appParsed.files.length === 0) {
          console.error(`[generate:${requestId}] ❌ FAILED TO PARSE App.tsx from Gemini response`);
          console.error(`[generate:${requestId}] Raw response snippet: ${(appResponse.text || '').slice(0, 1000)}`);
          addStatus(requestId, 'app', 'Failed to parse App.tsx - retrying with stronger prompt...', 85);
          
          // CRITICAL: If parsing fails, we MUST generate a valid App.tsx or the template counter will be used
          // Try a more direct approach
          const fallbackAppPrompt = `Generate ONLY the App.tsx file content. NO markdown, NO code fences, just the raw TypeScript/React code.

USER REQUEST: "${prompt}"

COMPONENTS TO IMPORT AND USE:
${componentPaths.map(p => {
  const compName = p.split('/').pop()?.replace('.tsx', '') || '';
  const importPath = p.replace('src/', '@/');
  return `import { ${compName} } from '${importPath}';`;
}).join('\n')}

REQUIREMENTS:
- Using Props is STRICTLY FORBIDDEN
- Import ALL components above
- Use ALL components in the JSX
- NO useState for counters
- NO "Click me" buttons
- Follow user request: "${prompt}"
- Structure: Header, Hero, content sections, Footer, if user does not request an App that structured differently by nature

Return ONLY the code, no markdown, no explanations:
`;
          
          try {
            const fallbackResponse = await gemini.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [{ text: fallbackAppPrompt }],
              config: {
                systemInstruction: instruction.toString(),
                temperature: 0.2
              }
            });
            
            // Try to extract code from response (might have markdown or be plain)
            let fallbackContent = fallbackResponse.text || '';
            // Remove markdown code fences if present
            fallbackContent = fallbackContent.replace(/^```tsx?\n?/gm, '').replace(/^```\n?/gm, '').replace(/```$/gm, '').trim();
            // Remove FILE: prefix if present
            fallbackContent = fallbackContent.replace(/^FILE:\s*[^\n]+\n?/gm, '').trim();
            
            if (fallbackContent && fallbackContent.includes('function App') || fallbackContent.includes('export default')) {
              const fallbackCompile = await compileFile(sandbox, 'src/App.tsx', fallbackContent);
              if (fallbackCompile.success) {
                collected.push({ path: 'src/App.tsx', content: fallbackContent });
                console.log(`[generate:${requestId}] ✓ Fallback App.tsx compiled successfully`);
                addStatus(requestId, 'app', 'App.tsx generated (fallback)', 90);
          } else {
                console.error(`[generate:${requestId}] Fallback App.tsx still has errors:`, fallbackCompile.errors);
              }
            }
          } catch (fallbackErr) {
            console.error(`[generate:${requestId}] Fallback App.tsx generation failed:`, fallbackErr);
          }
        }
        
        if (appParsed && appParsed.files.length > 0 && appParsed.files[0].path === 'src/App.tsx') {
          const appFile = appParsed.files[0];
          
          // Check if App.tsx compiles
          addStatus(requestId, 'app', 'Compiling App.tsx...', 87);
          const appCompile = await compileFile(sandbox, 'src/App.tsx', appFile.content);
          if (appCompile.success) {
            collected.push(appFile);
            console.log(`[generate:${requestId}] ✓ App.tsx compiled successfully`);
            addStatus(requestId, 'app', '✓ App completed', 90);
        } else {
            // Try to fix App.tsx errors
            console.warn(`[generate:${requestId}] App.tsx has errors, attempting fix...`);
            addStatus(requestId, 'app', 'Fixing errors in App.tsx...', 88);
            const fixedApp = await fixCompilationErrors(
              openai,
              'src/App.tsx',
              appFile.content,
              appCompile.errors,
              planRaw
            );
            if (fixedApp) {
              const fixedCompile = await compileFile(sandbox, 'src/App.tsx', fixedApp);
              if (fixedCompile.success) {
                collected.push({ path: 'src/App.tsx', content: fixedApp });
                console.log(`[generate:${requestId}] ✓ App.tsx fixed and compiled`);
                addStatus(requestId, 'app', '✓ App completed', 90);
        } else {
                // Add anyway, but log warning
                collected.push(appFile);
                console.warn(`[generate:${requestId}] App.tsx added but has compilation errors`);
        }
      } else {
              collected.push(appFile);
              console.warn(`[generate:${requestId}] App.tsx added but fix failed`);
            }
          }
        } else if (appParsed && appParsed.files.length > 0) {
          // If parsed but path doesn't match, try to find App.tsx in the parsed files
          console.warn(`[generate:${requestId}] App.tsx parsed but path mismatch. Parsed files: ${appParsed.files.map(f => f.path).join(', ')}`);
          
          // Look for App.tsx in any of the parsed files
          const appFile = appParsed.files.find(f => f.path.includes('App.tsx') || f.path.endsWith('App.tsx'));
          
          if (appFile) {
            // Normalize path to src/App.tsx
            const normalizedApp = { path: 'src/App.tsx', content: appFile.content };
            const normalizeCompile = await compileFile(sandbox, 'src/App.tsx', normalizedApp.content);
            if (normalizeCompile.success) {
              collected.push(normalizedApp);
              console.log(`[generate:${requestId}] ✓ App.tsx found and normalized, compiled successfully`);
              addStatus(requestId, 'app', '✓ App completed', 90);
            } else {
              collected.push(normalizedApp);
              console.warn(`[generate:${requestId}] App.tsx normalized but has errors:`, normalizeCompile.errors);
            }
          } else {
            // If no App.tsx found, try to extract it from the raw response
            console.error(`[generate:${requestId}] No App.tsx found in parsed files. Trying to extract from raw response...`);
            const rawResponse = appResponse.text || '';
            // Look for code blocks that might contain App.tsx (try multiple patterns)
            let extractedApp: string | null = null;
            
            // Pattern 1: Standard code block with function App
            const codeBlockMatch = rawResponse.match(/```tsx?\n([\s\S]*?)```/);
            if (codeBlockMatch && (codeBlockMatch[1].includes('function App') || codeBlockMatch[1].includes('export default'))) {
              extractedApp = codeBlockMatch[1].trim();
            }
            
            // Pattern 2: Any code block with App component
            if (!extractedApp) {
              const anyCodeBlock = rawResponse.match(/```[\s\S]*?```/);
              if (anyCodeBlock && anyCodeBlock[0].includes('function App')) {
                extractedApp = anyCodeBlock[0].replace(/```tsx?\n?/g, '').replace(/```$/g, '').trim();
              }
            }
            
            // Pattern 3: Look for function App() directly in text
            if (!extractedApp && rawResponse.includes('function App')) {
              const appMatch = rawResponse.match(/(?:function App|export default function App)[\s\S]*?export default/g);
              if (appMatch) {
                extractedApp = appMatch[0];
              }
            }
            
            if (extractedApp) {
              const extractedCompile = await compileFile(sandbox, 'src/App.tsx', extractedApp);
              if (extractedCompile.success) {
                collected.push({ path: 'src/App.tsx', content: extractedApp });
                console.log(`[generate:${requestId}] ✓ App.tsx extracted from raw response and compiled`);
                addStatus(requestId, 'app', '✓ App completed', 90);
        } else {
                console.error(`[generate:${requestId}] Extracted App.tsx has errors:`, extractedCompile.errors);
                // Still add it, might work after fixes
                collected.push({ path: 'src/App.tsx', content: extractedApp });
              }
            } else {
              console.error(`[generate:${requestId}] Could not extract App.tsx from raw response. Response length: ${rawResponse.length}`);
            }
          }
        }
      } catch (e) {
        console.error(`[generate:${requestId}] Failed to generate App.tsx:`, e);
        addStatus(requestId, 'app', `App.tsx generation failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 85);
        // CRITICAL: Generate a minimal non-counter App.tsx as absolute fallback
        const minimalApp = `import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { Footer } from '@/components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <Hero />
      <Footer />
    </div>
  );
}

export default App;
`;
        try {
          const minimalCompile = await compileFile(sandbox, 'src/App.tsx', minimalApp);
          if (minimalCompile.success) {
            collected.push({ path: 'src/App.tsx', content: minimalApp });
            console.log(`[generate:${requestId}] ✓ Minimal App.tsx fallback compiled`);
          }
        } catch (minErr) {
          console.error(`[generate:${requestId}] Even minimal App.tsx failed:`, minErr);
        }
      }
    }
    
    // CRITICAL: Ensure App.tsx is in collected before upload
    if (!collected.some(f => f.path === 'src/App.tsx')) {
      console.error(`[generate:${requestId}] ⚠️ WARNING: App.tsx is NOT in collected files! Template counter will be used!`);
      console.error(`[generate:${requestId}] Collected files: ${collected.map(f => f.path).join(', ')}`);
    } else {
      console.log(`[generate:${requestId}] ✓ App.tsx confirmed in collected files`);
    }

    // ============================================================
    // DEBUG: Save all AI-generated files to local folder for inspection
    // ============================================================
    try {
      const debugDir = path.join(process.cwd(), 'debug-ai-output')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const debugFolder = path.join(debugDir, `${timestamp}-${requestId}`)
      await fs.promises.mkdir(debugFolder, { recursive: true })
      
      // Save processed files (after JSON unescaping, etc.)
      const processedFilesDir = path.join(debugFolder, 'processed-files')
      await fs.promises.mkdir(processedFilesDir, { recursive: true })
      for (const file of collected) {
        const filePath = path.join(processedFilesDir, file.path)
        const fileDir = path.dirname(filePath)
        await fs.promises.mkdir(fileDir, { recursive: true })
        await fs.promises.writeFile(filePath, file.content, 'utf-8')
      }
      
      // Save raw AI responses (markdown format now)
      const rawResponsesDir = path.join(debugFolder, 'raw-ai-responses')
      await fs.promises.mkdir(rawResponsesDir, { recursive: true })
      for (let i = 0; i < rawAiResponses.length; i++) {
        const response = rawAiResponses[i]
        // Sanitize filename - replace path separators and special chars
        const safeFileName = (response.file || `task-${i}`)
          .replace(/[\/\\]/g, '_')
          .replace(/[^a-zA-Z0-9_.-]/g, '_')
          .replace(/_{2,}/g, '_')
          .slice(0, 100) // Limit length
        const responseFile = path.join(rawResponsesDir, `${safeFileName}-${i + 1}.md`)
        try {
          await fs.promises.writeFile(
            responseFile,
            `# ${response.task || 'Task'}\n\nFile: ${response.file}\nTimestamp: ${response.timestamp}\n\n${response.rawResponse}`,
            'utf-8'
          )
        } catch (writeErr) {
          console.warn(`Failed to save debug file ${responseFile}:`, writeErr)
        }
      }
      
      // Save raw files before processing (as they came from AI JSON, before unescaping)
      const rawFilesDir = path.join(debugFolder, 'raw-files-before-processing')
      await fs.promises.mkdir(rawFilesDir, { recursive: true })
      for (const [filePath, rawContent] of Array.from(rawFilesMap.entries())) {
        const fullPath = path.join(rawFilesDir, filePath)
        const fileDir = path.dirname(fullPath)
        await fs.promises.mkdir(fileDir, { recursive: true })
        await fs.promises.writeFile(fullPath, rawContent, 'utf-8')
      }
      
      // Save metadata
      const metadata = {
        requestId,
        timestamp: new Date().toISOString(),
        prompt: prompt.substring(0, 500),
        filesCount: collected.length,
        filePaths: collected.map(f => f.path),
        aiReasons,
        planSummary: planJson.app_summary || 'N/A',
        tasksProcessed: taskFlow.length,
        rawResponsesCount: rawAiResponses.length
      }
      await fs.promises.writeFile(
        path.join(debugFolder, '_metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf-8'
      )
      
      // Save the full plan
      await fs.promises.writeFile(
        path.join(debugFolder, '_plan.json'),
        planRaw,
        'utf-8'
      )
      
      console.log(`💾 Debug files saved to: ${debugFolder}`)
      console.log(`   - Processed files: ${processedFilesDir}`)
      console.log(`   - Raw AI responses: ${rawResponsesDir}`)
      console.log(`   - Metadata: ${path.join(debugFolder, '_metadata.json')}`)
    } catch (debugError) {
      console.error('⚠️ Failed to save debug files:', debugError)
      // Don't fail the generation if debug save fails
    }

    // If no files collected, return error
    if (collected.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'AI returned no files',
        reasons: aiReasons,
        planSnippet: (planRaw || '').slice(0, 400)
      }, { status: 502 })
    }

    // Convert collected to filesData format
    const filesData: { files: Array<{ path: string; content: string }> } = { files: collected };
    console.log(`[generate:${requestId}] collected total=${filesData.files.length} firstPaths=${filesData.files.slice(0,10).map(f=>f.path).join(', ')}`)

    // Estimate tokens used from combined text length (rough)
    tokensUsed += Math.ceil((planRaw.length + collected.reduce((a, f) => a + f.content.length, 0)) / 4);

    // Enforce max 15 files as guardrail
    if (filesData.files.length > 15) {
      filesData.files = filesData.files.slice(0, 15);
    }

    try {
      // Load template files
      const { getTemplateFiles } = await import('@/lib/templates')
      const templateConfig = {
        id: 'vite-react',
        name: 'Vite + React + TypeScript',
        description: 'Fast React development with Vite, TypeScript, and Tailwind CSS',
        templatePath: 'templates/vite',
        systemPromptPath: 'app/api/generate/systemPrompt-vite.ts',
        buildCommand: 'npm run build',
        devCommand: 'npm run dev',
        buildDir: 'dist'
      }
      const templateFiles = getTemplateFiles(templateConfig)

      // Extract template content
      const mainTsx = templateFiles['src/main.tsx']
      const appTsx = templateFiles['src/App.tsx']
      const indexCss = templateFiles['src/index.css']

      // Get template-specific handler
      const { ViteHandler } = await import('./templates/vite-handler')
      const handler = new ViteHandler()
      
      // Setup the project using the template handler
      await handler.setupProject(sandbox)
      
      // Start installing dependencies in parallel with file uploads
      const installPromise = sandbox.process.executeCommand('cd /workspace && npm install');
      
      // Check if AI generated these core files BEFORE uploading templates
      const aiGeneratedPaths = filesData.files.map(f => f.path.replace('app/', 'src/'));
      const hasAppTsx = aiGeneratedPaths.includes('src/App.tsx');
      const hasMainTsx = aiGeneratedPaths.includes('src/main.tsx');
      const hasIndexCss = aiGeneratedPaths.includes('src/index.css');
      
      // Only upload template files if AI didn't generate them
      if (!hasMainTsx) await sandbox.fs.uploadFile(Buffer.from(mainTsx), '/workspace/src/main.tsx');
      if (!hasAppTsx) await sandbox.fs.uploadFile(Buffer.from(appTsx), '/workspace/src/App.tsx');
      if (!hasIndexCss) await sandbox.fs.uploadFile(Buffer.from(indexCss), '/workspace/src/index.css');
      
      // Upload user-provided images to public folder
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
          
          console.log(`📤 Uploading image: ${imgName} -> ${finalName} to ${publicPath}`);
          
          // Convert base64 to buffer and upload
          const imgBuffer = Buffer.from(base64Data, 'base64');
          await sandbox.fs.uploadFile(imgBuffer, publicPath);
          
          console.log(`✅ Uploaded user image: ${publicPath} (${imgBuffer.length} bytes)`);
        }
      }
      
      // Upload all generated files (with validation)
      for (const file of filesData.files) {
        // Map app/ paths to src/ for Vite
        const filePath = file.path.replace('app/', 'src/');
        const fullPath = `/workspace/${filePath}`;
        let content = file.content;

        // Sanitize CSS files to avoid JSX or component tokens leaking into CSS
        if (fullPath.endsWith('.css')) {
          try {
            // Remove obvious non-CSS tokens
            content = content
              .split('\n')
              .filter(line => !/FontAwesomeIcon|<\/?[A-Za-z]/.test(line) && !/^\s*import\s+/.test(line))
              .join('\n');
          } catch {}
        }
        
          // NOTE: Using Lucide React icons instead of FontAwesome to avoid duplicate import errors
        
        // CRITICAL: Final validation before upload - check if content is still JSON
        if (content.trim().startsWith('{') && (content.includes('"files"') || content.includes('"path"'))) {
          try {
            const emergency = JSON.parse(content);
            if (emergency.files && emergency.files[0]) {
              content = emergency.files[0].content;
            }
          } catch (e) {
            // Regex fallback
            const match = content.match(/"content":\s*"((?:[^"\\]|\\[\s\S])*)"/);
            if (match) {
              content = match[1]
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            }
          }
        }
        
        // Note: Vite doesn't need 'use client' directive like Next.js
        // React components in Vite are client-side by default
        
        if (fullPath.endsWith('.tsx') || fullPath.endsWith('.jsx') || fullPath.endsWith('.html')) {
          content = await materializeRemoteImages(content, sandbox, requestId);
        }
        
        // Fix unreliable placeholder image URLs
        if (content.includes('via.placeholder.com') || content.includes('placeholder.com') || content.includes('lorempixel.com')) {
          // Replace placeholder URLs with SVG data URLs
          content = content
            .replace(/https?:\/\/[^"'\s]*placeholder\.com[^"'\s]*/g, 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjNGNEY2Ii8+Cjx0ZXh0IHg9Ijc1IiB5PSI3NSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzlDQTNBRiIgZm9udC1zaXplPSIxNCI+UGxhY2Vob2xkZXI8L3RleHQ+Cjwvc3ZnPg==')
            .replace(/https?:\/\/[^"'\s]*via\.placeholder\.com[^"'\s]*/g, 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjNGNEY2Ii8+Cjx0ZXh0IHg9Ijc1IiB5PSI3NSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzlDQTNBRiIgZm9udC1zaXplPSIxNCI+UGxhY2Vob2xkZXI8L3RleHQ+Cjwvc3ZnPg==')
            .replace(/https?:\/\/[^"'\s]*lorempixel\.com[^"'\s]*/g, 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjNGNEY2Ii8+Cjx0ZXh0IHg9Ijc1IiB5PSI3NSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzlDQTNBRiIgZm9udC1zaXplPSIxNCI+UGxhY2Vob2xkZXI8L3RleHQ+Cjwvc3ZnPg==');
        }

        await sandbox.fs.uploadFile(Buffer.from(content), fullPath);
      }

      // Library components are NOT uploaded - AI must create them inline without props

      // Wait for dependency installation to complete
      await installPromise;
      
      // ============================================================
      // PREFLIGHT TEST & AUTO-DEBUGGING
      // ============================================================
      
      let hasErrors = true;
      let debugAttempts = 0;
      const MAX_DEBUG_ATTEMPTS = 3;
      
      while (hasErrors && debugAttempts < MAX_DEBUG_ATTEMPTS) {
        debugAttempts++;
        
        // Check for TypeScript errors
        const tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
        const tsErrors = tsCheckResult.result || '';
        
        // Skip lint check for Vite projects (no ESLint configured in template)
        const lintErrors = '';
        
        // Check if there are critical errors
        const hasTsErrors = tsErrors.includes('error TS');
        const hasSyntaxErrors = tsErrors.includes('Syntax Error') || lintErrors.includes('Syntax Error') || tsErrors.includes('Unexpected token');
        const hasMissingImports = tsErrors.includes('Cannot find module') || tsErrors.includes('Module not found');
        const hasJsonError = tsErrors.includes('"files"') || tsErrors.includes('Expected');
        const hasJsxError = tsErrors.includes('closing tag') || tsErrors.includes('Expected corresponding JSX') || tsErrors.includes('jsx identifier');
        const hasStringLiteralError = tsErrors.includes('TS1002') || tsErrors.includes('Unterminated string literal');
        const hasPropError = tsErrors.includes('is missing') || tsErrors.includes('does not exist in type') || tsErrors.includes('Property') || tsErrors.includes('is not assignable to');
        
        if (!hasTsErrors && !hasSyntaxErrors && !hasMissingImports && !hasJsonError && !hasJsxError && !hasStringLiteralError && !hasPropError) {
          hasErrors = false;
          break;
        }
        
        if (debugAttempts >= MAX_DEBUG_ATTEMPTS) {
          break;
        }
        
        // Check which files have errors from the preflight output
        // Match patterns like: src/components/Header.tsx(19,6): or src/App.tsx
        const errorFileMatches = Array.from(tsErrors.matchAll(/(?:^|\n)(src\/[^\s(]+\.tsx)/g));
        if (errorFileMatches.length === 0) {
          break;
        }
        
        // Get unique file paths
        const errorFiles = Array.from(new Set(errorFileMatches.map(m => m[1])));
        console.log(`🔧 Files with errors: ${errorFiles.join(', ')}`);
        
        let anyFileFixed = false;
        
        // Fix each file with errors
        for (const errorFile of errorFiles) {
          const filePath = `/workspace/${errorFile}`;
        
        // Check if file exists before trying to download
        let pageText = '';
        try {
          const pageContent = await sandbox.fs.downloadFile(filePath);
          pageText = pageContent.toString('utf-8');
        } catch (fileError) {
          console.error(`Could not read file ${filePath}:`, fileError);
            continue;
        }
        
        // Common fixes
        let fixedContent = pageText;
        let needsFix = false;
        
        // Fix 1: Check if content starts with JSON (invalid code) - DO THIS FIRST
        const trimmedContent = fixedContent.trim();
        if (trimmedContent.startsWith('{') && (trimmedContent.includes('"files"') || trimmedContent.includes('"path"'))) {
          try {
            // Try to parse as full JSON response
            const jsonMatch = JSON.parse(fixedContent);
            if (jsonMatch.files && Array.isArray(jsonMatch.files) && jsonMatch.files[0]) {
              fixedContent = jsonMatch.files[0].content;
              needsFix = true;
            }
          } catch (e) {
            // Try to find "content": "..." pattern
            const contentMatch = fixedContent.match(/"content":\s*"((?:[^"\\]|\\[\s\S])*)"/);
            if (contentMatch) {
              fixedContent = contentMatch[1]
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
              needsFix = true;
            } else {
              // Last resort: try to extract everything after first "content": until last }
              const betterMatch = fixedContent.match(/"content":\s*"([^]*?)"\s*\}(?:\s*\])?(?:\s*\})?$/);
              if (betterMatch) {
                fixedContent = betterMatch[1]
                  .replace(/\\n/g, '\n')
                  .replace(/\\t/g, '\t')
                  .replace(/\\"/g, '"')
                  .replace(/\\\\/g, '\\');
                needsFix = true;
              }
            }
          }
        }
        
        // Note: Vite doesn't need 'use client' directive
        
          // Fix 3: If string literal errors detected, try to fix them
          if (hasStringLiteralError && !needsFix) {
            try {
              // Find lines with unterminated strings by looking for odd number of quotes
              const lines = fixedContent.split('\n');
              let fixedLines = [...lines];
              let hasFixes = false;

              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const singleQuotes = (line.match(/'/g) || []).length;
                const doubleQuotes = (line.match(/"/g) || []).length;

                // If we have odd number of quotes, likely unterminated string
                if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
                  // Try to fix by escaping quotes or adding closing quotes
                  let fixedLine = line;

                  // Replace unescaped quotes with escaped ones (simple approach)
                  fixedLine = fixedLine.replace(/([^\\])'/g, '$1\\\'');
                  fixedLine = fixedLine.replace(/([^\\])"/g, '$1\\"');

                  // If the line ends with an operator or comma, it might need a closing quote
                  if (fixedLine.trim().match(/[+\-*/,;]$/) && !fixedLine.trim().endsWith("'") && !fixedLine.trim().endsWith('"')) {
                    // Add a closing quote (prefer double quotes for JSX)
                    fixedLine += '"';
                  }

                  if (fixedLine !== line) {
                    fixedLines[i] = fixedLine;
                    hasFixes = true;
                  }
                }
              }

              if (hasFixes) {
                fixedContent = fixedLines.join('\n');
                needsFix = true;
              }
            } catch (fixError) {
              console.error('String literal fix failed:', fixError);
            }
          }

          // Fix 4: Manual JSX fixes first
        if (hasJsxError && !needsFix) {
            let manualFixed = pageText;

            // Fix 1: Add parent wrapper if multiple root elements
            if (tsErrors.includes('JSX expressions must have one parent element')) {
              // Look for return statement with multiple JSX elements
              const returnMatch = manualFixed.match(/return\s*\(\s*([\s\S]*?)\s*\)/);
              if (returnMatch) {
                const returnContent = returnMatch[1];
                // Check if it starts with < and has multiple top-level elements
                if (returnContent.includes('<') && !returnContent.trim().startsWith('<>') && !returnContent.trim().startsWith('<div') && !returnContent.trim().startsWith('<React.Fragment')) {
                  // Count top-level JSX elements
                  const topLevelJsx = returnContent.match(/<[^/][^>]*>/g) || [];
                  if (topLevelJsx.length > 1) {
                    manualFixed = manualFixed.replace(
                      /return\s*\(\s*([\s\S]*?)\s*\)/,
                      'return (\n    <div>\n      $1\n    </div>\n  )'
                    );
                  }
                }
              }
            }

            // Fix 2: Escape HTML angle brackets in strings
            if (tsErrors.includes('Unexpected token') && tsErrors.includes('>')) {
              manualFixed = manualFixed.replace(/([^\\])</g, '$1&lt;').replace(/([^\\])>/g, '$1&gt;');
            }

            // Fix 3: Fix unclosed JSX tags
            if (tsErrors.includes('Expected corresponding JSX closing tag')) {
              // Simple fix: ensure common tags are closed
              const commonTags = ['div', 'section', 'p', 'h1', 'h2', 'h3', 'span', 'button'];
              for (const tag of commonTags) {
                const openCount = (manualFixed.match(new RegExp(`<${tag}[^>]*>`, 'g')) || []).length;
                const closeCount = (manualFixed.match(new RegExp(`</${tag}>`, 'g')) || []).length;
                if (openCount > closeCount) {
                  manualFixed += `\n    </${tag}>`;
                }
              }
            }

            if (manualFixed !== pageText) {
              fixedContent = manualFixed;
              needsFix = true;
            }
          }

          // Fix 5: If manual fixes didn't work or there are still JSX errors, ask AI to fix them
          if (hasJsxError && !needsFix) {
          try {
            const jsxFixCompletion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content: "You are a React/JSX expert. Fix JSX syntax errors like mismatched tags, unclosed tags, or unexpected tokens. Return ONLY the corrected code, no explanations."
                },
                {
                  role: "user",
                  content: `Fix the JSX syntax errors in this code:\n\n${tsErrors}\n\nCode:\n\`\`\`\n${pageText}\n\`\`\``
                }
              ],
              temperature: 0.3,
              max_tokens: 8000
            });
            
            const fixedCode = jsxFixCompletion.choices[0]?.message?.content || '';
            const cleaned = fixedCode.replace(/```tsx\n?/g, '').replace(/```\n?/g, '').trim();
            
            if (cleaned.length > 100) {
              fixedContent = cleaned;
              needsFix = true;
            }
          } catch (aiError) {
            console.error('AI fix failed:', aiError);
          }
        }

        // Fix 5.5: Remove invalid props from style tags (jsx, global)
        // Check for TS2322 errors related to jsx/global props on style tags
        const hasStylePropsError = (tsErrors.includes('jsx') && tsErrors.includes('style')) || 
                                   (tsErrors.includes('TS2322') && tsErrors.includes('Property') && tsErrors.includes('jsx')) ||
                                   (tsErrors.includes('does not exist') && tsErrors.includes('jsx') && tsErrors.includes('style'));
        
        if (hasStylePropsError && fixedContent.includes('<style')) {
          // Remove jsx and global props from style tags - multiple patterns
          fixedContent = fixedContent.replace(/<style\s+jsx(?:={true}|={false}|={\s*true\s*}|={\s*false\s*})?\s*/g, '<style ');
          fixedContent = fixedContent.replace(/<style\s+global(?:={true}|={false}|={\s*true\s*}|={\s*false\s*})?\s*/g, '<style ');
          fixedContent = fixedContent.replace(/jsx={true}\s*/g, '');
          fixedContent = fixedContent.replace(/jsx={false}\s*/g, '');
          fixedContent = fixedContent.replace(/jsx\s+/g, '');
          fixedContent = fixedContent.replace(/global={true}\s*/g, '');
          fixedContent = fixedContent.replace(/global={false}\s*/g, '');
          fixedContent = fixedContent.replace(/global\s+/g, '');
          // Also handle jsx prop as attribute: <style jsx={true}>
          fixedContent = fixedContent.replace(/<style\s+jsx\s*=\s*{?true}?\s*/g, '<style ');
          fixedContent = fixedContent.replace(/<style\s+jsx\s*=\s*{?false}?\s*/g, '<style ');
          fixedContent = fixedContent.replace(/<style\s+global\s*=\s*{?true}?\s*/g, '<style ');
          fixedContent = fixedContent.replace(/<style\s+global\s*=\s*{?false}?\s*/g, '<style ');
          if (fixedContent !== pageText) {
            needsFix = true;
            console.log(`🔧 Removed invalid jsx/global props from style tag in ${errorFile}`);
          }
        }
        
        // Fix 5.6: Remove props from components (ABSOLUTE ZERO PROPS RULE)
        // NOTE: Only remove props from CUSTOM components, NOT from library components
        const hasPropsError = tsErrors.includes('TS2559') || 
                             (tsErrors.includes('TS2322') && (tsErrors.includes('IntrinsicAttributes') || tsErrors.includes('is not assignable'))) ||
                             (tsErrors.includes('Property') && tsErrors.includes('does not exist in type') && tsErrors.includes('IntrinsicAttributes'));
        
        if (hasPropsError && fixedContent) {
          // Find components with props being passed
          const propsPattern = /<([A-Z][a-zA-Z0-9]*)\s+[^/>]*>/g;
          let match;
          const componentsWithProps = new Set<string>();
          // Library components that REQUIRE props - DO NOT remove props from these
          const libraryComponents = [
            // shadcn/ui components
            'Button', 'Card', 'Input', 'Dialog', 'Select', 'Textarea', 'Label', 'Badge', 'Alert', 
            'Sheet', 'Drawer', 'DropdownMenu', 'Popover', 'Tooltip', 'Tabs', 'TabsList', 'TabsTrigger', 
            'TabsContent', 'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
            'Checkbox', 'RadioGroup', 'Slider', 'Switch', 'Progress', 'Skeleton', 'Avatar', 
            'Separator', 'ScrollArea', 'AspectRatio', 'Form', 'FormField', 'FormItem', 'FormLabel',
            'FormControl', 'FormDescription', 'FormMessage', 'Table', 'TableHeader', 'TableBody',
            'TableRow', 'TableHead', 'TableCell',
            // react-router-dom components
            'Link', 'NavLink', 'Route', 'Routes', 'Navigate', 'Outlet', 'Router'
          ];
          
          while ((match = propsPattern.exec(fixedContent)) !== null) {
            const componentName = match[1];
            // Skip library components (they MUST have props) - only flag custom components
            if (!libraryComponents.includes(componentName) && /^[A-Z]/.test(componentName)) {
              componentsWithProps.add(componentName);
            }
          }
          
          // Remove props from all detected components
          for (const compName of Array.from(componentsWithProps)) {
            // Remove props: <ComponentName prop="value" /> -> <ComponentName />
            fixedContent = fixedContent.replace(
              new RegExp(`<${compName}\\s+[^/>]*/>`, 'g'), 
              `<${compName} />`
            );
            // Remove props from opening tags: <ComponentName prop="value"> -> <ComponentName>
            fixedContent = fixedContent.replace(
              new RegExp(`<${compName}\\s+([^>]*?)>`, 'g'),
              `<${compName}>`
            );
            // Handle children prop specifically
            fixedContent = fixedContent.replace(
              new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*/>`, 'g'),
              `<${compName} />`
            );
            // Remove JSX children: <ComponentName>{children}</ComponentName> -> <ComponentName />
            const childrenPattern = new RegExp(`<${compName}\\s*>[\\s\\S]*?</${compName}>`, 'g');
            if (childrenPattern.test(fixedContent)) {
              fixedContent = fixedContent.replace(childrenPattern, `<${compName} />`);
            }
          }
          
          // Also check for props interface definitions and remove them
          const propsInterfacePattern = /(interface\s+\w*Props\s*\{[^}]*\})/g;
          if (propsInterfacePattern.test(fixedContent)) {
            fixedContent = fixedContent.replace(propsInterfacePattern, '');
            // Remove props parameter from function signatures
            fixedContent = fixedContent.replace(/\(props:\s*\w*Props\)/g, '()');
            fixedContent = fixedContent.replace(/\(\{\s*[^}]+?\s*\}:\s*\w*Props\)/g, '()');
            needsFix = true;
          }
          
          if (componentsWithProps.size > 0 || propsInterfacePattern.test(fixedContent)) {
            needsFix = true;
            console.log(`🔧 Removed props from components in ${errorFile}: ${Array.from(componentsWithProps).join(', ')}`);
          }
        }

        // Fix 6: If there are property/interface errors, ask AI to fix them
        if (hasPropError && !needsFix) {
            try {
              const propFixCompletion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: "You are a TypeScript expert. Fix property and interface errors. 🚫 ABSOLUTE ZERO PROPS RULE: ALL components MUST have ZERO props - NO props interface, NO props parameter, NO children prop, NOTHING. NEVER pass props to components - Use <ComponentName /> with NO attributes, NO children prop, NO props of any kind. Remove ALL props from components. Return ONLY the corrected code, no explanations."
                  },
                  {
                    role: "user",
                    content: `Fix the TypeScript property/interface errors in this code:\n\n${tsErrors}\n\nCode:\n\`\`\`\n${pageText}\n\`\`\``
                  }
                ],
                temperature: 0.3,
                max_tokens: 8000
              });
              
              const fixedCode = propFixCompletion.choices[0]?.message?.content || '';
              const cleaned = fixedCode.replace(/```tsx\n?/g, '').replace(/```\n?/g, '').trim();
              
              if (cleaned.length > 100) {
                fixedContent = cleaned;
                needsFix = true;
              }
            } catch (aiError) {
              console.error('AI property fix failed:', aiError);
          }
        }
        
        if (needsFix) {
            await sandbox.fs.uploadFile(Buffer.from(fixedContent), filePath);
            anyFileFixed = true;
            console.log(`✅ Fixed: ${errorFile}`);
          }
        }
        
        if (!anyFileFixed) {
          console.log('⚠️ No files were fixed in this attempt, stopping auto-fix loop');
          break;
        }
      }
      
      if (hasErrors) {
        const finalTsCheck = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
        console.error('❌ FINAL TypeScript errors after all auto-fixes:');
        console.error(finalTsCheck.result);
      }
      
      // Prepare complete file list for GitHub-ready project (declare before auto-fix loop)
      const packageJson = templateFiles['package.json']
      const viteConfig = templateFiles['vite.config.ts']
      const tailwindConfig = templateFiles['tailwind.config.js']
      const postcssConfig = templateFiles['postcss.config.js']
      const tsConfig = templateFiles['tsconfig.json']
      const tsConfigNode = templateFiles['tsconfig.node.json']
      const indexHtml = templateFiles['index.html']

      // Note: aiGeneratedPaths, hasAppTsx, hasMainTsx, hasIndexCss already declared above
      const allFiles = [
        // Configuration files
        { path: 'package.json', content: packageJson },
        { path: 'vite.config.ts', content: viteConfig },
        { path: 'tailwind.config.js', content: tailwindConfig },
        { path: 'postcss.config.js', content: postcssConfig },
        { path: 'tsconfig.json', content: tsConfig },
        { path: 'tsconfig.node.json', content: tsConfigNode },
        { path: 'index.html', content: indexHtml },
        // App files (only include if AI didn't generate them)
        ...(hasMainTsx ? [] : [{ path: 'src/main.tsx', content: mainTsx }]),
        ...(hasAppTsx ? [] : [{ path: 'src/App.tsx', content: appTsx }]),
        ...(hasIndexCss ? [] : [{ path: 'src/index.css', content: indexCss }]),
        // Generated files (will be mapped from app/ to src/ by the upload loop)
        ...filesData.files
      ];
      
      // Clear any existing cache (Vite uses node_modules/.vite)
      console.log('Clearing cache...');
      await sandbox.process.executeCommand('cd /workspace && rm -rf dist node_modules/.vite node_modules/.cache || true');
      
      // Pre-check for missing components before building
      console.log('🔍 Pre-checking for missing components...');
      
      // Check if page.tsx exists
      let pageContent = '';
      try {
        const pageFile = await sandbox.fs.downloadFile('/workspace/src/App.tsx');
        pageContent = pageFile.toString('utf-8');
      } catch (pageError) {
        console.error('❌ CRITICAL: src/App.tsx not found! AI did not generate the main app file.');
        return NextResponse.json({
          success: false,
          sandboxId: sandboxId,
          error: 'AI did not generate src/App.tsx. Generated files count was insufficient.',
          files: filesData.files,
        }, { status: 500 });
      }
      
      // Check for missing imports
      const importMatches = pageContent.match(/import\s+[\w\s,{}]+\s+from\s+['"]\.\/components\/(\w+)['"]/g);
      if (importMatches) {
        const importedComponents = importMatches.map(match => {
          const componentMatch = match.match(/import\s+[\w\s,{}]+\s+from\s+['"]\.\/components\/(\w+)['"]/);
          return componentMatch ? componentMatch[1] : null;
        }).filter((comp): comp is string => comp !== null);
        
        console.log('Imported components:', importedComponents);
        
        // Check which components exist
        const componentList = await sandbox.process.executeCommand('ls /workspace/src/components/ 2>&1');
        const existingComponents = componentList.result?.split('\n').filter(f => f.endsWith('.tsx')).map(f => f.replace('.tsx', '')) || [];
        const missingComponents = importedComponents.filter(comp => !existingComponents.includes(comp));
        
        if (missingComponents.length > 0) {
          console.log('⚠️ Missing components detected:', missingComponents);
          console.log('Creating missing components before build...');
          
          for (const componentName of missingComponents) {
            const componentContent = `export function ${componentName}() {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-2">${componentName}</h3>
      <p className="text-gray-600">Component placeholder</p>
    </div>
  );
}`;
            
            await sandbox.fs.uploadFile(Buffer.from(componentContent), `/workspace/src/components/${componentName}.tsx`);
            console.log(`Created: ${componentName}.tsx`);
          }
          
          console.log('✅ All missing components created');
        } else {
          console.log('✅ All components exist');
        }
      }
      
      
      // Build with self-healing retries for JSX/tag issues
      addStatus(requestId, 'build', 'Building project for production...', 92);
      let buildOk = false
      for (let attempt = 0; attempt < 3; attempt++) {
        console.log(`🔨 Building project for production (attempt ${attempt + 1})...`);
        if (attempt > 0) {
          addStatus(requestId, 'build', `Rebuilding after fixes (attempt ${attempt + 1}/3)...`, 92);
        }
        const buildResult = await sandbox.process.executeCommand('cd /workspace && npm run build');
        const output = buildResult.result || ''
        if (!output.includes('error') && !output.includes('Error')) {
          buildOk = true
                  console.log('✅ Build completed successfully')
        addStatus(requestId, 'build', '✅ Build completed', 95);
          break
        }
        console.error('Build failed:', output)
        // Run tsc to get precise TypeScript/JSX errors
        let tsOut = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true')
        let tsText = tsOut.result || ''
        console.log('tsc output snippet:', tsText.slice(0, 500))
        
        // Detect error types
        const hasPropError = tsText.includes('is missing') || tsText.includes('does not exist in type') || 
                             tsText.includes('Property') || tsText.includes('is not assignable to') ||
                             (tsText.includes('Type') && tsText.includes('missing'))
        
        const hasCaseError = tsText.includes('TS1149') || tsText.includes('differs from already included file name') || 
                             tsText.includes('only in casing')
        
        // Fix case-sensitivity errors first (duplicate UI component files)
        if (hasCaseError) {
          console.log('🔧 Detected case-sensitivity error, fixing duplicate UI components...')
          try {
            // Find the conflicting file mentioned in the error
            const caseMatch = tsText.match(/File name '([^']+)' differs from already included file name '([^']+)' only in casing/i)
            if (caseMatch) {
              const [, file1, file2] = caseMatch
              const fileLower = file1.toLowerCase()
              const fileUpper = file2.toLowerCase()
              
              // Determine which file is the AI-generated duplicate (usually the capitalized one)
              const aiGenerated = file1.includes('/components/ui/') && /[A-Z]/.test(file1.split('/').pop() || '') 
                ? file1 
                : file2.includes('/components/ui/') && /[A-Z]/.test(file2.split('/').pop() || '')
                  ? file2
                  : null
              
              if (aiGenerated) {
                console.log(`🗑️ Removing duplicate AI-generated UI component: ${aiGenerated}`)
                await sandbox.process.executeCommand(`rm -f /workspace/${aiGenerated.replace(/^\/workspace\//, '')} || true`)
                
                // Normalize all imports to lowercase in all files
                const allFiles = await sandbox.process.executeCommand('find /workspace/src -name "*.tsx" -o -name "*.ts" | head -50')
                const fileList = (allFiles.result || '').split('\n').filter(Boolean)
                
                for (const filePath of fileList) {
                  try {
                    const fileContent = await sandbox.fs.downloadFile(filePath)
                    let content = fileContent.toString('utf-8')
                    let modified = false
                    
                    // Normalize UI component imports to lowercase
                    // Match patterns like: from "@/components/ui/Button" -> from "@/components/ui/button"
                    const uiComponentNames = ['button', 'card', 'input', 'dialog', 'label', 'textarea', 'badge', 'alert', 'alert-dialog', 'select', 'tabs', 'dropdown-menu', 'checkbox', 'radio-group', 'slider', 'progress', 'avatar', 'table', 'form', 'sheet', 'drawer', 'popover', 'tooltip', 'accordion', 'carousel', 'command', 'navigation-menu', 'menubar', 'pagination', 'separator', 'skeleton', 'switch', 'toggle', 'toggle-group', 'resizable', 'scroll-area', 'hover-card', 'context-menu', 'collapsible', 'aspect-ratio', 'breadcrumb', 'calendar', 'chart', 'input-otp', 'sidebar', 'sonner', 'toast', 'toaster']
                    
                    for (const comp of uiComponentNames) {
                      const capitalized = comp.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
                      const regex = new RegExp(`from\\s+["']@/components/ui/${capitalized}["']`, 'gi')
                      if (regex.test(content)) {
                        content = content.replace(regex, `from "@/components/ui/${comp}"`)
                        modified = true
                      }
                      // Also fix Button -> button etc.
                      const regex2 = new RegExp(`from\\s+["']@/components/ui/([A-Z][a-z-]+)["']`, 'g')
                      content = content.replace(regex2, (match, compName) => {
                        const lower = compName.toLowerCase()
                        if (uiComponentNames.includes(lower)) {
                          modified = true
                          return match.replace(compName, lower)
                        }
                        return match
                      })
                    }
                    
                    if (modified) {
                      await sandbox.fs.uploadFile(Buffer.from(content), filePath)
                      console.log(`✅ Normalized imports in ${filePath.split('/').pop()}`)
                    }
                  } catch (e) {
                    console.error(`Failed to normalize imports in ${filePath}:`, e)
                  }
                }
                
                // Re-run tsc to verify fix
                tsOut = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true')
                tsText = tsOut.result || ''
              }
            }
          } catch (e) {
            console.error('Case-sensitivity fix failed:', e)
          }
        }
        
        // Extract offending TSX files
        const fileMatches = Array.from(tsText.matchAll(/src\/[\w\/.-]+\.tsx/g)).map(m => m[0])
        const uniqFiles = Array.from(new Set(fileMatches)).slice(0, 8)
        
        // If property errors detected, fix them with AI first
        if (hasPropError && uniqFiles.length > 0) {
          for (const rel of uniqFiles) {
            try {
              const abs = `/workspace/${rel}`
              const buf = await sandbox.fs.downloadFile(abs)
              const src = buf.toString('utf-8')
              
              // Extract relevant errors for this file
              const fileErrors = tsText.split('\n')
                .filter((line: string) => line.includes(rel))
                .join('\n')
              
              if (fileErrors) {
                const propFixCompletion = await openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [
                    {
                      role: "system",
                      content: "You are a TypeScript expert. Fix property and interface errors. 🚫 ABSOLUTE ZERO PROPS RULE: ALL components MUST have ZERO props - NO props interface, NO props parameter, NO children prop, NOTHING. NEVER pass props to components - Use <ComponentName /> with NO attributes, NO children prop, NO props of any kind. Remove ALL props from components. Preserve all existing code structure and functionality. Return ONLY the corrected code, no explanations, no markdown fences."
                    },
                    {
                      role: "user",
                      content: `Fix these TypeScript errors:\n\n${fileErrors}\n\nFile: ${rel}\n\nCurrent code:\n${src}`
                    }
                  ],
                  temperature: 0.3,
                  max_tokens: 8000
                })
                
                const fixedCode = propFixCompletion.choices[0]?.message?.content || ''
                const cleaned = fixedCode.replace(/```tsx\n?/g, '').replace(/```typescript\n?/g, '').replace(/```\n?/g, '').trim()
                
                // Validate fixed code
                if (cleaned.length > 100 && cleaned.length < src.length * 3 && (
                  cleaned.includes('export') || cleaned.includes('import') || cleaned.includes('function') || cleaned.includes('const')
                )) {
                  await sandbox.fs.uploadFile(Buffer.from(cleaned), abs)
                  console.log(`✅ Fixed property errors in ${rel}`)
            } else {
                  console.log(`⚠️ AI prop fix rejected for ${rel}: invalid code structure`)
                }
              }
            } catch (e) {
              console.error(`AI prop fix failed for ${rel}:`, e)
            }
          }
          // Re-run tsc to check if errors are resolved
          tsOut = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true')
          tsText = tsOut.result || tsText
        }
        
        // Detect severe JSX syntax errors
        const hasSevereJSXError = tsText.includes('JSX expressions must have one parent element') ||
                                   tsText.includes('Unexpected token') ||
                                   tsText.includes('Expected corresponding JSX closing tag') ||
                                   tsText.includes('Expected corresponding closing tag for JSX fragment') ||
                                   tsText.includes('TS1005') || // ',' expected
                                   tsText.includes('TS1136') || // Property assignment expected
                                   tsText.includes('TS1351') || // An identifier or keyword cannot immediately follow a numeric literal
                                   tsText.includes('TS1003') || // Identifier expected
                                   tsText.includes('TS1381') || // Unexpected token
                                   tsText.includes('TS1382') || // Unexpected token
                                   tsText.includes('TS17002') || // Expected corresponding JSX closing tag
                                   tsText.includes('TS2657') // JSX expressions must have one parent element
        
        // Continue with generic fixes for other error types (JSX, syntax, etc.)
        for (const rel of uniqFiles) {
          try {
            const abs = `/workspace/${rel}`
            const buf = await sandbox.fs.downloadFile(abs)
            let code = buf.toString('utf-8')
            let fixed = code
            // Remove markdown fences if any
            fixed = fixed.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
            
            // CRITICAL: Fix .ts extension for React components - rename to .tsx if needed
            if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) {
              const hasJSX = /<[A-Z][a-zA-Z0-9]*[\s\S]*?>/.test(fixed) || 
                            /return\s*\([\s\S]*?<[A-Z]/.test(fixed) ||
                            (rel.includes('/components/') && fixed.includes('export'));
              
              if (hasJSX || rel.includes('/components/')) {
                const newRel = rel.replace(/\.ts$/, '.tsx');
                const newAbs = `/workspace/${newRel}`;
                // Upload to new .tsx location
                await sandbox.fs.uploadFile(Buffer.from(fixed), newAbs);
                // Remove old .ts file
                await sandbox.process.executeCommand(`rm -f ${abs} || true`);
                console.log(`🔄 Renamed ${rel} → ${newRel} (React component must be .tsx)`);
                // Skip further processing of this file in the old location
                continue;
              }
            }
            
            // Fix severe JSX syntax errors with more aggressive fixes
            if (hasSevereJSXError) {
              // Fix unescaped angle brackets in strings (common JSON escaping issue)
              fixed = fixed.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
              
              // Fix malformed JSX attributes - remove invalid characters after numeric literals
              // Pattern: className="something 123bad" -> className="something"
              fixed = fixed.replace(/(\w+="[^"]*)\s*(\d+)([a-zA-Z_$])/g, '$1')
              
              // Fix malformed attribute syntax - ensure quotes around string values
              // Pattern: className={something invalid} -> className="something"
              fixed = fixed.replace(/(\w+)=\{([^}]*)\s*(\d+)([a-zA-Z_$])/g, '$1="$2"')
              
              // Fix malformed JSX structure - ensure return has single parent
              const returnMatch = fixed.match(/return\s*\(([\s\S]*?)\)\s*;?/m);
              if (returnMatch) {
                const returnContent = returnMatch[1];
                // Check if multiple root elements without wrapper
                const rootElements = (returnContent.match(/^[\s\n]*<[A-Za-z][^>]*>/gm) || []).length;
                if (rootElements > 1 && !returnContent.trim().startsWith('<')) {
                  fixed = fixed.replace(/return\s*\(([\s\S]*?)\)\s*;?/m, `return (\n  <div>\n$1\n  </div>\n)`);
                }
                // Also check for JSX expressions without parent
                if (tsText.includes('JSX expressions must have one parent element')) {
                  const lines = returnContent.split('\n');
                  let needsWrapper = false;
                  let openTags = 0;
                  for (const line of lines) {
                    const open = (line.match(/<[A-Za-z][^>]*>/g) || []).length;
                    const close = (line.match(/<\/[A-Za-z][^>]*>/g) || []).length;
                    openTags += open - close;
                    if (openTags === 0 && line.trim() && !line.trim().startsWith('//') && line.includes('<')) {
                      needsWrapper = true;
                    }
                  }
                  if (needsWrapper && !returnContent.trim().startsWith('<')) {
                    fixed = fixed.replace(/return\s*\(([\s\S]*?)\)\s*;?/m, `return (\n  <div>\n$1\n  </div>\n)`);
                  }
                }
              }
              
              // Fix unclosed tags by counting and closing them
              const tagPairs = [
                ['section', '</section>'],
                ['div', '</div>'],
                ['header', '</header>'],
                ['footer', '</footer>'],
                ['main', '</main>'],
                ['nav', '</nav>'],
                ['article', '</article>'],
                ['aside', '</aside>']
              ];
              
              for (const [tag, closing] of tagPairs) {
                const openMatches = fixed.match(new RegExp(`<${tag}(\\s|>)`, 'g')) || [];
                const closeMatches = fixed.match(new RegExp(`</${tag}>`, 'g')) || [];
                if (openMatches.length > closeMatches.length) {
                  const missing = openMatches.length - closeMatches.length;
                  // Try to add closing tags before the return's closing parenthesis
                  fixed = fixed.replace(/return\s*\(([\s\S]*?)(\)\s*;?)/m, (m, inner, closingParen) => {
                    return `return (\n${inner}\n${closing.repeat(missing)}\n${closingParen}`;
                  });
                }
              }
              
              // Fix malformed attribute assignments - only fix obvious syntax errors
              // Pattern: className=something 123bad -> className="something"
              // Only fix if there's a numeric literal followed by an identifier (invalid syntax)
              fixed = fixed.replace(/(\w+)=([^"'\s{>]*)\s*(\d+)([a-zA-Z_$])/g, (m, attr, val, num, id) => {
                // This is invalid: className="text 123bad" or className={text 123bad}
                // Remove the invalid part
                return `${attr}="${val}"`;
              });
            }
            
            // Fix invalid/missing Lucide icon imports (has no exported member 'IconName' or Cannot find name)
            // Check for lucide-react errors (with or without quotes)
            const hasLucideError = tsText.includes('has no exported member') && 
                                  (tsText.includes('lucide-react') || tsText.includes('"lucide-react"') || tsText.includes("'lucide-react'"))
            const hasCannotFindName = tsText.includes('Cannot find name') && tsText.includes('TS2304')
            
            const hasDidYouMean = tsText.includes('Did you mean') && (tsText.includes('lucide-react') || tsText.includes('TS2724'))
            
            if (hasLucideError || hasCannotFindName || hasDidYouMean) {
              // Extract invalid icon names from error messages
              const invalidIcons = new Set<string>()
              let iconMappings: Record<string, string> = {}
              
              // Pattern 1: Extract "Did you mean" suggestions first (TS2724 format)
              // Format: "has no exported member 'Lifebuoy'. Did you mean 'LifeBuoy'?"
              const didYouMeanMatches = tsText.match(/has no exported member\s+['"]([A-Z][a-zA-Z0-9]*)['"].*?Did you mean\s+['"]([A-Z][a-zA-Z0-9]*)['"]/g) || []
              for (const match of didYouMeanMatches) {
                const iconMatch = match.match(/has no exported member\s+['"]([A-Z][a-zA-Z0-9]*)['"]/)
                const suggestedMatch = match.match(/Did you mean\s+['"]([A-Z][a-zA-Z0-9]*)['"]/)
                const iconName = iconMatch?.[1]
                const suggestedName = suggestedMatch?.[1]
                if (iconName && suggestedName && /^[A-Z][a-zA-Z0-9]*$/.test(iconName) && /^[A-Z][a-zA-Z0-9]*$/.test(suggestedName)) {
                  invalidIcons.add(iconName)
                  iconMappings[iconName] = suggestedName
                  console.log(`🔧 Found TypeScript suggestion: ${iconName} -> ${suggestedName}`)
                }
              }
              
              // Also use the validation utility to find closest matches for invalid icons
              try {
                const { findClosestLucideIcon } = await import('@/lib/lucide-icons')
                for (const invalidIcon of Array.from(invalidIcons)) {
                  if (!iconMappings[invalidIcon]) {
                    const closest = findClosestLucideIcon(invalidIcon)
                    if (closest) {
                      iconMappings[invalidIcon] = closest
                      console.log(`🔧 Found closest match: ${invalidIcon} -> ${closest}`)
                    }
                  }
                }
              } catch (err) {
                console.warn('Failed to load lucide-icons utility:', err)
              }
              
              // Pattern 2: "Module 'lucide-react' has no exported member 'MusicNote'"
              const exportMatches = tsText.match(/has no exported member\s+['"]([A-Z][a-zA-Z0-9]*)['"]/g) || []
              for (const match of exportMatches) {
                const iconName = match.match(/['"]([A-Z][a-zA-Z0-9]*)['"]/)?.[1]
                if (iconName && /^[A-Z][a-zA-Z0-9]*$/.test(iconName)) {
                  // If we already detected lucide-react error, or check error context
                  if (hasLucideError || hasDidYouMean) {
                    invalidIcons.add(iconName)
            } else {
                    // Check if it's from lucide-react (look for lucide-react in the error context)
                    const errorContext = tsText.substring(Math.max(0, tsText.indexOf(match) - 200), tsText.indexOf(match) + 100)
                    if (errorContext.includes('lucide-react') || errorContext.includes('"lucide-react"')) {
                      invalidIcons.add(iconName)
                    }
                  }
                }
              }
              
              // Pattern 2: "Cannot find name 'IconName'" (if it's used but not imported)
              if (tsText.includes('Cannot find name')) {
                const nameMatches = tsText.match(/Cannot find name\s+['"]([A-Z][a-zA-Z0-9]*)['"]/g) || []
                for (const match of nameMatches) {
                  const iconName = match.match(/['"]([A-Z][a-zA-Z0-9]*)['"]/)?.[1]
                  if (iconName && /^[A-Z][a-zA-Z0-9]*$/.test(iconName)) {
                    // Check if it's actually used in the code
                    if (fixed.includes(`<${iconName}`) || fixed.includes(`{${iconName}`) || fixed.includes(`{${iconName} `)) {
                      invalidIcons.add(iconName)
                    }
                  }
                }
              }
              
              // Remove invalid icons from imports and replace usage with valid alternatives
              if (invalidIcons.size > 0) {
                console.log(`⚠️ Invalid Lucide icons detected: ${Array.from(invalidIcons).join(', ')}`)
                
                // Common Lucide icon name mappings (invalid -> valid)
                // Also includes case-sensitivity fixes (Lifebuoy -> LifeBuoy)
                // Merge with any "Did you mean" suggestions we extracted above
                const defaultMappings: Record<string, string> = {
                  'MusicNote': 'Music',
                  'MusicNote2': 'Music',
                  'MusicNote4': 'Music',
                  'MusicNoteOff': 'Music',
                  'MusicNotePlus': 'Music',
                  'Lifebuoy': 'LifeBuoy', // Case-sensitivity fix
                  'SwapHorizontal': 'ArrowLeftRight',
                  'SwapVertical': 'ArrowUpDown',
                  'Swap': 'Shuffle',
                  // Brand/Social icons that don't exist in Lucide
                  'Discord': 'MessageCircle',
                  'Slack': 'MessageCircle',
                  'Telegram': 'MessageCircle',
                  'Whatsapp': 'MessageCircle',
                  'WhatsApp': 'MessageCircle',
                  'TikTok': 'Video',
                  'Tiktok': 'Video',
                  'Snapchat': 'Camera',
                  'Reddit': 'MessageCircle',
                  'Pinterest': 'Image',
                  'Twitch': 'Video',
                }
                
                // Try to find closest matches for any remaining invalid icons
                try {
                  const { findClosestLucideIcon } = await import('@/lib/lucide-icons')
                  for (const invalidIcon of Array.from(invalidIcons)) {
                    if (!iconMappings[invalidIcon] && !defaultMappings[invalidIcon]) {
                      const closest = findClosestLucideIcon(invalidIcon)
                      if (closest) {
                        defaultMappings[invalidIcon] = closest
                        console.log(`🔧 Auto-mapped invalid icon: ${invalidIcon} -> ${closest}`)
                      }
                    }
                  }
                } catch (err) {
                  console.warn('Failed to load lucide-icons utility:', err)
                }
                
                // Merge defaults with extracted suggestions (suggestions take priority)
                iconMappings = { ...defaultMappings, ...iconMappings }
                
                // Remove invalid icons from import
                const lucideImportMatch = fixed.match(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/)
                if (lucideImportMatch) {
                  const existingIcons = lucideImportMatch[1].split(',').map(i => i.trim()).filter(Boolean)
                  const validIcons = existingIcons.filter(icon => !invalidIcons.has(icon))
                  
                  // Replace invalid icons in usage with mapped alternatives
                  for (const invalidIcon of Array.from(invalidIcons)) {
                    // Use mapping, or findClosestLucideIcon, or smart fallback
                    let replacement = iconMappings[invalidIcon];
                    if (!replacement) {
                      // Try to find closest match
                      try {
                        const { findClosestLucideIcon } = await import('@/lib/lucide-icons');
                        const closest = findClosestLucideIcon(invalidIcon);
                        if (closest) {
                          replacement = closest;
                        }
                      } catch {}
                    }
                    // Smart fallback based on icon name
                    if (!replacement) {
                      const lowerIcon = invalidIcon.toLowerCase();
                      if (lowerIcon.includes('discord') || lowerIcon.includes('slack') || lowerIcon.includes('message')) {
                        replacement = 'MessageCircle';
                      } else if (lowerIcon.includes('social') || lowerIcon.includes('share')) {
                        replacement = 'Share';
                      } else if (lowerIcon.includes('video') || lowerIcon.includes('play') || lowerIcon.includes('tiktok') || lowerIcon.includes('twitch')) {
                        replacement = 'Video';
                      } else if (lowerIcon.includes('camera') || lowerIcon.includes('snap')) {
                        replacement = 'Camera';
                      } else if (lowerIcon.includes('image') || lowerIcon.includes('pinterest')) {
                        replacement = 'Image';
                      } else {
                        replacement = 'MessageCircle'; // Safe default for brand icons
                      }
                    }
                    // Replace in JSX: <Discord /> -> <MessageCircle />
                    fixed = fixed.replace(new RegExp(`<${invalidIcon}\\s`, 'g'), `<${replacement} `);
                    fixed = fixed.replace(new RegExp(`<${invalidIcon}/>`, 'g'), `<${replacement} />`);
                    fixed = fixed.replace(new RegExp(`<${invalidIcon}>`, 'g'), `<${replacement}>`);
                    // Replace in usage: {Discord} -> {MessageCircle}
                    fixed = fixed.replace(new RegExp(`{${invalidIcon}}`, 'g'), `{${replacement}}`);
                    // Add replacement to imports if not already there
                    if (!validIcons.includes(replacement)) {
                      validIcons.push(replacement)
                    }
                  }
                  
                  // Update import statement
                  if (validIcons.length > 0) {
                    const allIcons = Array.from(new Set(validIcons)).sort()
                    fixed = fixed.replace(
                      /import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/,
                      `import { ${allIcons.join(', ')} } from 'lucide-react'`
                    )
                    console.log(`🔧 Removed invalid Lucide icons: ${Array.from(invalidIcons).join(', ')} and replaced with valid alternatives`)
                  } else {
                    // Remove import entirely if no valid icons remain
                    fixed = fixed.replace(/import\s+{[^}]+}\s+from\s+['"]lucide-react['"];?\n?/g, '')
                    console.log(`🔧 Removed Lucide import (no valid icons)`)
                  }
                }
              }
            }
            
            // Fix missing Lucide icon imports (Cannot find name 'IconName' - for valid icons)
            if (tsText.includes('Cannot find name') && tsText.includes('TS2304')) {
              // Extract missing icon names from error messages
              const missingIcons = new Set<string>()
              const errorMatches = tsText.match(/Cannot find name '([A-Z][a-zA-Z0-9]*)'/g) || []
              for (const match of errorMatches) {
                const iconName = match.match(/'([A-Z][a-zA-Z0-9]*)'/)?.[1]
                if (iconName && /^[A-Z][a-zA-Z0-9]*$/.test(iconName)) {
                  // Check if it's actually used in the code (PascalCase suggests Lucide icon)
                  if (fixed.includes(`<${iconName}`) || fixed.includes(`{${iconName}`) || fixed.includes(`{${iconName} `)) {
                    missingIcons.add(iconName)
                  }
                }
              }
              
              if (missingIcons.size > 0) {
                // Find existing lucide-react import
                const lucideImportMatch = fixed.match(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/)
                if (lucideImportMatch) {
                  // Add missing icons to existing import
                  const existingIcons = lucideImportMatch[1].split(',').map(i => i.trim()).filter(Boolean)
                  const missingIconsArray = Array.from(missingIcons)
                  const combined = existingIcons.concat(missingIconsArray)
                  const allIcons = Array.from(new Set(combined)).sort()
                  fixed = fixed.replace(
                    /import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/,
                    `import { ${allIcons.join(', ')} } from 'lucide-react'`
                  )
                  console.log(`Added missing Lucide icons: ${Array.from(missingIcons).join(', ')} to ${rel}`)
                } else if (fixed.includes('lucide-react') || missingIcons.size > 0) {
                  // Add new import if file uses icons but doesn't have import
                  const lines = fixed.split('\n')
                  let insertIndex = 0
                  // Find first import line or after React import
                  for (let i = 0; i < lines.length; i++) {
                    if (/^import\s+/.test(lines[i].trim())) {
                      insertIndex = i + 1
                    }
                  }
                  lines.splice(insertIndex, 0, `import { ${Array.from(missingIcons).join(', ')} } from 'lucide-react'`)
                  fixed = lines.join('\n')
                  console.log(`Added Lucide import with icons: ${Array.from(missingIcons).join(', ')} to ${rel}`)
                }
              }
            }
            
            // Fix duplicate identifier errors (duplicate imports)
            if (tsText.includes('Duplicate identifier')) {
              // Find all import statements
              const importLines = fixed.split('\n').filter(line => /^import\s+/.test(line.trim()));
              const seenImports = new Set<string>();
              const uniqueImports: string[] = [];
              
              for (const line of importLines) {
                const stripped = line.trim();
                if (!seenImports.has(stripped)) {
                  seenImports.add(stripped);
                  uniqueImports.push(line);
                }
              }
              
              // Remove all imports and re-add unique ones
              if (uniqueImports.length !== importLines.length) {
                const lines = fixed.split('\n');
                let firstImportIndex = -1;
                let lastImportIndex = -1;
                
                for (let i = 0; i < lines.length; i++) {
                  if (/^import\s+/.test(lines[i].trim())) {
                    if (firstImportIndex === -1) firstImportIndex = i;
                    lastImportIndex = i;
                  }
                }
                
                if (firstImportIndex !== -1 && lastImportIndex !== -1) {
                  fixed = [
                    ...lines.slice(0, firstImportIndex),
                    ...uniqueImports,
                    ...lines.slice(lastImportIndex + 1)
                  ].join('\n');
                  console.log(`Removed ${importLines.length - uniqueImports.length} duplicate imports from ${rel}`);
                }
              }
            }
            
            // Fix "Type is not assignable to IntrinsicAttributes" - remove props from components with zero props
            if (tsText.includes('is not assignable to type \'IntrinsicAttributes\'')) {
              // List of components that have ZERO props (from our template)
              const zeroPropsComponents = ['Header', 'Hero', 'Footer', 'FeatureCard', 'StatCard', 'TestimonialCard', 'PricingCard', 'CTA', 'CTACard', 'FAQ', 'BlogCard', 'ProductCard', 'TeamCard', 'LogoCloud', 'ContactForm', 'NewsletterForm', 'Steps', 'Gallery', 'Timeline', 'Section', 'HeaderSimple', 'HeroCentered', 'HeroSplit', 'TokenBalance', 'SwapInterface', 'StakingCard', 'LiquidityPoolTable', 'LendingInterface', 'WalletConnect'];
              
              for (const compName of zeroPropsComponents) {
                // Match component usage with props: <ComponentName prop="value" ... />
                const propPattern = new RegExp(`<${compName}\\s+[^>]*>`, 'g');
                fixed = fixed.replace(propPattern, `<${compName}>`);
                // Also match self-closing: <ComponentName prop="value" />
                const selfClosingPattern = new RegExp(`<${compName}\\s+[^>]*/>`, 'g');
                fixed = fixed.replace(selfClosingPattern, `<${compName} />`);
              }
              console.log(`Removed props from zero-props components to fix IntrinsicAttributes error in ${rel}`);
            }
            
            // Ensure single root wrapper in return (only if multiple root elements detected)
            fixed = fixed.replace(/return\s*\(([\s\S]*?)\);?/m, (m, inner) => {
              const trimmed = String(inner).trim()
              // Skip if already has single root or is React fragment
              if (/^<([A-Za-z]|>|React\.)/.test(trimmed) && (/^<[A-Za-z][\s\S]*<\/[A-Za-z]>/.test(trimmed) || /^<>[\s\S]*<\/>$/.test(trimmed))) return m
              // Only wrap if truly multiple roots or invalid structure
              const rootMatches = trimmed.match(/^</g)
              if (!rootMatches || rootMatches.length <= 1) return m
              return `return (\n  <div>\n${inner}\n  </div>\n)`
            })
            // Close common tags if unbalanced
            const common = ['div','section','main','header','footer','span']
            for (const tag of common) {
              const open = (fixed.match(new RegExp(`<${tag}(\s|>)`, 'g'))||[]).length
              const close = (fixed.match(new RegExp(`</${tag}>`, 'g'))||[]).length
              if (open > close) fixed += `\n</${tag}>`.repeat(open - close)
            }
            // Strip invalid high unicode/control chars
            fixed = fixed.replace(/[\u0000-\u001F\u007F]/g, '')
            if (fixed !== code) {
              await sandbox.fs.uploadFile(Buffer.from(fixed), abs)
              console.log('Applied auto-fix to', rel)
            }
          } catch (e) {
            console.error('Auto-fix failed for', rel, e)
          }
        }
        // If still failing after auto fixes, try focused AI fix on the first offending file
        if (uniqFiles.length) {
          try {
            const rel = uniqFiles[0]
            const abs = `/workspace/${rel}`
            const buf = await sandbox.fs.downloadFile(abs)
            const src = buf.toString('utf-8')
            const aiFix = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: `Fix JSX/TypeScript syntax errors. Critical rules:
- JSX expressions MUST have one parent element (wrap multiple roots in <div>)
- All JSX tags MUST be properly closed
- Attribute values MUST be quoted strings or JSX expressions: className="value" or className={value}
- Never use unquoted attribute values with spaces or special chars
- Ensure all opening tags have matching closing tags
- Remove any invalid characters after numeric literals in attributes
- **ZERO PROPS RULE**: Components Header, Hero, Footer, FeatureCard, StatCard, TestimonialCard, PricingCard, CTA, CTACard, FAQ, BlogCard, ProductCard, TeamCard, LogoCloud, ContactForm, NewsletterForm, Steps, Gallery, Timeline, Section, HeaderSimple, HeroCentered, HeroSplit have ZERO props - use <ComponentName /> with NO attributes
- If you see "Type is not assignable to IntrinsicAttributes", remove ALL props from that component
Return ONLY the corrected code, no markdown fences, no explanations.` },
                { role: 'user', content: `TypeScript Errors:\n${tsText.slice(0,1200)}\n\nFile ${rel}:\n\n${src}` }
              ],
              temperature: 0.1,
              max_tokens: 6000
            })
            const fixed = (aiFix.choices[0]?.message?.content || '').replace(/```[a-zA-Z]*\n?/g,'').replace(/```/g,'').trim()
            // Validate the fixed code looks reasonable before applying
            if (fixed && fixed.length > 50 && fixed.length < src.length * 3 && (
              fixed.includes('export') || fixed.includes('import') || fixed.includes('function') || fixed.includes('const')
            )) {
              await sandbox.fs.uploadFile(Buffer.from(fixed), abs)
              console.log('Applied AI fix to', rel)
                } else {
              console.log('⚠️ AI fix rejected: invalid code structure')
            }
          } catch (e) {
            console.error('AI fix failed:', e)
          }
        }
        // Next loop iteration will retry build
      }
      if (!buildOk) throw new Error('Build failed after auto-repair attempts')

      // Collect all built files from dist folder
      console.log('📦 Collecting built files...');
      const buildFiles = await handler.getBuildFiles(sandbox);

      // Create or update project in database first to get projectId
      if (existingProjectId && typeof existingProjectId === 'string') {
        // Update existing project
        projectId = existingProjectId;
        await updateProject(projectId, {
          sandbox_id: sandboxId,
          status: 'generating', // Temporary status while building
          last_generated_at: new Date().toISOString()
        });
      } else {
        // Create new project
        const project = await createProject(
          userId,
          `Project ${Date.now()}`, // Generate a default name
          prompt,
          'AI generated website'
        );
        projectId = project.id;
        
        await updateProject(projectId, {
          sandbox_id: sandboxId,
          status: 'generating', // Temporary status while building
          last_generated_at: new Date().toISOString()
        });
      }

      // Upload build to Supabase storage
      addStatus(requestId, 'upload', 'Uploading build to storage...', 96);
      console.log('📤 Uploading build to Supabase storage...');
      const { uploadBuild } = await import('@/lib/storage');
      const uploadResult = await uploadBuild(userId, projectId, buildFiles);

      console.log('✅ Build uploaded successfully');
      addStatus(requestId, 'upload', 'Build uploaded successfully', 98);

      // Add cache-busting parameter to ensure fresh loads
      const cacheBustUrl = `${uploadResult.url}?t=${Date.now()}`;

      // Update project with final URL and status
      await updateProject(projectId, {
        preview_url: cacheBustUrl,
        status: 'active'
      });

      // Save project files to database with build versioning (if available)
      if (projectId) {
        const { createBuild, finalizeBuild, saveProjectFilesToBuild, updateBuild, getProjectById } = await import('@/lib/db')
        let buildRecord: any = null
        try {
          const storagePath = `${userId}/${projectId}`
          buildRecord = await createBuild(projectId, userId, { storage_path: storagePath, build_hash: uploadResult.buildHash })
        } catch {}
        try {
          await saveProjectFilesToBuild(projectId, buildRecord?.id ?? null, allFiles)
          // Optional GitHub commit + tag
          try {
            const projectRow = await getProjectById(projectId)
            const repoUrl = projectRow?.github_repo_url as string | null
            if (repoUrl && process.env.GITHUB_TOKEN) {
              const { commitFilesToRepo, createTag } = await import('@/lib/github')
              const commit = await commitFilesToRepo(repoUrl, allFiles, `build v${(buildRecord?.version ?? '')}`)
              const tagName = `v${buildRecord?.version}`
              await createTag(repoUrl, commit.commitSha, tagName)
              if (buildRecord?.id) {
                await updateBuild(buildRecord.id, { git_repo_url: repoUrl, git_commit_sha: commit.commitSha, git_tag: tagName })
              }
            }
          } catch (ghErr) {
            console.error('GitHub integration failed:', ghErr)
          }
          // Ensure description.md exists and is up-to-date
          try {
            const componentFiles = allFiles.filter(f => 
              f.path.startsWith('src/components/') && (f.path.endsWith('.tsx') || f.path.endsWith('.ts'))
            );
            const componentNames = componentFiles.map(f => {
              const name = f.path.split('/').pop()?.replace(/\.(tsx|ts)$/, '') || '';
              return name;
            }).filter(Boolean).sort();
            
            // Try to find existing description.md or extract from AI-generated content
            let existingDescription = '';
            const descriptionFile = allFiles.find(f => f.path === 'description.md');
            if (descriptionFile) {
              existingDescription = descriptionFile.content;
            } else {
              // Extract description from user prompt if available
              existingDescription = `Generated from: "${prompt}"`;
            }
            
            const descriptionContent = `# Project Description

## Last Updated
${new Date().toISOString()}

## Project Overview
${existingDescription}

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

            // Add or update description.md in allFiles
            const descriptionIndex = allFiles.findIndex(f => f.path === 'description.md');
            if (descriptionIndex >= 0) {
              allFiles[descriptionIndex].content = descriptionContent;
            } else {
              allFiles.push({
                path: 'description.md',
                content: descriptionContent
              });
            }
            
            console.log('✅ Generated/updated description.md');
          } catch (descErr) {
            console.error('Failed to generate description.md:', descErr);
          }

          // Index files into vector DB for semantic amend
          try {
            const { embedTexts, codeAwareChunks } = await import('@/lib/embeddings')
            const { saveFileChunks } = await import('@/lib/db')
            const allChunks: Array<{ file_path: string; chunk_index: number; content: string }> = []
            for (const f of allFiles) {
              const parts = codeAwareChunks(f.path, f.content)
              parts.forEach((p, i) => allChunks.push({ file_path: f.path, chunk_index: i, content: p }))
            }
            
            // Validate chunk sizes (should all be < 2000 chars after fix)
            const oversizedChunks = allChunks.filter(c => c.content.length > 2000);
            if (oversizedChunks.length > 0) {
              console.warn(`⚠️ Found ${oversizedChunks.length} oversized chunk(s) during generation:`, oversizedChunks.map(c => `${c.file_path}[${c.chunk_index}]: ${c.content.length} chars`));
            }
            
            const embeddings = await embedTexts(allChunks.map(c => c.content))
            const chunkRows = allChunks.map((c, idx) => ({ file_path: c.file_path, chunk_index: c.chunk_index, content: c.content, embedding: embeddings[idx] }))
            await saveFileChunks(projectId, buildRecord?.id ?? null, chunkRows)
          } catch (embErr) {
            console.error('Embedding index failed:', embErr)
          }

          await finalizeBuild(buildRecord?.id ?? null, 'success')
          await updateProject(projectId, { build_version: buildRecord?.version ?? undefined })
        } catch (e) {
          await finalizeBuild(buildRecord?.id ?? null, 'failed')
          // Also save without build as fallback
          await saveProjectFiles(projectId, allFiles)
        }
      }

      // Increment user usage
      await incrementUsage(userId, tokensUsed, !existingProjectId);

      // Log generation for analytics
      const duration = Date.now() - startTime;
      const cost = Math.round((tokensUsed / 1000000) * 0.60 * 100); // GPT-4o-mini cost in cents
      await logGeneration(
        userId,
        projectId,
        prompt,
        tokensUsed,
        cost,
        duration,
        'success'
      );

      addStatus(requestId, 'complete', 'Project generation complete!', 100);
      
      // Return requestId so frontend can poll for status
      return NextResponse.json({
        success: true,
        requestId: requestId, // Include requestId for status polling
        projectId: projectId,
        sandboxId: sandboxId,
        url: cacheBustUrl,
        files: allFiles,
        generationsRemaining: limits.generationsRemaining - 1,
        message: `Vite project built and deployed with ${allFiles.length} files`,
        tokensUsed,
        buildHash: uploadResult.buildHash
      });

    } catch (execError) {
      console.error('[generate] Execution error:', execError);
      addStatus(requestId, 'error', `Generation failed: ${execError instanceof Error ? execError.message : 'Unknown error'}`, 0);
      return NextResponse.json({
        success: false,
        requestId: requestId, // Include requestId even on error
        error: 'Failed to set up Vite project in sandbox',
        details: execError instanceof Error ? execError.message : 'Unknown error'
      }, { status: 500 });
    } finally {
      // Cleanup status after 30 minutes (keep it available longer for debugging)
      setTimeout(() => clearStatus(requestId), 30 * 60 * 1000);
    }

  } catch (error) {
    console.error('❌ API error in /api/generate:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Log failed generation if we have a user session
    try {
      const cookieStore = await cookies();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID 
          ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
          : 'https://placeholder.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC || 'placeholder-key',
        {
          cookies: {
            getAll() { return cookieStore.getAll() },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            },
          },
        }
      );
      
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const duration = Date.now() - startTime;
        const cost = Math.round((tokensUsed / 1000000) * 0.60 * 100);
        await logGeneration(
          session.user.id,
          projectId,
          '', // prompt might not be available
          tokensUsed,
          cost,
          duration,
          'error',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to generate and execute code', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}