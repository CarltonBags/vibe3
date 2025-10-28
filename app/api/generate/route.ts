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
  apiKey: process.env.GEMINI_KEY,
  // Add timeout and retry configuration
  fetchOptions: {
    timeout: 120000 // 2 minute timeout
  }
});

export async function POST(req: Request) {
  const startTime = Date.now();
  let projectId: string | null = null;
  let tokensUsed = 0;

  try {
    console.log('🚀 POST /api/generate - Starting generation request');
    
    let requestBody;
    try {
      requestBody = await req.json();
      console.log('✅ Request body parsed successfully');
    } catch (e) {
      console.error('❌ Failed to parse request body:', e);
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }
    
    const { prompt, projectId: existingProjectId, template = 'vite-react' } = requestBody;
    console.log('📝 Prompt received:', prompt?.substring(0, 100));
    console.log('🎨 Template:', template);

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Get authenticated user from cookies
    console.log('🔐 Getting user from cookies...');
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
    console.log('🔐 Session check:', session ? 'Authenticated' : 'Not authenticated');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    console.log('✅ User authenticated:', userId);

    // Check user limits
    console.log('🔍 Checking user limits...');
    const limits = await checkUserLimits(userId);
    console.log('✅ Limits checked:', limits.canGenerate);
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

    // Start sandbox creation in parallel with AI generation
    console.log('🏗️ Starting Daytona sandbox creation...');
    const sandboxPromise = (async () => {
      const daytona = new Daytona({
        apiKey: process.env.DAYTONA_KEY || '',
        apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io'
      });

      // Create sandbox with Node.js environment (auto-provisions from Docker Hub)
      // Setting public: true makes the sandbox accessible without authentication
      console.log('📦 Provisioning sandbox with image: node:20-alpine');
      const sandbox = await daytona.create({
        image: 'node:20-alpine',
        public: true,
        ephemeral: true,
      });
      const sandboxId = sandbox.id;
      console.log('✅ Sandbox created:', sandboxId);
      return { sandbox, sandboxId };
    })();

    console.log('🤖 Calling Gemini API...');
    
    // Try primary model first, fallback to other models
    const tryGeneration = async (modelName: string, attempt: number) => {
      console.log(`Attempting with ${modelName} (attempt ${attempt})...`);
      try {
        return await gemini.models.generateContent({
          model: modelName,
          contents: [{text: prompt}],
          config: {
            systemInstruction: instruction.toString(),
            responseMimeType: "application/json",
            temperature: 0.3
          }
        });
      } catch (error) {
        console.error(`${modelName} failed:`, error);
        throw error;
      }
    };

    const completionPromise = tryGeneration("gemini-2.5-flash", 1)
      .catch(async (error) => {
        console.log('Primary model failed, trying fallback models...');
        // Fallback 1: Try gemini-1.5-flash
        return tryGeneration("gemini-1.5-flash", 2)
          .catch(async () => {
            // Fallback 2: Try gemini-1.5-pro
            return tryGeneration("gemini-1.5-pro", 3)
              .catch(() => {
                throw new Error('All Gemini models failed. Please try again later.');
              });
          });
      });

    // Wait for both AI generation and sandbox creation to complete
    const [completion, sandboxResult] = await Promise.all([completionPromise, sandboxPromise]);
    const { sandbox, sandboxId } = sandboxResult;
    console.log('✅ Gemini API call completed');

    // Access response text correctly for Gemini SDK
    let responseText = completion.text || '';
    console.log('📝 Response text length:', responseText.length);
    
    // Log the raw response for debugging
    console.log('📝 Raw Gemini response (first 500 chars):', responseText.substring(0, 500));
    
    // Try to get token usage from Gemini response
    // Gemini doesn't expose usage like OpenAI, so we estimate
    tokensUsed = Math.ceil(responseText.length / 4); // Rough estimate: 1 token ≈ 4 characters
    
    // Log for debugging
    console.log(`Estimated tokens used: ${tokensUsed}, response length: ${responseText.length}`);
    
    // Parse JSON response
    let filesData: { files: Array<{ path: string; content: string }> } | null = null;
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
      
      console.log('🧹 Cleaned response (first 200 chars):', cleanedResponse.substring(0, 200));
      
      // Fix escaped characters that can break JSON parsing
      // Remove any trailing commas before closing braces/brackets
      cleanedResponse = cleanedResponse.replace(/,(\s*[}\]])/g, '$1');
      
      // Try to parse as JSON
      filesData = JSON.parse(cleanedResponse);
      
      console.log('✅ Successfully parsed JSON, found files:', filesData?.files?.length);
      
      if (!filesData || !filesData.files || !Array.isArray(filesData.files)) {
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
      const pageFile = filesData.files.find(f => f.path === 'src/App.tsx');
      if (pageFile) {
        console.log('🔍 Checking for component imports in App.tsx...');
        
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
            .filter(f => f.path.startsWith('src/components/') || f.path.startsWith('app/components/'))
            .map(f => f.path.replace('src/components/', '').replace('app/components/', '').replace('.tsx', ''));
          
          console.log('Existing components:', existingComponents);
          
          const missingComponents = importedComponents.filter(comp => !existingComponents.includes(comp));
          
          console.log('Missing components:', missingComponents);
          
          if (missingComponents.length > 0) {
            console.warn(`⚠️ Missing components detected: ${missingComponents.join(', ')}`);
            console.log('🔧 Creating missing components...');
            
            // Create missing components
            for (const componentName of missingComponents) {
              const componentContent = `

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
                path: `src/components/${componentName}.tsx`,
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
      console.log('⚠️ CRITICAL: Parse error detected. Response text:', responseText.substring(0, 500));
      
      // Try multiple extraction strategies
      console.log('🔧 Attempting emergency JSON extraction...');
      
      // Strategy 1: Try to manually parse by handling escaped characters properly
      try {
        // Extract the JSON portion
        let jsonText = responseText;
        const codeBlockMatch = responseText.match(/```json\n([\s\S]*)\n```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1];
        } else {
          const jsonObjMatch = responseText.match(/\{[\s\S]*"files"[\s\S]*\}/);
          if (jsonObjMatch) {
            jsonText = jsonObjMatch[0];
          }
        }
        
        // Fix common JSON issues
        jsonText = jsonText.replace(/,\s*}/g, '}'); // Remove trailing commas in objects
        jsonText = jsonText.replace(/,\s*]/g, ']'); // Remove trailing commas in arrays
        jsonText = jsonText.replace(/,\s*([})\]])/g, '$1'); // Remove commas before closing brackets
        
        filesData = JSON.parse(jsonText);
        console.log('✅ Successfully parsed JSON after cleanup');
      } catch (manualParseError) {
        console.error('❌ Manual parse also failed:', manualParseError);
      }
      
      // Strategy 2: Ask AI to fix the JSON
      if (!filesData) {
        console.log('🔧 Asking AI to regenerate valid JSON...');
        try {
          const fixCompletion = await gemini.models.generateContent({
            model: "gemini-2.0-flash-exp",
            contents: [{text: `The following JSON is malformed. Please return ONLY valid JSON with no markdown or extra text. Fix any escaped characters or syntax errors:\n\n${responseText.substring(0, 5000)}`}],
            config: {
              systemInstruction: "You are a JSON parser. Return ONLY valid JSON, no explanations, no markdown."
            }
          });
          
          const fixText = fixCompletion.text || '';
          const cleaned = fixText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            // Remove control characters that break JSON
            .replace(/[\x00-\x1F\x7F]/g, '')
            .trim();
          filesData = JSON.parse(cleaned);
          console.log('✅ AI-assisted parse successful');
        } catch (aiParseError) {
          console.error('❌ AI-assisted parse failed:', aiParseError);
        }
      }
      
      // Last resort: return error instead of raw text
      if (!filesData) {
        console.error('❌ All extraction strategies failed');
        throw new Error('Failed to parse AI response: Invalid JSON structure. Please try again.');
      }
    }
    
    // Ensure filesData is valid before proceeding
    if (!filesData || !filesData.files || filesData.files.length === 0) {
      throw new Error('Failed to parse AI response: No valid files found');
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
      console.log('📦 Installing dependencies...');
      const installPromise = sandbox.process.executeCommand('cd /workspace && npm install');
      
      // Write app files
      await sandbox.fs.uploadFile(Buffer.from(mainTsx), '/workspace/src/main.tsx');
      await sandbox.fs.uploadFile(Buffer.from(appTsx), '/workspace/src/App.tsx');
      await sandbox.fs.uploadFile(Buffer.from(indexCss), '/workspace/src/index.css');
      
      // Upload all generated files (with validation)
      console.log(`Uploading ${filesData.files.length} generated files...`);
      for (const file of filesData.files) {
        // Map app/ paths to src/ for Vite
        const filePath = file.path.replace('app/', 'src/');
        const fullPath = `/workspace/${filePath}`;
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
        
        // Note: Vite doesn't need 'use client' directive like Next.js
        // React components in Vite are client-side by default
        
        console.log(`Uploading: ${fullPath}`);
        await sandbox.fs.uploadFile(Buffer.from(content), fullPath);
      }

      // Wait for dependency installation to complete
      console.log('⏳ Waiting for dependencies to install...');
      await installPromise;
      console.log('✅ Dependencies installed successfully');
      
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
        
        // Skip lint check for Vite projects (no ESLint configured in template)
        const lintErrors = '';
        
        console.log('TypeScript check:', tsErrors.substring(0, 500));
        console.log('Lint check:', lintErrors.substring(0, 500));
        
        // Check if there are critical errors
        const hasTsErrors = tsErrors.includes('error TS');
        const hasSyntaxErrors = tsErrors.includes('Syntax Error') || lintErrors.includes('Syntax Error') || tsErrors.includes('Unexpected token');
        const hasMissingImports = tsErrors.includes('Cannot find module') || tsErrors.includes('Module not found');
        const hasJsonError = tsErrors.includes('"files"') || tsErrors.includes('Expected');
        const hasJsxError = tsErrors.includes('closing tag') || tsErrors.includes('Expected corresponding JSX') || tsErrors.includes('jsx identifier');
        const hasStringLiteralError = tsErrors.includes('TS1002') || tsErrors.includes('Unterminated string literal');
        
        if (!hasTsErrors && !hasSyntaxErrors && !hasMissingImports && !hasJsonError && !hasJsxError && !hasStringLiteralError) {
          console.log('✅ Preflight checks passed!');
          hasErrors = false;
          break;
        }
        
        if (hasJsonError) {
          console.error('🚨 JSON structure detected in code file!');
        }
        
        if (hasJsxError) {
          console.error('🚨 JSX syntax error detected!');
        }

        if (hasStringLiteralError) {
          console.error('🚨 Unterminated string literal detected!');
        }
        
        if (debugAttempts >= MAX_DEBUG_ATTEMPTS) {
          console.warn('⚠️ Max debug attempts reached, proceeding anyway');
          break;
        }
        
        // Auto-fix common issues
        console.log(`🔧 Attempting auto-fix (attempt ${debugAttempts})...`);
        
        // Check which file has the JSX error from the preflight output
        // Match patterns like: src/components/Header.tsx(19,6): or src/App.tsx
        const errorFileMatch = tsErrors.match(/(?:^|\n)(src\/[^\s(]+\.tsx)/m);
        if (!errorFileMatch || !errorFileMatch[1]) {
          console.log('⚠️ Could not determine error file from:', tsErrors.substring(0, 200));
          break;
        }
        
        const filePath = `/workspace/${errorFileMatch[1]}`;
        console.log(`Attempting to fix file: ${filePath}`);
        
        // Check if file exists before trying to download
        let pageText = '';
        try {
          const pageContent = await sandbox.fs.downloadFile(filePath);
          pageText = pageContent.toString('utf-8');
        } catch (fileError) {
          console.error(`Could not read file ${filePath}:`, fileError);
          break;
        }
        
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
        
        // Note: Vite doesn't need 'use client' directive
        
        // Fix 3: If string literal errors detected, try to fix them
        if (hasStringLiteralError && !needsFix) {
          console.log('🔧 Unterminated string literal detected, attempting to fix...');
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
                console.log(`Found potential unterminated string on line ${i + 1}: ${line.substring(0, 100)}`);

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
                  console.log(`Fixed line ${i + 1}`);
                }
              }
            }

            if (hasFixes) {
              fixedContent = fixedLines.join('\n');
              needsFix = true;
              console.log('✅ Fixed unterminated string literals');
            }
          } catch (fixError) {
            console.error('String literal fix failed:', fixError);
          }
        }

        // Fix 4: If JSX errors detected, ask AI to fix them
        if (hasJsxError && !needsFix) {
          console.log('🔧 JSX errors detected, asking AI to fix...');
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
              console.log('✅ AI fixed JSX syntax errors');
            }
          } catch (aiError) {
            console.error('AI fix failed:', aiError);
          }
        }
        
        if (needsFix) {
          console.log('🔧 Applying fixes to page.tsx');
          await sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/src/App.tsx');
          // Continue loop to re-check
          continue;
        } else {
          console.log('⚠️ Could not auto-fix errors, proceeding anyway');
          break;
        }
      }
      
      // Prepare complete file list for GitHub-ready project (declare before auto-fix loop)
      const packageJson = templateFiles['package.json']
      const viteConfig = templateFiles['vite.config.ts']
      const tailwindConfig = templateFiles['tailwind.config.js']
      const postcssConfig = templateFiles['postcss.config.js']
      const tsConfig = templateFiles['tsconfig.json']
      const tsConfigNode = templateFiles['tsconfig.node.json']
      const indexHtml = templateFiles['index.html']

      // Check if AI generated these core files to avoid duplicates
      const aiGeneratedPaths = filesData.files.map(f => f.path.replace('app/', 'src/'));
      const hasAppTsx = aiGeneratedPaths.includes('src/App.tsx');
      const hasMainTsx = aiGeneratedPaths.includes('src/main.tsx');
      const hasIndexCss = aiGeneratedPaths.includes('src/index.css');

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
      
      
      // Build the project for production
      console.log('🔨 Building project for production...');
      const buildResult = await sandbox.process.executeCommand('cd /workspace && npm run build');

      if (buildResult.result?.includes('error') || buildResult.result?.includes('Error')) {
        console.error('Build failed:', buildResult.result);
        throw new Error('Build failed: ' + buildResult.result);
      }

      console.log('✅ Build completed successfully');

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

      // Update project with final URL and status
      await updateProject(projectId, {
        preview_url: uploadResult.url,
        status: 'active'
      });

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
        url: uploadResult.url,
        files: allFiles,
        generationsRemaining: limits.generationsRemaining - 1,
        message: `Vite project built and deployed with ${allFiles.length} files`,
        tokensUsed,
        buildHash: uploadResult.buildHash
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