import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
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

interface FixSuggestion {
  file: string;
  issues?: string[];
  fix: string;
  explanation: string;
}

interface AnalysisResult {
  analysis: string;
  fixes?: FixSuggestion[];
}

interface FixedFile {
  path: string;
  content: string;
  originalContent: string;
}

export async function POST(req: Request) {
  const startTime = Date.now();
  let tokensUsed = 0;

  try {
    console.log('🔧 POST /api/debug - Starting debug scan...');

    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Get authenticated user
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
    );

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get project files from database
    const { data: projectFiles, error: filesError } = await supabase
      .from('project_files')
      .select('path, content')
      .eq('project_id', projectId)
      .eq('user_id', userId);

    if (filesError || !projectFiles) {
      return NextResponse.json(
        { error: 'Failed to load project files' },
        { status: 500 }
      );
    }

    console.log(`📁 Loaded ${projectFiles.length} project files`);

    // Create Daytona sandbox for debugging
    const daytona = new Daytona({
      apiKey: process.env.DAYTONA_KEY || '',
      apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io'
    });

    const sandbox = await daytona.create({
      image: 'node:20-alpine',
      public: true,
      ephemeral: true,
    });
    const sandboxId = sandbox.id;
    console.log('✅ Debug sandbox created:', sandboxId);

    // Upload project files to sandbox
    console.log('📤 Uploading project files to debug sandbox...');
    for (const file of projectFiles) {
      const filePath = `/workspace/${file.path}`;
      await sandbox.fs.uploadFile(Buffer.from(file.content), filePath);
    }

    // Also upload package.json and other config files if they exist
    const configFiles = ['package.json', 'vite.config.ts', 'tsconfig.json', 'tailwind.config.js'];
    for (const configFile of configFiles) {
      try {
        const configContent = projectFiles.find(f => f.path === configFile)?.content;
        if (configContent) {
          await sandbox.fs.uploadFile(Buffer.from(configContent), `/workspace/${configFile}`);
        }
      } catch (e) {
        // Config file might not exist, skip
      }
    }

    // Install dependencies
    console.log('📦 Installing dependencies...');
    await sandbox.process.executeCommand('cd /workspace && npm install');

    // Run TypeScript check
    console.log('🔍 Running TypeScript analysis...');
    const tsCheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
    const tsErrors = tsCheckResult.result || '';

    // Run linting if ESLint config exists
    console.log('🔍 Running linting analysis...');
    const lintCheckResult = await sandbox.process.executeCommand('cd /workspace && npx eslint src --ext .ts,.tsx 2>&1 || true');
    const lintErrors = lintCheckResult.result || '';

    const hasErrors = tsErrors.includes('error TS') || lintErrors.includes('error');

    if (!hasErrors) {
      console.log('✅ No issues found - code is clean!');
      await daytona.delete(sandbox);
      return NextResponse.json({
        success: true,
        message: 'No issues found - your code is clean!',
        issues: []
      });
    }

    console.log('🚨 Issues detected, analyzing with AI...');

    // Combine errors for AI analysis
    const allErrors = `${tsErrors}\n\n${lintErrors}`.trim();

    // Analyze errors with AI
    const analysisPrompt = `
You are a senior TypeScript/React expert. Analyze these errors and provide fixes:

ERRORS FOUND:
${allErrors}

PROJECT FILES:
${projectFiles.map(f => `=== ${f.path} ===\n${f.content}\n`).join('\n')}

INSTRUCTIONS:
1. Identify the root cause of each error
2. Provide specific code fixes
3. Ensure fixes maintain functionality
4. Return ONLY valid JSON with this structure:

{
  "analysis": "Brief summary of issues found",
  "fixes": [
    {
      "file": "src/App.tsx",
      "issues": ["Type error description"],
      "fix": "corrected code here",
      "explanation": "Why this fixes the issue"
    }
  ]
}
`;

    const completion = await gemini.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{text: analysisPrompt}],
      config: {
        systemInstruction: "You are a TypeScript/React debugging expert. Analyze errors and provide precise fixes."
      }
    });

    let analysisResult: AnalysisResult;
    try {
      const analysisText = completion.text || '';
      const cleanedAnalysis = analysisText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      analysisResult = JSON.parse(cleanedAnalysis);
    } catch (parseError) {
      console.error('❌ Failed to parse AI analysis:', parseError);
      await daytona.delete(sandbox);
      return NextResponse.json({
        success: false,
        error: 'Failed to analyze code issues'
      }, { status: 500 });
    }

    console.log('🔧 Applying AI-suggested fixes...');

    // Apply fixes
    const fixedFiles: FixedFile[] = [];
    for (const fix of analysisResult.fixes || []) {
      const existingFile = projectFiles.find(f => f.path === fix.file);
      if (existingFile) {
        fixedFiles.push({
          path: fix.file,
          content: fix.fix,
          originalContent: existingFile.content
        });

        // Upload fixed file to sandbox
        const filePath = `/workspace/${fix.file}`;
        await sandbox.fs.uploadFile(Buffer.from(fix.fix), filePath);
        console.log(`✅ Applied fix to ${fix.file}`);
      }
    }

    // Re-run checks to verify fixes
    console.log('🔍 Re-verifying fixes...');
    const recheckResult = await sandbox.process.executeCommand('cd /workspace && npx tsc --noEmit 2>&1 || true');
    const remainingErrors = recheckResult.result || '';

    const stillHasErrors = remainingErrors.includes('error TS');

    // Build project to ensure it compiles
    console.log('🔨 Building project to verify fixes...');
    const buildResult = await sandbox.process.executeCommand('cd /workspace && npm run build');

    if (buildResult.result?.includes('error') || buildResult.result?.includes('Error')) {
      console.log('⚠️ Build still has issues after fixes');
    } else {
      console.log('✅ Build successful after fixes!');
    }

    // Clean up sandbox
    await daytona.delete(sandbox);

    // Update project with fixed files if build succeeded
    if (!stillHasErrors && !buildResult.result?.includes('error')) {
      console.log('💾 Saving fixed code to database...');
      const updatedFiles = projectFiles.map(existingFile => {
        const fixed = fixedFiles.find(f => f.path === existingFile.path);
        return fixed ? { ...existingFile, content: fixed.content } : existingFile;
      });

      await saveProjectFiles(projectId, updatedFiles);
      console.log('✅ Fixed code saved to database');
    }

    return NextResponse.json({
      success: true,
      analysis: analysisResult.analysis,
      fixesApplied: fixedFiles.length,
      remainingIssues: stillHasErrors,
      message: stillHasErrors
        ? 'Some issues remain - manual review recommended'
        : 'All issues fixed automatically!',
      fixes: fixedFiles.map(f => ({
        file: f.path,
        explanation: analysisResult.fixes?.find(fix => fix.file === f.path)?.explanation
      }))
    });

  } catch (error) {
    console.error('❌ Debug API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to debug code',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
