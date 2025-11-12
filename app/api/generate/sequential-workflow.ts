// Sequential task-based generation workflow
// This replaces the batch generation approach with component-by-component building
// Each component is compiled and fixed before moving to the next

import * as path from "path";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { addStatus } from "@/lib/status-tracker";

export interface Task {
  step: number;
  task: string;
  file: string;
  description: string;
  dependencies: string[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface CompilationError {
  file: string;
  error: string;
  line?: number;
  column?: number;
}

/**
 * Parse markdown format files from AI response
 * Expected format:
 * FILE: path/to/file.tsx
 * ```tsx
 * code here
 * ```
 */
export function parseFilesMarkdown(raw: string): { files: GeneratedFile[] } | null {
  const files: GeneratedFile[] = [];
  try {
    let cleaned = raw.trim();
    
    // Match FILE: path followed by code block (more flexible regex)
    // Pattern 1: FILE: path on one line, then code block (handles ```typescript, ```tsx, ```ts, etc.)
    const filePattern = /FILE:\s*([^\n\r]+)[\r\n]+\s*```(?:tsx?|typescript|jsx?|js|json|ts)?[\r\n]+([\s\S]*?)```/gi;
    let match;
    
    while ((match = filePattern.exec(cleaned)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      
      if (filePath && content) {
        files.push({ path: filePath, content });
      }
    }
    
    // Fallback: code blocks with path hints like ```typescript: path
    if (files.length === 0) {
      const altPattern = /```(?:tsx?|typescript|ts|jsx?|js|json):\s*([^\n\r]+)[\r\n]+([\s\S]*?)```/gi;
      while ((match = altPattern.exec(cleaned)) !== null) {
        const filePath = match[1].trim();
        const content = match[2].trim();
        if (filePath && content) {
          files.push({ path: filePath, content });
        }
      }
    }
    
    // Fallback 2: Look for FILE: followed by any code block (even without language tag)
    if (files.length === 0) {
      const loosePattern = /FILE:\s*([^\n\r]+)[\r\n]+\s*```[\r\n]*([\s\S]*?)```/gi;
      while ((match = loosePattern.exec(cleaned)) !== null) {
        const filePath = match[1].trim();
        const content = match[2].trim();
        if (filePath && content && content.length > 10) { // Must have some content
          files.push({ path: filePath, content });
        }
      }
    }
    
    if (files.length > 0) {
      console.log(`[parseFilesMarkdown] Parsed ${files.length} file(s): ${files.map(f => f.path).join(', ')}`);
      return { files };
    }
    
    console.warn(`[parseFilesMarkdown] No files found in markdown. Raw input length: ${raw.length}, first 500 chars: ${raw.slice(0, 500)}`);
    return null;
  } catch (e) {
    console.error('[parseFilesMarkdown] Error parsing markdown:', e);
    return null;
  }
}

/**
 * Compile a single file and check for TypeScript errors
 */
export async function compileFile(
  sandbox: any,
  filePath: string,
  content: string
): Promise<{ success: boolean; errors: CompilationError[] }> {
  try {
    // Write file to sandbox (use uploadFile which is the correct Daytona SDK method)
    await sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), `/workspace/${filePath}`);
    
    // Run TypeScript check
    const result = await sandbox.process.executeCommand(
      `cd /workspace && npx tsc --noEmit 2>&1 || true`
    );
    
    const output = result.result || '';
    const hasErrors = output.includes('error TS');
    
    // CRITICAL: Check for Lucide icon errors specifically (TS2305: has no exported member)
    const hasLucideError = output.includes('has no exported member') && 
                          (output.includes('lucide-react') || output.includes('"lucide-react"') || output.includes("'lucide-react'"));
    
    const hasAnyError = hasErrors || hasLucideError;
    
    // Log full output if there are errors (for debugging)
    if (hasAnyError) {
      console.log(`[compileFile] TypeScript errors for ${filePath}:\n${output.slice(0, 1000)}`);
    }
    
    if (!hasAnyError) {
      return { success: true, errors: [] };
    }
    
    // Parse errors for this specific file
    const errors: CompilationError[] = [];
    const fileErrorPattern = new RegExp(`${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\((\\d+),(\\d+)\\): error TS\\d+: ([^\\n]+)`, 'g');
    let errorMatch;
    
    while ((errorMatch = fileErrorPattern.exec(output)) !== null) {
      errors.push({
        file: filePath,
        error: errorMatch[3],
        line: parseInt(errorMatch[1]),
        column: parseInt(errorMatch[2])
      });
    }
    
    // CRITICAL: Also check for Lucide icon errors that might not match the file pattern
    if (hasLucideError) {
      // Extract invalid icon name from error message
      const lucideErrorMatch = output.match(/has no exported member\s+['"]([A-Z][a-zA-Z0-9]*)['"].*?lucide-react/i);
      if (lucideErrorMatch) {
        const invalidIcon = lucideErrorMatch[1];
        // Try to find the line number from the error
        const lineMatch = output.match(new RegExp(`${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\((\\d+),`, 'i'));
        errors.push({
          file: filePath,
          error: `Module 'lucide-react' has no exported member '${invalidIcon}'`,
          line: lineMatch ? parseInt(lineMatch[1]) : 2,
          column: 10
        });
        console.log(`[compileFile] Detected Lucide icon error: ${invalidIcon} in ${filePath}`);
      } else if (errors.length === 0) {
        // Generic Lucide error if we can't parse it
        errors.push({
          file: filePath,
          error: 'Invalid Lucide React icon import detected'
        });
      }
    }
    
    // CRITICAL: Check for props violations (TS2559, TS2322, etc.) - components must have ZERO props
    const hasPropsError = output.includes('TS2559') || 
                         (output.includes('TS2322') && (output.includes('is not assignable') || output.includes('IntrinsicAttributes'))) ||
                         output.includes('Property') && output.includes('does not exist in type') && output.includes('IntrinsicAttributes');
    
    if (hasPropsError && content) {
      // Check for props being passed to components
      const propsPattern = /<[A-Z][a-zA-Z0-9]*\s+[^/>]*>/g;
      const propsMatches = content.match(propsPattern);
      if (propsMatches) {
        errors.push({
          file: filePath,
          error: 'Props passed to component - ALL components must have ZERO props (no props interface, no props parameter, no children prop)',
          line: 1,
          column: 1
        });
        console.log(`[compileFile] ⚠️ PROPS VIOLATION DETECTED in ${filePath}: Components must have ZERO props`);
      }
    }
    
    // CRITICAL: Check for invalid style tag props (jsx, global)
    const hasStylePropsError = output.includes('jsx') && output.includes('style') && 
                              (output.includes('Property') || output.includes('does not exist'));
    
    if (hasStylePropsError && content) {
      if (content.includes('<style') && (content.includes('jsx=') || content.includes('global='))) {
        errors.push({
          file: filePath,
          error: 'Invalid props on <style> tag - jsx and global props are not allowed',
          line: 1,
          column: 1
        });
        console.log(`[compileFile] ⚠️ STYLE TAG PROPS VIOLATION in ${filePath}: jsx/global props not allowed`);
      }
    }
    
    // If no specific file errors found, check for general errors
    if (errors.length === 0 && hasAnyError) {
      errors.push({
        file: filePath,
        error: 'TypeScript compilation error (check output)'
      });
    }
    
    return { success: false, errors };
  } catch (e: any) {
    return {
      success: false,
      errors: [{ file: filePath, error: `Compilation check failed: ${e.message}` }]
    };
  }
}

/**
 * Generate a single component using Gemini
 */
export async function generateComponent(
  gemini: GoogleGenAI,
  instruction: string,
  task: Task,
  planRaw: string,
  existingFiles: GeneratedFile[],
  images: string[] = [],
  imageNames: string[] = [],
  userPrompt: string = ''
): Promise<{ files: GeneratedFile[]; rawResponse: string } | null> {
  const existingFilesContext = existingFiles
    .slice(-5) // Last 5 files for context
    .map(f => `- ${f.path} (${f.content.length} chars)`)
    .join('\n');
  
  const componentInfo = task.description;
  
  const prompt = `Generate ONE file for this task. Use MARKDOWN format with code blocks.

🎯 **CRITICAL - USER'S ORIGINAL REQUEST**:
"${userPrompt}"

**MANDATORY REQUIREMENTS BASED ON USER REQUEST:**
- ONLY if a user request is short or unprecise, fill in the content with generic data. Use ALL the Information the user gives you and use it!
- Follow the user's request EXACTLY - do not create generic placeholder content if unnecessary.
- incorporate requested features by the user.
- Use appropriate styling based on the user's description

TASK: ${task.task}
FILE: ${task.file}
DESCRIPTION: ${componentInfo}

OUTPUT FORMAT (MARKDOWN - NOT JSON):
FILE: ${task.file}
\`\`\`tsx
// Your code here - must be valid TypeScript/JSX
// ZERO PROPS - export function ComponentName() { return ... }
// Import ALL Lucide icons you use
// MUST use requested styling on users request. If not provided, style it as a professional UI/UX builder would
\`\`\`

CRITICAL RULES:
- 🚫 ABSOLUTE ZERO PROPS - NO EXCEPTIONS: export function ComponentName() { ... } with NO props interface, NO props parameter, NO children prop, NOTHING
- 🚫 NEVER pass props: Use <ComponentName /> with NO attributes, NO children prop, NO props of any kind
- ✅ Import ALL icons from 'lucide-react' BEFORE using them (e.g., <Menu /> needs import { Menu } from 'lucide-react')
- ✅ Use shadcn/ui components from "@/components/ui/" (lowercase paths like "@/components/ui/button")
- ❌ DO NOT create files in src/components/ui/ - they already exist
- ❌ DO NOT import from "@/components/lib/" - those don't exist
- ✅ Only import from "@/lib/..." if that file already exists (currently utilities like "@/lib/utils"); never invent modules such as "@/lib/theme-provider"
- ✅ Code must compile without TypeScript errors
- ✅ All JSX tags must be properly closed
- ✅ All imports must be valid

PROJECT PLAN:
${planRaw}

EXISTING FILES (for context):
${existingFilesContext || 'None yet'}

DEPENDENCIES:
${task.dependencies.map(d => `- ${d}`).join('\n') || 'None'}

IMPORTANT: Return ONLY the markdown format with FILE: and code block. No explanations, no JSON, just the markdown.`;

  const contents: any[] = [{ text: prompt }];
  
  // Add images if provided
  if (images.length > 0) {
    contents.push(...images.map((imgData: string, idx: number) => ({
      inlineData: {
        data: imgData.split(',')[1],
        mimeType: imgData.split(';')[0].split(':')[1]
      }
    })));
  }
  
  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: instruction.toString(),
        temperature: 0.3
      }
    });
    
    const rawResponse = response.text || '';
    console.log(`[generateComponent] Raw response length: ${rawResponse.length}, snippet: ${rawResponse.slice(0, 200)}`);
    
    const parsed = parseFilesMarkdown(rawResponse);
    
    if (parsed && parsed.files.length > 0) {
      console.log(`[generateComponent] Successfully parsed ${parsed.files.length} file(s) from markdown`);
      return { files: parsed.files, rawResponse };
    }
    
    console.error(`[generateComponent] Failed to parse markdown response. Raw response: ${rawResponse.slice(0, 500)}`);
    return null;
  } catch (e) {
    console.error('[generateComponent] Error:', e);
    return null;
  }
}

/**
 * Fix compilation errors using GPT-4o-mini
 */
export async function fixCompilationErrors(
  openai: OpenAI,
  filePath: string,
  content: string,
  errors: CompilationError[],
  planRaw: string
): Promise<string | null> {
  const errorSummary = errors
    .map(e => `Line ${e.line || '?'}: ${e.error}`)
    .join('\n');
  
  const prompt = `Fix TypeScript compilation errors in this file:

FILE: ${filePath}

CURRENT CODE:
\`\`\`tsx
${content}
\`\`\`

ERRORS:
${errorSummary}

PROJECT PLAN:
${planRaw}

Return ONLY the fixed code in markdown format:
FILE: ${filePath}
\`\`\`tsx
// Fixed code here
\`\`\`

RULES:
- Fix all errors
- 🚫 Keep ABSOLUTE ZERO PROPS pattern - NO props interface, NO props parameter, NO children prop, NOTHING
- 🚫 NEVER pass props - Use <ComponentName /> with NO attributes, NO children prop, NO props of any kind
- Import all missing icons/components
- Ensure valid TypeScript/JSX syntax`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a TypeScript/React expert. Fix compilation errors while preserving the component structure.

🚨 CRITICAL RULES - ABSOLUTE ZERO PROPS FOR CUSTOM COMPONENTS ONLY:
- ❌ NO props interface for YOUR custom components: Do NOT write interface Props { } or any interface
- ❌ NO props parameter for YOUR custom components: Do NOT write function Component(props: Props) or function Component({ title }: Props)
- ❌ NO children prop for YOUR custom components: Do NOT accept children in any way
- ❌ NO props at all for YOUR custom components: Do NOT accept ANY parameters in function signature
- ✅ CORRECT custom component: export function ComponentName() { return <div>...</div> }
- ✅ CORRECT usage of YOUR components: <ComponentName /> with NO attributes, NO children, NOTHING
- ✅ REQUIRED PROPS FOR LIBRARY COMPONENTS:
  - <Link to="/path">Text</Link> (Link REQUIRES to prop - missing it causes TS2741)
  - <TabsContent value="tab1">Content</TabsContent> (TabsContent REQUIRES value prop - missing it causes TS2741)
  - <TabsTrigger value="tab1">Tab</TabsTrigger> (TabsTrigger REQUIRES value prop)
  - <Route path="/" element={<Home />} /> (Route REQUIRES path and element props)
- 🚫 NEVER use jsx or global props on <style> tags: <style jsx> or <style global> are INVALID
- ✅ CORRECT: <style>CSS content here</style> (no jsx or global props) ` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    });
    
    const fixedResponse = response.choices[0]?.message?.content || '';
    const parsed = parseFilesMarkdown(fixedResponse);
    
    if (parsed && parsed.files.length > 0 && parsed.files[0].path === filePath) {
      return parsed.files[0].content;
    }
    
    return null;
  } catch (e) {
    console.error('[fixCompilationErrors] Error:', e);
    return null;
  }
}

/**
 * Sequential task execution workflow
 */
export async function executeSequentialWorkflow(
  gemini: GoogleGenAI,
  openai: OpenAI,
  sandbox: any,
  instruction: string,
  planRaw: string,
  taskFlow: Task[],
  images: string[] = [],
  imageNames: string[] = [],
  requestId: string,
  userPrompt: string = '' // User's original prompt
): Promise<{
  files: GeneratedFile[];
  rawResponses: Array<{ task: string; file: string; rawResponse: string; timestamp: string }>;
  compilationAttempts: Record<string, number>;
}> {
  const collected: GeneratedFile[] = [];
  const rawResponses: Array<{ task: string; file: string; rawResponse: string; timestamp: string }> = [];
  const compilationAttempts: Record<string, number> = {};
  const MAX_FIX_ATTEMPTS = 5;
  
  const declaredDependencies = new Set<string>();
  const allowedLibImports = new Set<string>();

  const importExistenceCache = new Map<string, boolean>();

  const candidateExtensions = ['', '.tsx', '.ts', '.jsx', '.js'];

  const toLibAlias = (filePath: string) => {
    if (!filePath.startsWith('src/lib/')) return null;
    const withoutExt = filePath
      .replace(/^src\//, '')
      .replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/i, '');
    const alias = `@/${withoutExt}`;
    const aliases = [alias];
    if (alias.endsWith('/index')) {
      aliases.push(alias.replace(/\/index$/, ''));
    }
    return aliases;
  };

  const seedLibImports = async () => {
    try {
      const result = await sandbox.process.executeCommand(
        'cd /workspace && find src/lib -type f 2>/dev/null || true'
      );
      const files =
        result.result
          ?.split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0) ?? [];
      for (const file of files) {
        if (!file.startsWith('src/lib/')) continue;
        const aliases = toLibAlias(file);
        if (!aliases) continue;
        aliases.forEach((alias) => allowedLibImports.add(alias));
      }
    } catch (error) {
      console.warn('[generate] Could not enumerate src/lib files:', error);
    }
  };

  await seedLibImports();

  const ensureImportPathsValid = async (
    sandbox: any,
    filePath: string,
    content: string,
    allowedLibs: Set<string>
  ): Promise<string[]> => {
    const issues: string[] = [];
    const seen = new Set<string>();
    const importRegex = /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    const tryLoad = async (absolutePath: string): Promise<boolean> => {
      if (importExistenceCache.has(absolutePath)) {
        return Boolean(importExistenceCache.get(absolutePath));
      }
      try {
        await sandbox.fs.downloadFile(absolutePath);
        importExistenceCache.set(absolutePath, true);
        return true;
      } catch {
        return false;
      }
    };

    const buildCandidates = (basePath: string): string[] => {
      const normalizedBase = basePath.replace(/\/+$/, '');
      const candidates = new Set<string>();

      for (const ext of candidateExtensions) {
        candidates.add(`${normalizedBase}${ext}`);
        candidates.add(`${normalizedBase}/index${ext}`);
      }

      return Array.from(candidates);
    };

    const resolveSpecifierPaths = (specifier: string, sourceFile: string): string[] => {
      if (specifier.startsWith('@/')) {
        const aliasPath = specifier.replace(/^@\//, 'src/');
        return buildCandidates(`/workspace/${aliasPath}`);
      }

      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const baseDir = path.posix.dirname(`/workspace/${sourceFile}`);
        const resolved = path.posix.normalize(path.posix.join(baseDir, specifier));
        return buildCandidates(resolved);
      }

      return [];
    };

    while ((match = importRegex.exec(content)) !== null) {
      const specifier = match[1];
      if (seen.has(specifier)) continue;
      seen.add(specifier);

      if (specifier.startsWith('@/components/lib')) {
        issues.push(
          `Do not import from ${specifier}. Template library components are reference-only; use "@/components/..." instead.`
        );
        continue;
      }

      if (specifier.startsWith('@/lib/')) {
        const normalized = specifier.replace(/\.(tsx|ts|jsx|js)$/i, '');
        if (
          !allowedLibs.has(specifier) &&
          !allowedLibs.has(normalized) &&
          !allowedLibs.has(`${normalized}/index`)
        ) {
          issues.push(
            `Module ${specifier} does not exist in src/lib. Only import utilities that already exist (e.g., "@/lib/utils").`
          );
        }
        continue;
      }

      if (specifier.startsWith('@/') || specifier.startsWith('./') || specifier.startsWith('../')) {
        const candidates = resolveSpecifierPaths(specifier, filePath);
        if (candidates.length === 0) continue;

        let found = false;
        for (const candidate of candidates) {
          if (await tryLoad(candidate)) {
            found = true;
            break;
          }
        }

        if (!found) {
          issues.push(
            `Import "${specifier}" in ${filePath} points to a file that does not exist yet. Generate that file or remove the import.`
          );
        }
      }
    }

    return issues;
  };

  const refreshDeclaredDependencies = (pkgContent: string) => {
    try {
      const pkgJson = JSON.parse(pkgContent);
      declaredDependencies.clear();
      Object.keys(pkgJson.dependencies || {}).forEach((dep) => declaredDependencies.add(dep));
      Object.keys(pkgJson.devDependencies || {}).forEach((dep) => declaredDependencies.add(dep));
    } catch (error) {
      console.warn('[generate] Failed to parse package.json while refreshing dependencies:', error);
    }
  };

  try {
    const pkgBuffer = await sandbox.fs.downloadFile('/workspace/package.json');
    refreshDeclaredDependencies(pkgBuffer.toString('utf-8'));
  } catch (error) {
    console.warn('[generate] Could not read package.json to seed dependency list:', error);
  }

  console.log(`[generate:${requestId}] Starting sequential workflow with ${taskFlow.length} tasks`);
  addStatus(requestId, 'components', `Building ${taskFlow.length} components...`, 30);
  
  for (let i = 0; i < taskFlow.length; i++) {
    const task = taskFlow[i];
    const taskNum = i + 1;
    const progress = 30 + Math.floor((i / taskFlow.length) * 50); // 30-80% range
    
    console.log(`[generate:${requestId}] Starting task ${task.step}: ${task.task} (${task.file})`);
    addStatus(requestId, 'components', `Building component ${taskNum}/${taskFlow.length}: ${task.task}`, progress);
    
    let currentContent: string | null = null;
    let attempts = 0;
    let compilationSuccess = false;
    
    // Check dependencies
    const missingDeps = task.dependencies.filter(dep => 
      !collected.some(f => f.path === dep)
    );
    
    if (missingDeps.length > 0) {
      console.warn(`[generate:${requestId}] Missing dependencies for ${task.file}: ${missingDeps.join(', ')}`);
    }
    
    // Generate and fix loop
    while (attempts < MAX_FIX_ATTEMPTS && !compilationSuccess) {
      attempts++;
      compilationAttempts[task.file] = attempts;
      
      // Generate component
      if (attempts === 1) {
        addStatus(requestId, 'components', `Generating ${task.task}...`, progress);
      } else {
        addStatus(requestId, 'components', `Fixing errors in ${task.task} (attempt ${attempts})...`, progress);
      }
      
      let generated = null;
      let generationError = null;
      
      try {
        generated = await generateComponent(
          gemini,
          instruction,
          task,
          planRaw,
          collected,
          images,
          imageNames,
          userPrompt
        );

        if (generated && generated.files) {
          // If package.json was updated in this generation, refresh declared deps
          const packageFile = generated.files.find((f) => f.path === 'package.json');
          if (packageFile) {
            refreshDeclaredDependencies(packageFile.content);
          }

          const missingDeps = new Set<string>();

          for (const file of generated.files) {
            const importRegex = /from\s+['"]([^'"\n]+)['"]/g;
            let match: RegExpExecArray | null;
            while ((match = importRegex.exec(file.content)) !== null) {
              const moduleName = match[1];

              if (
                moduleName.startsWith('.') ||
                moduleName.startsWith('@/') ||
                moduleName.startsWith('~')
              ) {
                continue;
              }

              const baseName = moduleName.startsWith('@')
                ? moduleName.split('/').slice(0, 2).join('/')
                : moduleName.split('/')[0];

              if (!declaredDependencies.has(baseName)) {
                missingDeps.add(baseName);
              }
            }
          }

          if (missingDeps.size > 0) {
            throw new Error(
              `Missing dependencies: ${Array.from(missingDeps).join(
                ', '
              )}. Add them to package.json before using them.`
            );
          }
        }
      } catch (err: any) {
        generationError = err;
        console.error(`[generate:${requestId}] Error generating ${task.file}:`, err?.message || err);
        generated = null;
        currentContent = null;
        
        // Check if it's a retryable error (503, 429, etc.)
        const isRetryable = err?.message?.includes('503') || 
                           err?.message?.includes('overloaded') ||
                           err?.message?.includes('429') ||
                           err?.message?.includes('UNAVAILABLE');
        
        if (isRetryable && attempts < MAX_FIX_ATTEMPTS) {
          console.log(`[generate:${requestId}] Retryable error, will retry (attempt ${attempts}/${MAX_FIX_ATTEMPTS})`);
          addStatus(requestId, 'components', `Model overloaded, retrying ${task.task}... (attempt ${attempts})`, progress);
          // Wait a bit before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempts, 5000)));
          continue; // Retry the generation
        }
      }
      
      if (!generated || generated.files.length === 0) {
        if (attempts < MAX_FIX_ATTEMPTS) {
          console.warn(`[generate:${requestId}] Failed to generate ${task.file} (attempt ${attempts}/${MAX_FIX_ATTEMPTS}) - retrying...`);
          addStatus(requestId, 'components', `Retrying generation of ${task.task}... (attempt ${attempts})`, progress);
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempts, 5000)));
          continue; // Retry the generation
        } else {
          console.error(`[generate:${requestId}] Failed to generate ${task.file} after ${attempts} attempts`);
          addStatus(requestId, 'components', `Failed to generate ${task.task} after ${attempts} attempts`, progress);
          break; // Only break after max attempts
        }
      }
      
      const generatedFile = generated.files[0];
      currentContent = generatedFile.content;

      // Track lib aliases for newly generated lib files
      if (generatedFile.path.startsWith('src/lib/')) {
        const aliases = toLibAlias(generatedFile.path);
        if (aliases) {
          aliases.forEach((alias) => allowedLibImports.add(alias));
        }
      }

      // Validate imports reference existing modules
      const importIssues = await ensureImportPathsValid(
        sandbox,
        generatedFile.path,
        currentContent,
        allowedLibImports
      );

      if (importIssues.length > 0) {
        console.warn(
          `[generate:${requestId}] Invalid import(s) detected in ${task.file}: ${importIssues.join(' | ')}`
        );
        if (attempts < MAX_FIX_ATTEMPTS) {
          addStatus(
            requestId,
            'components',
            `Invalid imports in ${task.task}, retrying...`,
            progress
          );
          currentContent = null;
          generated = null;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(800 * attempts, 3000))
          );
          continue;
        } else {
          console.error(
            `[generate:${requestId}] Aborting ${task.file} due to invalid imports after ${attempts} attempts`
          );
          break;
        }
      }
      
      // CRITICAL: Pre-compilation validation and fixes (MUST run BEFORE compilation)
      try {
        // Fix 1: Remove invalid style tag props (jsx, global) BEFORE compilation
        if (currentContent.includes('<style') && (currentContent.includes('jsx=') || currentContent.includes('global=') || currentContent.includes('jsx ') || currentContent.includes('global '))) {
          const original: string = currentContent;
          currentContent = currentContent.replace(/<style\s+jsx(?:={true}|={false}|={\s*true\s*}|={\s*false\s*})?\s*/g, '<style ');
          currentContent = currentContent.replace(/<style\s+global(?:={true}|={false}|={\s*true\s*}|={\s*false\s*})?\s*/g, '<style ');
          currentContent = currentContent.replace(/jsx={true}\s*/g, '');
          currentContent = currentContent.replace(/jsx={false}\s*/g, '');
          currentContent = currentContent.replace(/jsx\s+/g, '');
          currentContent = currentContent.replace(/global={true}\s*/g, '');
          currentContent = currentContent.replace(/global={false}\s*/g, '');
          currentContent = currentContent.replace(/global\s+/g, '');
          currentContent = currentContent.replace(/<style\s+jsx\s*=\s*{?true}?\s*/g, '<style ');
          currentContent = currentContent.replace(/<style\s+jsx\s*=\s*{?false}?\s*/g, '<style ');
          currentContent = currentContent.replace(/<style\s+global\s*=\s*{?true}?\s*/g, '<style ');
          currentContent = currentContent.replace(/<style\s+global\s*=\s*{?false}?\s*/g, '<style ');
          if (currentContent !== original) {
            console.log(`🔧 Removed invalid jsx/global props from style tags in ${task.file} (pre-compilation)`);
          }
        }
        
        // Fix 2: Remove props from components (ABSOLUTE ZERO PROPS RULE) BEFORE compilation
        // NOTE: Only remove props from CUSTOM components, NOT from library components (shadcn/ui, react-router-dom)
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
          'TableRow', 'TableHead', 'TableCell', 'NavigationMenu', 'NavigationMenuItem',
          'NavigationMenuLink', 'NavigationMenuList', 'NavigationMenuTrigger', 'NavigationMenuContent',
          // react-router-dom components
          'Link', 'NavLink', 'Route', 'Routes', 'Navigate', 'Outlet', 'Router',
          // HTML elements (lowercase, but checking anyway)
          'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 'input', 'img'
        ];
        
        while ((match = propsPattern.exec(currentContent)) !== null) {
          const componentName = match[1];
          // Skip library components (they MUST have props) and HTML elements
          // Only flag custom components (capitalized, not in library list)
          if (!libraryComponents.includes(componentName) && /^[A-Z]/.test(componentName)) {
            componentsWithProps.add(componentName);
          }
        }
        
        // Remove props from custom components
        for (const compName of Array.from(componentsWithProps)) {
          const original: string = currentContent;
          // Remove props: <ComponentName prop="value" /> -> <ComponentName />
          currentContent = currentContent.replace(
            new RegExp(`<${compName}\\s+[^/>]*/>`, 'g'), 
            `<${compName} />`
          );
          // Remove props from opening tags: <ComponentName prop="value"> -> <ComponentName>
          currentContent = currentContent.replace(
            new RegExp(`<${compName}\\s+([^>]*?)>`, 'g'),
            `<${compName}>`
          );
          // Handle children prop specifically
          currentContent = currentContent.replace(
            new RegExp(`<${compName}\\s+children=\\{[^}]+\\}\\s*/>`, 'g'),
            `<${compName} />`
          );
          // Remove JSX children: <ComponentName>{children}</ComponentName> -> <ComponentName />
          const childrenPattern = new RegExp(`<${compName}\\s*>[\\s\\S]*?</${compName}>`, 'g');
          if (childrenPattern.test(currentContent)) {
            currentContent = currentContent.replace(childrenPattern, `<${compName} />`);
          }
          
          if (currentContent !== original) {
            console.log(`🔧 Removed props from <${compName}> in ${task.file} (ZERO PROPS RULE - pre-compilation)`);
          }
        }
        
        // Remove props interfaces and parameters
        const propsInterfacePattern = /(interface\s+\w*Props\s*\{[^}]*\})/g;
        if (propsInterfacePattern.test(currentContent)) {
          const original: string = currentContent;
          currentContent = currentContent.replace(propsInterfacePattern, '');
          currentContent = currentContent.replace(/\(props:\s*\w*Props\)/g, '()');
          currentContent = currentContent.replace(/\(\{\s*[^}]+?\s*\}:\s*\w*Props\)/g, '()');
          if (currentContent !== original) {
            console.log(`🔧 Removed props interface/parameter from ${task.file} (ZERO PROPS RULE - pre-compilation)`);
          }
        }
        
        // Fix 3: Validate and fix Lucide icons
        const { findClosestLucideIcon, isValidLucideIcon, VALID_LUCIDE_ICONS } = await import('@/lib/lucide-icons');
        
        // Extract all Lucide icon imports
        const lucideImportMatch = currentContent.match(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/);
        if (lucideImportMatch) {
          const importedIcons = lucideImportMatch[1]
            .split(',')
            .map(i => i.trim())
            .filter(Boolean);
          
          let needsFix = false;
          const fixedIcons: string[] = [];
          const iconReplacements: Record<string, string> = {};
          
          // Validate EVERY icon - check if it's in our valid list or use findClosestLucideIcon
          for (const icon of importedIcons) {
            // Check if icon is in our known valid list
            const isValid = isValidLucideIcon(icon);
            
            if (!isValid) {
              // Try to find a closest match
              const closest = findClosestLucideIcon(icon);
              if (closest) {
                iconReplacements[icon] = closest;
                fixedIcons.push(closest);
                needsFix = true;
                console.log(`🔧 Replacing invalid Lucide icon: ${icon} -> ${closest}`);
              } else {
                // No match found, use a safe fallback based on icon name
                let fallback = 'ArrowRight';
                const lowerIcon = icon.toLowerCase();
                if (lowerIcon.includes('sun') || lowerIcon.includes('moon') || lowerIcon.includes('theme') || lowerIcon.includes('light') || lowerIcon.includes('dark')) {
                  fallback = 'Sun'; // Use Sun for theme-related icons
                } else if (lowerIcon.includes('discord') || lowerIcon.includes('slack') || lowerIcon.includes('message')) {
                  fallback = 'MessageCircle';
                } else if (lowerIcon.includes('social') || lowerIcon.includes('share')) {
                  fallback = 'Share';
                } else if (lowerIcon.includes('brand') || lowerIcon.includes('logo')) {
                  fallback = 'Image';
                }
                iconReplacements[icon] = fallback;
                fixedIcons.push(fallback);
                needsFix = true;
                console.log(`🔧 Replacing invalid Lucide icon (no match): ${icon} -> ${fallback}`);
              }
            } else {
              fixedIcons.push(icon);
            }
          }
          
          if (needsFix) {
            // Replace all usages of invalid icons
            for (const [invalidIcon, replacement] of Object.entries(iconReplacements)) {
              // Replace in JSX: <Discord /> -> <MessageCircle />
              currentContent = currentContent.replace(new RegExp(`<${invalidIcon}\\s`, 'g'), `<${replacement} `);
              currentContent = currentContent.replace(new RegExp(`<${invalidIcon}/>`, 'g'), `<${replacement} />`);
              currentContent = currentContent.replace(new RegExp(`<${invalidIcon}>`, 'g'), `<${replacement}>`);
              // Replace in expressions: {Discord} -> {MessageCircle}
              currentContent = currentContent.replace(new RegExp(`{${invalidIcon}}`, 'g'), `{${replacement}}`);
              // Replace in imports (will be handled below)
            }
            
            // Update import statement with unique, valid icons
            const uniqueIcons = Array.from(new Set(fixedIcons)).sort();
            currentContent = currentContent.replace(
              /import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/,
              `import { ${uniqueIcons.join(', ')} } from 'lucide-react'`
            );
            console.log(`✅ Fixed Lucide icon imports in ${task.file}: ${Object.keys(iconReplacements).join(', ')} -> ${Object.values(iconReplacements).join(', ')}`);
          }
        }
      } catch (iconErr) {
        console.warn('⚠️ Failed to validate Lucide icons:', iconErr);
        // Continue anyway - compilation will catch it
      }
      
      // Save raw response
      rawResponses.push({
        task: task.task,
        file: task.file,
        rawResponse: generated.rawResponse,
        timestamp: new Date().toISOString()
      });
      
      // Compile and check (or recompile if we just got a fix)
      addStatus(requestId, 'components', `Compiling ${task.task}...`, progress);
      console.log(`[generate:${requestId}] Compiling ${task.file}, content length: ${currentContent.length}`);
      let compileResult = await compileFile(sandbox, task.file, currentContent);
      
      // Fix loop: keep trying to fix errors until success or max attempts
      let fixAttempts = 0;
      const MAX_FIX_RETRIES = 5; // Max times we'll call GPT-4o-mini to fix the same file
      
      while (!compileResult.success && fixAttempts < MAX_FIX_RETRIES && attempts < MAX_FIX_ATTEMPTS) {
        fixAttempts++;
        console.warn(`[generate:${requestId}] ✗ ${task.file} has ${compileResult.errors.length} error(s), fix attempt ${fixAttempts}/${MAX_FIX_RETRIES}`);
        console.warn(`[generate:${requestId}] Errors:`, compileResult.errors.map(e => `${e.file}:${e.line || '?'}: ${e.error}`).join('\n'));
        addStatus(requestId, 'components', `Fixing ${compileResult.errors.length} error(s) in ${task.task} (fix ${fixAttempts})...`, progress);
        
        // Try to fix with GPT-4o-mini
        console.log(`[generate:${requestId}] Calling GPT-4o-mini to fix ${compileResult.errors.length} error(s) in ${task.file}...`);
        try {
          const fixedContent = await fixCompilationErrors(
            openai,
            task.file,
            currentContent,
            compileResult.errors,
            planRaw
          );
          
          if (fixedContent) {
            currentContent = fixedContent;
            console.log(`[generate:${requestId}] ✓ Applied fix from GPT-4o-mini for ${task.file}, recompiling...`);
            const fixImportIssues = await ensureImportPathsValid(
              sandbox,
              task.file,
              currentContent,
              allowedLibImports
            );
            if (fixImportIssues.length > 0) {
              console.warn(
                `[generate:${requestId}] Invalid import(s) after fix in ${task.file}: ${fixImportIssues.join(' | ')}`
              );
              compileResult = {
                success: false,
                errors: fixImportIssues.map((issue) => ({
                  file: task.file,
                  error: issue
                }))
              };
              continue;
            }
            // Recompile the fixed content
            compileResult = await compileFile(sandbox, task.file, currentContent);
            if (compileResult.success) {
              console.log(`[generate:${requestId}] ✓ ${task.file} compiled successfully after fix!`);
              break; // Exit fix loop, compilation is now successful
            } else {
              console.warn(`[generate:${requestId}] Fix didn't resolve all errors, trying again...`);
            }
          } else {
            console.error(`[generate:${requestId}] ✗ GPT-4o-mini failed to provide fix for ${task.file}`);
            break; // Exit fix loop, will retry generation
          }
        } catch (fixErr: any) {
          console.error(`[generate:${requestId}] Error calling GPT-4o-mini fix:`, fixErr?.message || fixErr);
          break; // Exit fix loop, will retry generation
        }
      }
      
      // Check final compilation result
      if (compileResult.success) {
        console.log(`[generate:${requestId}] ✓ ${task.file} compiled successfully`);
        compilationSuccess = true;
        collected.push({ path: task.file, content: currentContent });
        // Extract component name from task (e.g., "Create Header component" -> "Header")
        const componentName = task.task.replace(/^Create\s+/i, '').replace(/\s+component$/i, '').trim();
        addStatus(requestId, 'components', `✓ ${componentName} component completed`, progress);
      } else {
        // If we still have errors after all fix attempts, log and continue loop to retry generation
        if (attempts < MAX_FIX_ATTEMPTS) {
          console.warn(`[generate:${requestId}] Still has errors after ${fixAttempts} fix attempts, will retry generation (attempt ${attempts + 1}/${MAX_FIX_ATTEMPTS})`);
        } else {
          console.error(`[generate:${requestId}] Max fix attempts reached for ${task.file}, moving on`);
        }
      }
    }
    
    if (!compilationSuccess) {
      console.error(`[generate:${requestId}] Failed to compile ${task.file} after ${attempts} attempts`);
      // Continue to next task anyway
    }
  }
  
  return {
    files: collected,
    rawResponses,
    compilationAttempts
  };
}

