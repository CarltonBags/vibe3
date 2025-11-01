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


const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_KEY
});

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
    
    const { prompt, projectId: existingProjectId, template = 'vite-react', images = [], imageNames = [] } = requestBody;

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
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
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const userId = userData.user.id;
    const requestId = Math.random().toString(36).slice(2, 8)
    console.log(`[generate:${requestId}] start user=${userId} template=${template} promptLen=${(prompt||'').length}`)

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
      systemPromptPath: 'app/api/generate/systemPrompt-vite.ts',
      buildCommand: 'npm run build',
      devCommand: 'npm run dev',
      buildDir: 'dist'
    };
    const planningTemplateFiles = getTemplateFiles(planningTemplate);
    const planningPackageJson = planningTemplateFiles['package.json'] || '{}';

    // Phase 1: Create a plan with gpt-4o-mini
    const planSystem = 'You are a project planner for a web app generator. Return ONLY valid JSON with keys app_summary, tech_stack, folders, files (path+purpose), components (name+props+description), build_plan (ordered).';
    const planUserPayload = {
      prompt: prompt,
      template: planningTemplate.id,
      template_package_json: JSON.parse(planningPackageJson)
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

    // Helper: robust JSON parse for files payload
    const parseFilesJson = (raw: string) => {
      let filesPayload: { files: Array<{ path: string; content: string }>, summary?: string } | null = null;
      try {
        let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*"files"[\s\S]*\}/);
        if (match) cleaned = match[0];
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
        filesPayload = JSON.parse(cleaned);
          } catch (e) {
        filesPayload = null;
      }
      return filesPayload;
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
      const singlePrompt = `Regenerate ONE file for this project. Output ONLY JSON {"files":[{"path":"${targetPath}","content":"..."}]}. Ensure TS/JSX correctness, no markdown fences, and no nested JSON. Reason: ${reason}.\n\nPROJECT PLAN:\n${planRaw}\n\nALREADY GENERATED (paths and sizes):\n${JSON.stringify(already)}`;
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
        const payload = parseFilesJson(out.text || '');
        if (payload && payload.files && payload.files[0] && payload.files[0].path === targetPath) {
          const file = payload.files[0];
        return {
            path: file.path,
            content: (file.content || '')
              .replace(/\\n/g, '\n')
              .replace(/\\t/g, '\t')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\')
          };
        }
      } catch {}
      return null;
    };

    // Batch generation setup
    const planned = (() => {
      try { return Array.isArray(planRaw ? JSON.parse(planRaw).files : []) ? JSON.parse(planRaw).files : []; } catch { return []; }
    })();
    const desiredPaths: string[] = planned
      .map((f: any) => (typeof f?.path === 'string' ? f.path : null))
      .filter(Boolean)
      .slice(0, 15);

    const maxFilesTotal = 15;
    const batchSize = 6;
    let collected: Array<{ path: string; content: string }> = [];
    const aiReasons: string[] = []

    // Wait for sandbox in parallel while generating files
    const sandboxResultPromise = sandboxPromise;

    let remaining = desiredPaths.length > 0 ? [...desiredPaths] : [];
    let safety = 6; // at most 6 batches
    console.log(`[generate:${requestId}] plan snippet:`, (planRaw || '').slice(0, 400))
    while (collected.length < maxFilesTotal && safety-- > 0) {
      const isFirstBatch = collected.length === 0;
      const want = remaining.length > 0 ? remaining.slice(0, batchSize) : [];
      const fileMapSummary = collected.slice(0, 50).map(f => ({ path: f.path, size: f.content.length })).slice(0, 50);
      const genPrompt = `Generate a batch of files for this project. Return ONLY JSON with {"files":[{"path":"...","content":"..."}],"summary":"..."}. Max ${Math.min(batchSize, maxFilesTotal - collected.length)} files this batch. Ensure TS+JSX correctness, matched tags, and existing imports. Avoid external placeholder images.\n\nPROJECT PLAN:\n${planRaw}\n\nALREADY GENERATED (for context):\n${JSON.stringify(fileMapSummary)}\n\nDESIRED PATHS FOR THIS BATCH (hints, optional):\n${JSON.stringify(want)}`;

      const tryModel = async (model: string) => {
        const contents: any[] = [{ text: genPrompt }];
        
        // Include images in all batches so AI can reference them
        if (images.length > 0) {
          contents.push(...images.map((imgData: string, idx: number) => ({
            inlineData: {
              data: imgData.split(',')[1], // Remove data:image/...;base64, prefix
              mimeType: imgData.split(';')[0].split(':')[1] // Extract MIME type
            }
          })));
          
          // Enhance the prompt with image context and paths
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
          
          // In Vite, public folder files are served from root, so /filename.png not /public/filename.png
          const imagePaths = imageFileNames.map((name: string) => `/${name}`).join(', ');
          
          console.log(`🎨 Image paths for AI: ${imagePaths}`);
          
          contents[0] = { 
            text: genPrompt + `\n\nUSER PROVIDED IMAGES: User has uploaded ${images.length} image(s)${imageNames.length > 0 ? `: ${imageNames.join(', ')}` : ''}. These images are saved in the public folder and will be accessible at: ${imagePaths}. IMPORTANT: Reference them in your code using these exact paths. For example: <img src="${imagePaths.split(',')[0]}" alt="Logo" />. Please incorporate these images into the generated UI. Use them as logos, backgrounds, or featured imagery as appropriate.`
          };
        }
        
        return gemini.models.generateContent({
          model,
          contents,
          config: { systemInstruction: instruction.toString(), responseMimeType: 'application/json' as any, temperature: 0.3 }
        });
      };

      let genText = '';
      try {
        const out = await tryModel('gemini-2.5-flash')
          .catch(() => tryModel('gemini-1.5-flash'))
          .catch(() => tryModel('gemini-1.5-pro'));
        genText = out.text || '';
      } catch (e: any) {
        const code = (e && e.error && e.error.code) || (e?.status) || 'unknown'
        aiReasons.push(`model_error:${String(code)}`)
        break; // stop batching on persistent failure
      }

      console.log(`[generate:${requestId}] batch desired=${want.length} collected=${collected.length}`)
      console.log(`[generate:${requestId}] batch response len=${(genText||'').length} snippet=${(genText || '').slice(0, 300)}`)
      let payload = parseFilesJson(genText);
      if (!payload || !payload.files || payload.files.length === 0) {
        aiReasons.push('parse_or_empty:batch')
        // per-batch retry with smaller subset if we had desired paths
        if (remaining.length > 0) {
          const tinyWant = remaining.slice(0, Math.max(1, Math.min(3, batchSize - 2)));
          const tinyPrompt = `Generate a tiny batch of ${tinyWant.length} file(s). Return ONLY JSON with {"files":[...]}.\nPLAN:\n${planRaw}\nWANT:\n${JSON.stringify(tinyWant)}`;
          try {
            const out2 = await gemini.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [{ text: tinyPrompt }],
              config: { systemInstruction: instruction.toString(), responseMimeType: 'application/json' as any, temperature: 0.2 }
            });
            payload = parseFilesJson(out2.text || '');
            console.log(`[generate:${requestId}] tiny retry len=${(out2.text||'').length} parsed=${payload?.files?.length||0}`)
          } catch {}
        }
        if (!payload || !payload.files || payload.files.length === 0) break;
      }

      // Unescape content and merge uniquely by path; validate each, try single-file regen once if invalid
      for (const f of payload.files) {
        if (!f?.path || typeof f.content !== 'string') continue;
        const normalizedPath = f.path;
        const content = f.content
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        let finalContent = content;
        if (!isLikelyValidFile(normalizedPath, finalContent)) {
          const retry = await regenerateSingleFile(normalizedPath, 'initial validation failed', collected.slice(0, 30).map(x => ({ path: x.path, size: x.content.length })));
          if (retry && isLikelyValidFile(retry.path, retry.content)) {
            finalContent = retry.content;
          }
        }
        const idx = collected.findIndex(x => x.path === normalizedPath);
        if (idx >= 0) collected[idx] = { path: normalizedPath, content: finalContent };
        else collected.push({ path: normalizedPath, content: finalContent });
      }

      // Update remaining if we had desired list
      if (remaining.length > 0) {
        remaining = remaining.filter(p => !collected.some(c => c.path === p));
      }

      if (collected.length >= maxFilesTotal) break;
    }

    // If nothing collected, try a minimal scaffold fallback one-shot
    if (collected.length === 0) {
      try {
        const minimalPrompt = `Return ONLY JSON with {"files":[{"path":"src/components/AppShell.tsx","content":"..."}]}. Create at least one TSX component that can be imported into src/App.tsx. No markdown fences.`
        const out = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ text: minimalPrompt }],
          config: { systemInstruction: instruction.toString(), responseMimeType: 'application/json' as any, temperature: 0.2 }
        })
        const fallbackPayload = parseFilesJson(out.text || '')
        if (fallbackPayload && fallbackPayload.files && fallbackPayload.files.length) {
          for (const f of fallbackPayload.files) {
            if (typeof f?.path === 'string' && typeof f?.content === 'string') {
              collected.push({ path: f.path, content: f.content })
            }
          }
        } else {
          aiReasons.push('fallback_minimal_empty')
        }
      } catch (e: any) {
        const code = (e && e.error && e.error.code) || (e?.status) || 'unknown'
        aiReasons.push(`fallback_error:${String(code)}`)
        console.error('[generate] Minimal scaffold fallback failed:', e)
      }
    }

    // If we have too few files, ask for an expansion batch with required structure
    if (collected.length > 0 && collected.length < 6) {
      try {
        const need = Math.min(maxFilesTotal - collected.length, 6)
        const expansionPrompt = `Expand the project. Return ONLY JSON with {"files":[...]} and NO markdown fences. Add up to ${need} files prioritizing:
1) src/pages/LandingPage.tsx (dark themed hero, features, CTA)
2) src/components/Navbar.tsx
3) src/components/Footer.tsx
4) src/components/FeatureGrid.tsx
5) src/index.css additions (Tailwind-friendly, no JSX)
6) src/lib/utils.ts
All files must be TypeScript/TSX where applicable. Ensure they integrate with src/App.tsx.`
        const out = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ text: expansionPrompt }],
          config: { systemInstruction: instruction.toString(), responseMimeType: 'application/json' as any, temperature: 0.25 }
        })
        const payload = parseFilesJson(out.text || '')
        console.log(`[generate:${requestId}] expansion response len=${(out.text||'').length} parsed=${payload?.files?.length||0}`)
        if (payload && payload.files) {
          for (const f of payload.files) {
            if (typeof f?.path === 'string' && typeof f?.content === 'string') {
              const exists = collected.findIndex(x => x.path === f.path)
              if (exists >= 0) collected[exists] = { path: f.path, content: f.content }
              else collected.push({ path: f.path, content: f.content })
            }
          }
        }
      } catch (e) {
        console.error(`[generate:${requestId}] Expansion batch failed:`, e)
      }
    }

    // Final filesData from batches (or fallback)
    let filesData: { files: Array<{ path: string; content: string }> } | null = { files: collected.slice(0, maxFilesTotal) };
    console.log(`[generate:${requestId}] collected total=${filesData.files.length} firstPaths=${filesData.files.slice(0,10).map(f=>f.path).join(', ')}`)

    // If still no files, return diagnostics to the client for visibility
    if (filesData.files.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'AI returned no files',
        reasons: aiReasons,
        planSnippet: (planRaw || '').slice(0, 400)
      }, { status: 502 })
    }
    
    // Wait for sandbox creation to proceed with rest of pipeline
    const { sandbox, sandboxId } = await sandboxResultPromise;

    // Estimate tokens used from combined text length (rough)
    tokensUsed += Math.ceil((planRaw.length + collected.reduce((a, f) => a + f.content.length, 0)) / 4);

    // Using batch-generated filesData; legacy single-shot parsing removed.
    
    // Ensure filesData is valid before proceeding
    if (!filesData || !filesData.files) {
      filesData = { files: [] }
    }

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

          // Fix 6: If there are property/interface errors, ask AI to fix them
          if (hasPropError && !needsFix) {
            try {
              const propFixCompletion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: "You are a TypeScript expert. Fix property and interface errors - remove extra properties that don't exist in types, add missing required properties, fix property name mismatches. Return ONLY the corrected code, no explanations."
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
            
            await sandbox.fs.uploadFile(Buffer.from(componentContent), `/workspace/src/components/${componentName}.tsx`);
            console.log(`Created: ${componentName}.tsx`);
          }
          
          console.log('✅ All missing components created');
        } else {
          console.log('✅ All components exist');
        }
      }
      
      
      // Build with self-healing retries for JSX/tag issues
      let buildOk = false
      for (let attempt = 0; attempt < 2; attempt++) {
        console.log(`🔨 Building project for production (attempt ${attempt + 1})...`);
        const buildResult = await sandbox.process.executeCommand('cd /workspace && npm run build');
        const output = buildResult.result || ''
        if (!output.includes('error') && !output.includes('Error')) {
          buildOk = true
          console.log('✅ Build completed successfully')
          break
        }
        console.error('Build failed:', output)
        // Run tsc to get precise TypeScript/JSX errors
        const tsOut = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true')
        const tsText = tsOut.result || ''
        console.log('tsc output snippet:', tsText.slice(0, 500))
        // Extract offending TSX files
        const fileMatches = Array.from(tsText.matchAll(/src\/[\w\/.-]+\.tsx/g)).map(m => m[0])
        const uniqFiles = Array.from(new Set(fileMatches)).slice(0, 8)
        for (const rel of uniqFiles) {
          try {
            const abs = `/workspace/${rel}`
            const buf = await sandbox.fs.downloadFile(abs)
            let code = buf.toString('utf-8')
            let fixed = code
            // Remove markdown fences if any
            fixed = fixed.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
            
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
                { role: 'system', content: 'Fix JSX/TypeScript syntax errors. Return ONLY corrected code, no fences.' },
                { role: 'user', content: `Errors:\n${tsText.slice(0,800)}\n\nFile ${rel}:\n${src}` }
              ],
              temperature: 0.2,
              max_tokens: 4000
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
      console.log('📤 Uploading build to Supabase storage...');
      const { uploadBuild } = await import('@/lib/storage');
      const uploadResult = await uploadBuild(userId, projectId, buildFiles);

      console.log('✅ Build uploaded successfully');

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
          // Index files into vector DB for semantic amend
          try {
            const { embedTexts, codeAwareChunks } = await import('@/lib/embeddings')
            const { saveFileChunks } = await import('@/lib/db')
            const allChunks: Array<{ file_path: string; chunk_index: number; content: string }> = []
            for (const f of allFiles) {
              const parts = codeAwareChunks(f.path, f.content)
              parts.forEach((p, i) => allChunks.push({ file_path: f.path, chunk_index: i, content: p }))
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

      return NextResponse.json({
        success: true,
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
      return NextResponse.json({
        success: false,
        error: 'Failed to set up Vite project in sandbox',
        details: execError instanceof Error ? execError.message : 'Unknown error'
      }, { status: 500 });
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