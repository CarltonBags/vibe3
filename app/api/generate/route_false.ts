import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import instruction from './systemPrompt-vite';
import { getTemplate, getTemplateFiles } from '@/lib/templates';
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

const createProjectName= async(prompt: string) => {
    const clean = prompt
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .split(" ")

    const stopwords = new Set(["make", "build", "create", "a", "the", "for", "my", "app", "website", "project", "please", "hey", "hello", "could", "would"]);
    const keywords = clean.filter(word => word && !stopwords.has(word));

    const base = keywords.slice(0, 3).join("-");

    const suffix = Math.random().toString(36).substring(2, 6);

    return `${base}-${suffix}` || `project-${suffix}`;

}

export async function POST (req: Request) {
    const startTime = Date.now()
    let projectId: string | null = null
    let tokensUsed = 0
    let projectName: string | null = null
    try {
      const body = await req.json() as { prompt?: string, templateId?: string };
      const { prompt, templateId } = body || {} as any;
      if (!prompt || !prompt.trim()) {
        return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
      }

      // Authenticated user
      const cookieStore = await cookies();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID 
          ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
          : 'https://placeholder.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC || 'placeholder-key',
        {
          cookies: {
            getAll() { return cookieStore.getAll() },
            setAll(cookiesToSet) { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          }
        }
      );
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized - Please sign in' }, { status: 401 });
      }
      const userId = session.user.id;

      // Limits
      const limits = await checkUserLimits(userId);
      if (!limits.canGenerate) {
        return NextResponse.json({ success: false, error: limits.reason, generationsRemaining: limits.generationsRemaining, upgradeRequired: true }, { status: 403 });
      }

      // Select template (modular). Default to Vite React.
      const selectedTemplateId = templateId || 'vite-react';
      const template = getTemplate(selectedTemplateId);
      const templateFiles = getTemplateFiles(template);
      const templatePackageJson = templateFiles['package.json'] || '{}';

      // Project name
      projectName = await createProjectName(prompt);

      // Phase 1: Create project plan via gpt-4o-mini
      const planSystem = `You are a meticulous project planner for a code generator. Return ONLY valid JSON (no markdown fences) describing the plan. Include keys app_summary, tech_stack, folders, files (path+purpose), components (name+props+description), build_plan (ordered steps). Use the provided template package.json to align dependencies.`;
      const planUser = {
        prompt: prompt.trim(),
        project_name: projectName,
        template: template.id,
        template_package_json: JSON.parse(templatePackageJson)
      };

      const planCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: planSystem },
          { role: 'user', content: JSON.stringify(planUser) }
        ],
        response_format: { type: 'json_object' }
      });
      const planRaw = planCompletion.choices[0]?.message?.content || '{}';
      tokensUsed += planCompletion.usage?.total_tokens || 0;
      let planJson: any;
      try { planJson = JSON.parse(planRaw); } catch { planJson = {}; }

      // Phase 2: Generate files via Gemini with full context
      const geminiPrompt = `You are generating a ${template.name} project. Follow the plan strictly and produce a JSON with {"files":[{"path":"...","content":"..."}],"summary":"..."}. Do not include markdown fences. Use TypeScript and Tailwind. Ensure JSX tags are matched and imports exist. Avoid external placeholder images; use SVG data URLs if needed.`;
      const buildContext = {
        plan: planJson,
        templateId: template.id,
        templatePackageJson: JSON.parse(templatePackageJson),
        requiredFilesHint: Object.keys(templateFiles).slice(0, 20) // hint, not strict
      };
      const gen = await gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: `${geminiPrompt}\n\nCONTEXT:\n${JSON.stringify(buildContext, null, 2)}` }],
        config: { systemInstruction: instruction.toString(), responseMimeType: 'application/json' as any }
      });
      let responseText = gen.text || '';

      // Parse files JSON robustly
      let filesData: { files: Array<{ path: string; content: string }>, summary?: string } | null = null;
      try {
        let cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*"files"[\s\S]*\}/);
        if (match) cleaned = match[0];
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
        filesData = JSON.parse(cleaned);
      } catch (e) {
        return NextResponse.json({ success: false, error: 'Failed to parse AI files JSON' }, { status: 500 });
      }
      if (!filesData || !filesData.files || !Array.isArray(filesData.files) || filesData.files.length === 0) {
        return NextResponse.json({ success: false, error: 'No files generated' }, { status: 500 });
      }
      // Unescape content
      filesData.files = filesData.files.map(f => ({
        path: f.path,
        content: (f.content || '')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      }));

      // Create project and save files to DB
      const project = await createProject(userId, projectName || `Project ${Date.now()}`, prompt, planJson?.app_summary || 'AI generated');
      projectId = project.id;
      await saveProjectFiles(projectId, filesData.files);
      await updateProject(projectId, { status: 'active' });

      // Usage/logging
      await incrementUsage(userId, tokensUsed, true);
      const duration = Date.now() - startTime;
      const cost = Math.round((tokensUsed / 1000000) * 0.60 * 100);
      await logGeneration(userId, projectId, prompt, tokensUsed, cost, duration, 'success');

      return NextResponse.json({
        success: true,
        projectId,
        files: filesData.files,
        summary: filesData.summary || planJson?.app_summary || 'Project initialized',
      });

    } catch (error) {
      return NextResponse.json({ success: false, error: (error as Error)?.message || 'Failed to generate project' }, { status: 500 });
    }
}