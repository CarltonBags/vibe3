import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
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

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_KEY });

export async function POST(req: Request) {
  const startTime = Date.now();
  let projectId: string | null = null;
  let tokensUsed = 0;

  try {
    const { prompt, projectId: existingProjectId } = await req.json();

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

    const { data: { session } } = await supabase.auth.getSession();
    console.log('Generate API: Session check:', session ? 'Authenticated' : 'Not authenticated');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    console.log('Generate API: User:', userId);

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
    const maxTokens = Math.min(userWithTier.tier.max_tokens_per_generation, 16384);

    
    // Step 1: Generate Next.js project structure using Gemini
    // Using gemini-2.5-flash for cost efficiency and excellent code generation


    const completion = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              text: `You are an ELITE Next.js developer and UI/UX designer. Your task is to generate a FUNCTIONAL, COMPLETE, PRODUCTION-READY, VISUALLY STUNNING web application.

🎯 YOUR MISSION:
Create a fully functional, interactive, BEAUTIFUL web application based on the user's requirements.

⚠️ **CRITICAL - USER REQUIREMENTS TAKE ABSOLUTE PRIORITY**:
- you MUST write a description.md file in the root of the project with a description of the application including name, content, and features.
- the application MUST compile without errors. Create every component that you import elsewhere.
- If the user provides SPECIFIC DETAILS about structure, layout, components, or features, YOU MUST FOLLOW THEM EXACTLY
- User's instructions override ALL generic guidelines below
- Only use generic structure to FILL IN gaps where the user was unspecific
- The more detailed the user's request, the more their structure must be respected
- Think: "What did the user explicitly ask for?" → Implement that FIRST and FOREMOST
- The application must be functional and complete, with all the features and components the user requested

📋 OUTPUT FORMAT - **CRITICAL**:

You MUST return a JSON object with this EXACT structure:
\`\`\`json
{
  "files": [
    {
      "path": "app/page.tsx",
      "content": "... the main page code ..."
    },
    {
      "path": "app/components/Header.tsx",
      "content": "... component code ..."
    }
  ]
}
\`\`\`

**CRITICAL**: If you import ANY component in app/page.tsx, you MUST create that component file in app/components/

Generate a complete Next.js application with multiple files for: ${prompt}

Remember: Return ONLY a JSON object with the files array. No explanations, no markdown.`
            }
          ]
        }
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    });

    let responseText = completion.response?.text() || '';
    // Gemini doesn't provide token usage in the same way, estimate based on response length
    tokensUsed = Math.ceil(responseText.length / 4); // Rough estimation
    
    // Parse JSON response
    let filesData: { files: Array<{ path: string; content: string }> };
    try {
      // Clean markdown formatting if present
      let cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      // Try to parse as JSON
      filesData = JSON.parse(cleanedResponse);
      
      if (!filesData.files || !Array.isArray(filesData.files)) {
        throw new Error('Invalid response format: missing or invalid files array');
      }

      if (filesData.files.length === 0) {
        throw new Error('Invalid response format: files array is empty');
      }

      // CRITICAL: Unescape the content field if it contains escaped newlines
      // The AI sometimes returns content as escaped strings like "...\n\n..."
      filesData.files = filesData.files.map(file => {
        let content = file.content;
        
        // Check if content itself is JSON-wrapped (nested JSON error)
        if (typeof content === 'string' && content.trim().startsWith('{') && content.includes('"files"')) {
          console.warn(`⚠️ File ${file.path} has nested JSON, attempting to extract...`);
          try {
            const nested = JSON.parse(content);
            if (nested.files && nested.files[0]) {
              content = nested.files[0].content;
              console.log(`✅ Extracted nested content for ${file.path}`);
            }
          } catch (e) {
            console.warn(`⚠️ Could not extract nested JSON for ${file.path}`);
          }
        }
        
        return {
          ...file,
          content: content
            .replace(/\\n/g, '\n')  // Unescape newlines
            .replace(/\\t/g, '\t')  // Unescape tabs
            .replace(/\\"/g, '"')   // Unescape quotes
            .replace(/\\\\/g, '\\') // Unescape backslashes (do this last!)
        };
      });

      console.log(`✅ Successfully parsed ${filesData.files.length} files from AI response`);
      
      // Validate that all imports have corresponding files BEFORE uploading
      const pageFile = filesData.files.find(f => f.path === 'app/page.tsx');
      if (pageFile) {
        console.log('🔍 Checking for component imports in page.tsx...');
        
        // More comprehensive regex to catch all import patterns
        const importMatches = pageFile.content.match(/import\s+[\w\s,{}]+\s+from\s+['"]\.\/components\/(\w+)['"]/g);
        console.log('Found import matches:', importMatches);
        
        if (importMatches && importMatches.length > 0) {
          const importedComponents = importMatches.map(match => {
            const componentMatch = match.match(/import\s+[\w\s,{}]+\s+from\s+['"]\.\/components\/(\w+)['"]/);
            return componentMatch ? componentMatch[1] : null;
          }).filter((comp): comp is string => comp !== null);
          
          console.log('Imported components:', importedComponents);
          
          const existingComponents = filesData.files
            .filter(f => f.path.startsWith('app/components/'))
            .map(f => f.path.replace('app/components/', '').replace('.tsx', ''));
          
          console.log('Existing components:', existingComponents);
          
          const missingComponents = importedComponents.filter(comp => !existingComponents.includes(comp));
          
          console.log('Missing components:', missingComponents);
          
          if (missingComponents.length > 0) {
            console.warn(`⚠️ Missing components detected: ${missingComponents.join(', ')}`);
            console.log('🔧 Creating missing components...');
            
            // Create missing components
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
              
              filesData.files.push({
                path: `app/components/${componentName}.tsx`,
                content: componentContent
              });
            }
            
            console.log(`✅ Created ${missingComponents.length} missing components`);
          } else {
            console.log('✅ All imported components exist');
          }
        } else {
          console.log('No component imports found in page.tsx');
        }
      } else {
        console.log('No page.tsx file found');
      }
      
    } catch (parseError) {
      console.error('❌ Failed to parse AI response as JSON:', parseError);
      console.log('Falling back to single file mode');
      
      // Fallback: treat entire response as single page.tsx file
      // But first try to extract code if it looks like JSON
      let fallbackContent = responseText;
      
      if (fallbackContent.trim().startsWith('{') && fallbackContent.includes('"content"')) {
        console.log('Attempting to extract code from malformed JSON...');
        const contentMatch = fallbackContent.match(/"content":\s*"((?:[^"\\]|\\[\s\S])*)"/);
        if (contentMatch) {
          fallbackContent = contentMatch[1]
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          console.log('✅ Extracted content from malformed JSON');
        }
      }
      
      filesData = {
        files: [{
          path: 'app/page.tsx',
          content: fallbackContent
        }]
      };
    }

    // Step 2: Create Daytona sandbox
    const daytona = new Daytona({ 
      apiKey: process.env.DAYTONA_KEY || '',
      apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io'
    });

    // Create sandbox with Node.js environment (auto-provisions from Docker Hub)
    // Setting public: true makes the sandbox accessible without authentication
    const sandbox = await daytona.create({
      image: 'node:20-alpine',
      public: true,
      ephemeral: true,
      envVars: {
        NODE_ENV: 'development'
      }
    });
    const sandboxId = sandbox.id;

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
      await sandbox.fs.createFolder('/workspace/app', '755');
      await sandbox.fs.createFolder('/workspace/app/components', '755');
      await sandbox.fs.createFolder('/workspace/app/types', '755');
      await sandbox.fs.createFolder('/workspace/app/utils', '755');
      
      console.log('📁 Created project folders in sandbox');
      
      // Write configuration files
      await sandbox.fs.uploadFile(Buffer.from(packageJson), '/workspace/package.json');
      await sandbox.fs.uploadFile(Buffer.from(nextConfig), '/workspace/next.config.js');
      await sandbox.fs.uploadFile(Buffer.from(tailwindConfig), '/workspace/tailwind.config.js');
      await sandbox.fs.uploadFile(Buffer.from(postcssConfig), '/workspace/postcss.config.js');
      await sandbox.fs.uploadFile(Buffer.from(tsConfig), '/workspace/tsconfig.json');
      
      // Write app files
      await sandbox.fs.uploadFile(Buffer.from(globalsCss), '/workspace/app/globals.css');
      await sandbox.fs.uploadFile(Buffer.from(layoutTsx), '/workspace/app/layout.tsx');
      
      // Upload all generated files (with validation)
      console.log(`Uploading ${filesData.files.length} generated files...`);
      for (const file of filesData.files) {
        const filePath = `/workspace/${file.path}`;
        let content = file.content;
        
        // CRITICAL: Final validation before upload - check if content is still JSON
        if (content.trim().startsWith('{') && (content.includes('"files"') || content.includes('"path"'))) {
          console.error(`❌ CRITICAL: File ${file.path} still contains JSON structure!`);
          console.log('🔧 Attempting emergency extraction...');
          
          try {
            const emergency = JSON.parse(content);
            if (emergency.files && emergency.files[0]) {
              content = emergency.files[0].content;
              console.log('✅ Emergency extraction successful');
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
              console.log('✅ Emergency regex extraction successful');
            } else {
              console.error('❌ Emergency extraction failed - uploading as-is and relying on preflight');
            }
          }
        }
        
        // Ensure all .tsx/.jsx component files have 'use client' directive
        if ((file.path.endsWith('.tsx') || file.path.endsWith('.jsx')) && 
            !content.trim().startsWith("'use client'") && 
            !content.trim().startsWith('"use client"')) {
          console.log(`🔧 Adding 'use client' to ${file.path}`);
          content = "'use client'\n\n" + content;
        }
        
        console.log(`Uploading: ${filePath}`);
        await sandbox.fs.uploadFile(Buffer.from(content), filePath);
      }

      // Install dependencies
      console.log('Installing dependencies...');
      await sandbox.process.executeCommand('cd /workspace && npm install');
      
      // ============================================================
      // PREFLIGHT TEST & AUTO-DEBUGGING
      // ============================================================
      console.log('🔍 Running preflight checks...');
      
      let hasErrors = true;
      let debugAttempts = 0;
      const MAX_DEBUG_ATTEMPTS = 3;
      
      while (hasErrors && debugAttempts < MAX_DEBUG_ATTEMPTS) {
        debugAttempts++;
        console.log(`Preflight attempt ${debugAttempts}/${MAX_DEBUG_ATTEMPTS}`);
        
        // Check for TypeScript errors
        const tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
        const tsErrors = tsCheckResult.result || '';
        
        // Check for Next.js build errors (quick check without full build)
        const lintResult = await sandbox.process.executeCommand('cd /workspace && npx next lint 2>&1 || true');
        const lintErrors = lintResult.result || '';
        
        console.log('TypeScript check:', tsErrors.substring(0, 500));
        console.log('Lint check:', lintErrors.substring(0, 500));
        
        // Check if there are critical errors
        const hasTsErrors = tsErrors.includes('error TS');
        const hasSyntaxErrors = tsErrors.includes('Syntax Error') || lintErrors.includes('Syntax Error');
        const hasMissingImports = tsErrors.includes('Cannot find module') || tsErrors.includes('Module not found');
        const hasJsonError = tsErrors.includes('"files"') || tsErrors.includes('Expected');
        
        if (!hasTsErrors && !hasSyntaxErrors && !hasMissingImports && !hasJsonError) {
          console.log('✅ Preflight checks passed!');
          hasErrors = false;
          break;
        }
        
        if (hasJsonError) {
          console.error('🚨 JSON structure detected in code file!');
        }
        
        if (debugAttempts >= MAX_DEBUG_ATTEMPTS) {
          console.warn('⚠️ Max debug attempts reached, proceeding anyway');
          break;
        }
        
        // Auto-fix common issues
        console.log(`🔧 Attempting auto-fix (attempt ${debugAttempts})...`);
        
        // Read the current page.tsx to analyze
        const pageContent = await sandbox.fs.downloadFile('/workspace/app/page.tsx');
        const pageText = pageContent.toString('utf-8');
        
        // Common fixes
        let fixedContent = pageText;
        let needsFix = false;
        
        // Fix 1: Check if content starts with JSON (invalid code) - DO THIS FIRST
        const trimmedContent = fixedContent.trim();
        if (trimmedContent.startsWith('{') && (trimmedContent.includes('"files"') || trimmedContent.includes('"path"'))) {
          console.log('🔧 Detected JSON wrapper in code, extracting actual code');
          try {
            // Try to parse as full JSON response
            const jsonMatch = JSON.parse(fixedContent);
            if (jsonMatch.files && Array.isArray(jsonMatch.files) && jsonMatch.files[0]) {
              fixedContent = jsonMatch.files[0].content;
              console.log('✅ Extracted code from JSON wrapper');
              needsFix = true;
            }
          } catch (e) {
            // If full parse fails, try regex extraction
            console.log('Could not parse as complete JSON, trying regex extraction');
            
            // Try to find "content": "..." pattern
            const contentMatch = fixedContent.match(/"content":\s*"((?:[^"\\]|\\[\s\S])*)"/);
            if (contentMatch) {
              fixedContent = contentMatch[1]
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
              console.log('✅ Extracted code using regex');
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
                console.log('✅ Extracted code using fallback regex');
                needsFix = true;
              }
            }
          }
        }
        
        // Fix 2: Ensure 'use client' directive (after extracting from JSON)
        if (!fixedContent.trim().startsWith("'use client'") && !fixedContent.trim().startsWith('"use client"')) {
          console.log('🔧 Adding "use client" directive');
          fixedContent = "'use client'\n\n" + fixedContent;
          needsFix = true;
        }
        
        if (needsFix) {
          console.log('🔧 Applying fixes to page.tsx');
          await sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/app/page.tsx');
          // Continue loop to re-check
          continue;
        } else {
          console.log('⚠️ Could not auto-fix errors, proceeding anyway');
          break;
        }
      }
      
      // Clear any existing cache and start Next.js dev server
      console.log('Starting Next.js dev server...');
      await sandbox.process.executeCommand('cd /workspace && rm -rf .next node_modules/.cache || true');
      await sandbox.process.executeCommand('cd /workspace && nohup npm run dev > /tmp/next.log 2>&1 &');
      
      // Wait for server to start and check logs
      await new Promise(resolve => setTimeout(resolve, 12000));
      
      // Prepare complete file list for GitHub-ready project (declare before auto-fix loop)
      const allFiles = [
        // Configuration files
        { path: 'package.json', content: packageJson },
        { path: 'next.config.js', content: nextConfig },
        { path: 'tailwind.config.js', content: tailwindConfig },
        { path: 'postcss.config.js', content: postcssConfig },
        { path: 'tsconfig.json', content: tsConfig },
        // App files
        { path: 'app/globals.css', content: globalsCss },
        { path: 'app/layout.tsx', content: layoutTsx },
        // Generated files
        ...filesData.files
      ];
      
      // Check if server started successfully and auto-fix errors
      let buildAttempts = 0;
      const MAX_BUILD_ATTEMPTS = 2;
      let hasCompileErrors = true;
      
      while (hasCompileErrors && buildAttempts < MAX_BUILD_ATTEMPTS) {
        buildAttempts++;
        console.log(`Build validation attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS}`);
        
        try {
          const logs = await sandbox.process.executeCommand('tail -n 100 /tmp/next.log');
          const logContent = logs.result || '';
          console.log('Next.js logs:', logContent.substring(0, 500));
          
          // Also check for errors in the process output
          const processLogs = await sandbox.process.executeCommand('ps aux | grep node');
          const processContent = processLogs.result || '';
          console.log('Process logs:', processContent.substring(0, 200));
          
          // Check for compilation errors
          const hasErrors = logContent.includes('Error:') || 
                           logContent.includes('Failed to compile') ||
                           logContent.includes('Module not found') ||
                           logContent.includes("Can't resolve") ||
                           logContent.includes('Module build failed') ||
                           logContent.includes('ERROR') ||
                           logContent.includes('error');
          
          if (!hasErrors || buildAttempts >= MAX_BUILD_ATTEMPTS) {
            hasCompileErrors = false;
            if (!hasErrors) {
              console.log('✅ Build successful!');
            } else {
              console.warn('⚠️ Build errors persist, but proceeding');
            }
            break;
          }
          
          // Extract error details
          console.error('🚨 Build errors detected, attempting auto-fix...');
          
          // Use AI to fix the errors
          const fixCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a Next.js debugging expert. Fix ONLY the specific errors shown in the build log.

**CRITICAL RULES**:
1. Read the error message carefully
2. If it's "Module not found" or "Can't resolve", the file is missing or the import path is wrong
3. For missing files: Create them with minimal valid content that matches the import
4. For wrong paths: Fix the import statement
5. Return ONLY files that need to be fixed or created
6. Keep fixes minimal - don't rewrite working code
7. **ALWAYS add 'use client' directive to component files**

**For missing components**:
- Create the component file with the exact name being imported
- Use a simple functional component structure
- Include proper TypeScript types
- Add 'use client' at the top

Return JSON:
\`\`\`json
{
  "files": [
    {
      "path": "app/components/MissingFile.tsx",
      "content": "'use client'\\n\\ninterface Props {\\n  // Add props as needed\\n}\\n\\nexport default function MissingFile({}: Props) {\\n  return (\\n    <div className=\\"p-4\\">\\n      <h2>Component Placeholder</h2>\\n    </div>\\n  );\\n}"
    }
  ]
}
\`\`\``
              },
              {
                role: "user",
                content: `Build errors:\n\`\`\`\n${logContent.substring(0, 2000)}\n\`\`\`\n\nCurrent files in project:\n${allFiles.map(f => f.path).join('\n')}\n\nFix ONLY these specific errors. Return JSON with files array.`
              }
            ],
            temperature: 0.3,
            max_tokens: 4096,
          });
          
          const fixResponse = fixCompletion.choices[0]?.message?.content || '';
          tokensUsed += fixCompletion.usage?.total_tokens || 0;
          
          let fixData: { files: Array<{ path: string; content: string }> };
          try {
            const cleaned = fixResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            fixData = JSON.parse(cleaned);
            
            if (fixData.files && fixData.files.length > 0) {
              console.log(`🔧 Applying ${fixData.files.length} fixes...`);
              
              for (const file of fixData.files) {
                let content = file.content;
                
                // Ensure 'use client' for components
                if ((file.path.endsWith('.tsx') || file.path.endsWith('.jsx')) && 
                    !content.trim().startsWith("'use client'") && 
                    !content.trim().startsWith('"use client"')) {
                  content = "'use client'\n\n" + content;
                }
                
                await sandbox.fs.uploadFile(Buffer.from(content), `/workspace/${file.path}`);
                console.log(`Fixed: ${file.path}`);
              }
              
              // Restart server
              await sandbox.process.executeCommand('cd /workspace && pkill -9 node || true');
              await new Promise(resolve => setTimeout(resolve, 2000));
              await sandbox.process.executeCommand('cd /workspace && nohup npm run dev > /tmp/next.log 2>&1 &');
              await new Promise(resolve => setTimeout(resolve, 12000));
              
              // Update allFiles with fixes
              for (const fixedFile of fixData.files) {
                const existingIndex = allFiles.findIndex(f => f.path === fixedFile.path);
                if (existingIndex >= 0) {
                  allFiles[existingIndex].content = fixedFile.content;
                } else {
                  allFiles.push(fixedFile);
                }
              }
            }
          } catch (parseError) {
            console.error('Could not parse AI fix response:', parseError);
            break;
          }
        } catch (logError) {
          console.warn('Could not read logs:', logError);
          break;
        }
      }

      // Get the correct preview URL from Daytona
      const previewLink = await sandbox.getPreviewLink(3000);

      // Create or update project in database
      if (existingProjectId && typeof existingProjectId === 'string') {
        // Update existing project
        projectId = existingProjectId;
        await updateProject(projectId, {
          sandbox_id: sandboxId,
          preview_url: previewLink.url,
          preview_token: previewLink.token,
          status: 'active',
          last_generated_at: new Date().toISOString(),
          generation_count: 1 // You might want to increment this
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
          preview_url: previewLink.url,
          preview_token: previewLink.token,
          status: 'active',
          last_generated_at: new Date().toISOString()
        });
      }

      // Save project files to database
      if (projectId) {
        await saveProjectFiles(projectId, allFiles);
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
        url: previewLink.url,
        token: previewLink.token,
        files: allFiles,
        generationsRemaining: limits.generationsRemaining - 1,
        message: `Next.js project created with ${allFiles.length} files (GitHub-ready)`
      });

    } catch (execError) {
      console.error('Execution error:', execError);
      return NextResponse.json({
        success: false,
        sandboxId: sandboxId,
        error: 'Failed to set up Next.js project in sandbox',
        files: filesData.files,
        details: execError instanceof Error ? execError.message : 'Unknown error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('API error:', error);
    
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