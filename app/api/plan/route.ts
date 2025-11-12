import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import OpenAI from 'openai';

const openai = process.env.OPENAI_KEY ? new OpenAI({ apiKey: process.env.OPENAI_KEY }) : null;

/**
 * Multi-step planning endpoint for interactive project planning
 * 
 * Step 1: Generate page suggestions based on user prompt
 * Step 2: User selects pages
 * Step 3: User selects style
 * Step 4: User selects colors
 * Step 5: User uploads logo
 * Step 6: User provides additional info
 * Step 7: Build with all accumulated data
 */
export async function POST(req: Request) {
  try {
    const {
      step,
      userPrompt,
      selectedPages,
      selectedStyle,
      colors,
      logo,
      additionalInfo,
      projectId,
      requestId,
    } = await req.json();

    // Get authenticated user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID
        ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
        : 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC || 'placeholder-key',
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!openai) {
      return NextResponse.json({ error: 'OpenAI key not configured' }, { status: 500 });
    }

    // Step 1: Generate page suggestions
    if (step === 'suggest_pages') {
      const pageSuggestionPrompt = `You are an expert web application architect. Based on the user's prompt, suggest possible pages/routes that could be built for this application.

User prompt: "${userPrompt}"

Generate a JSON response with this structure:
{
  "suggested_pages": [
    {
      "id": "landing",
      "name": "Landing Page",
      "path": "/",
      "description": "Main landing page with hero, features, testimonials, etc.",
      "category": "core",
      "recommended": true,
      "complexity": 3
    },
    {
      "id": "about",
      "name": "About Page",
      "path": "/about",
      "description": "About page with company/team information",
      "category": "feature",
      "recommended": false,
      "complexity": 2
    }
  ]
}

Rules:
- If the user's prompt is GENERAL (e.g., "create a website", "build an app"), suggest ONLY a single landing page.
- If the user's prompt is SPECIFIC (e.g., "create a DEX with swap and liquidity pages"), suggest those specific pages PLUS a landing page.
- Always include at least one landing page (recommended: true).
- Suggest 3-8 possible pages maximum.
- Be specific about what each page would contain.
- Use clear, descriptive names and paths.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an expert web application architect. Return only valid JSON.' },
          { role: 'user', content: pageSuggestionPrompt },
        ],
      });

      const responseText = completion.choices[0]?.message?.content || '{}';
      const pageSuggestions = JSON.parse(responseText);

      return NextResponse.json({
        step: 'select_pages',
        suggestedPages: pageSuggestions.suggested_pages || [],
        message: 'Please select which pages you want to build:',
      });
    }

    // Step 2: Store selected pages and return style options
    if (step === 'select_style') {
      const styleOptions = [
        {
          id: 'neo_brutalism',
          name: 'Neo Brutalism',
          description: 'Bold, high-contrast design with heavy borders, bright colors, and sharp edges',
          preview: 'Bold borders, vibrant colors, strong shadows',
        },
        {
          id: 'gaming_3d',
          name: 'Gaming with 3D Objects',
          description: 'Dynamic gaming aesthetic with 3D elements, neon effects, and immersive visuals',
          preview: '3D graphics, neon glows, animated elements',
        },
        {
          id: 'defi_clean',
          name: 'DeFi Clean & Minimal',
          description: 'Clean, professional design perfect for DeFi applications with clear data visualization',
          preview: 'Minimalist, data-focused, professional',
        },
        {
          id: 'modern_gradient',
          name: 'Modern Gradient',
          description: 'Sleek modern design with smooth gradients, glassmorphism, and fluid animations',
          preview: 'Smooth gradients, glass effects, modern',
        },
        {
          id: 'custom',
          name: 'Custom Style',
          description: 'Let the AI choose the best style based on your project',
          preview: 'AI-selected style',
        },
      ];

      return NextResponse.json({
        step: 'select_style',
        styleOptions,
        message: 'Please select a style for your website:',
        selectedPages,
      });
    }

    // Step 3: Store selected style and return color selection UI
    if (step === 'select_colors') {
      const colorPalettes = [
        {
          id: 'default',
          name: 'Default Palette',
          colors: ['#3B82F6', '#8B5CF6', '#EC4899'],
        },
        {
          id: 'ocean',
          name: 'Ocean',
          colors: ['#0EA5E9', '#06B6D4', '#14B8A6'],
        },
        {
          id: 'sunset',
          name: 'Sunset',
          colors: ['#F97316', '#EF4444', '#EC4899'],
        },
        {
          id: 'forest',
          name: 'Forest',
          colors: ['#22C55E', '#10B981', '#059669'],
        },
        {
          id: 'purple',
          name: 'Purple Dream',
          colors: ['#A855F7', '#9333EA', '#7C3AED'],
        },
        {
          id: 'monochrome',
          name: 'Monochrome',
          colors: ['#1F2937', '#4B5563', '#6B7280'],
        },
      ];

      return NextResponse.json({
        step: 'select_colors',
        colorPalettes,
        message: 'Please select colors for your website:',
        selectedPages,
        selectedStyle,
      });
    }

    // Step 4: Store colors and return logo upload UI
    if (step === 'upload_logo') {
      return NextResponse.json({
        step: 'upload_logo',
        message: 'Upload your logo (optional):',
        selectedPages,
        selectedStyle,
        colors,
      });
    }

    // Step 5: Store logo and return additional info UI
    if (step === 'additional_info') {
      return NextResponse.json({
        step: 'additional_info',
        message: 'Any additional information about your website? (optional)',
        selectedPages,
        selectedStyle,
        colors,
        logo,
      });
    }

    // Step 6: Generate final plan and return it
    if (step === 'generate_plan') {
      const planPrompt = `You are an expert web application architect. Generate a complete application blueprint based on the following specifications:

User's Original Prompt: "${userPrompt}"
Selected Pages: ${JSON.stringify(selectedPages)}
Selected Style: ${selectedStyle}
Colors: ${JSON.stringify(colors)}
Additional Info: "${additionalInfo || 'None'}"

Generate a STRICT JSON plan with this structure:
{
  "summary": "Brief description of the application",
  "design_language": "${selectedStyle}",
  "colors": ${JSON.stringify(colors)},
  "routes": [
    {
      "name": "Landing Page",
      "path": "/",
      "purpose": "...",
      "sections": [...]
    }
  ],
  "components": [...],
  "data_models": [...],
  "task_flow": [...]
}

CRITICAL REQUIREMENTS:
- Build ONLY the pages selected by the user: ${selectedPages.map((p: any) => p.path).join(', ')}
- Apply the "${selectedStyle}" style consistently throughout
- Use the provided colors: ${colors.map((c: string) => c).join(', ')}
- Generate AI images for hero sections and key visuals (never use stock images)
- Only use Lucide React icons from the template
- Do NOT overengineer - create only necessary components
- Use shadcn/ui components from the template
- All components must have zero props
- Apply semantic Tailwind color tokens for light/dark mode`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an expert web application architect. Return only valid JSON.' },
          { role: 'user', content: planPrompt },
        ],
      });

      const planText = completion.choices[0]?.message?.content || '{}';
      const planJson = JSON.parse(planText);

      return NextResponse.json({
        step: 'ready_to_build',
        plan: planJson,
        message: 'Plan generated! Ready to build your application.',
        selectedPages,
        selectedStyle,
        colors,
        logo,
        additionalInfo,
      });
    }

    return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
  } catch (error: any) {
    console.error('Plan API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}


