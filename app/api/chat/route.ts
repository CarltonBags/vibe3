/**
 * Unified Chat API Route
 * Handles both generation and amendments through tool-based system
 * Similar to Lovable.dev's architecture
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import {
  checkUserLimits,
  incrementUsage,
  createProject,
  updateProject,
  getUserWithTier,
  getProjectFiles,
  getProjectById,
  getConversationHistory,
  saveConversationMessages
} from '@/lib/db';
import { getToolContext, executeTool } from '@/lib/tool-orchestrator';
import { addStatus } from '@/lib/status-tracker';
import instruction from './systemPrompt';
import { convertMessagesToGemini, extractFunctionCalls, getGeminiText } from './gemini-helper';
import { executeSequentialWorkflow, Task } from '@/app/api/generate/sequential-workflow';

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_KEY
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

//vreates a project name out of the user's message
const PROJECT_NAME_STOP_WORDS = new Set([
  'build',
  'create',
  'make',
  'generate',
  'design',
  'produce',
  'develop',
  'draft',
  'write',
  'craft',
  'for',
  'with',
  'and',
  'the',
  'a',
  'an',
  'to',
  'my',
  'your',
  'our',
  'their',
  'this',
  'that',
  'project',
  'app',
  'application',
  'website',
  'site',
  'platform',
  'please',
  'new',
  'from',
  'about',
  'of',
  'in',
  'on'
]);

function titleizeWord(word: string): string {
  if (!word) return word;
  if (word === word.toUpperCase()) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function deriveProjectName(message: string): string {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return 'New Project';
  }

  const tokens = Array.from(message.matchAll(/\b[A-Za-z0-9]{2,}\b/g)).map((match) => match[0]);
  if (tokens.length === 0) {
    return 'New Project';
  }

  const filtered = tokens.filter((token) => !PROJECT_NAME_STOP_WORDS.has(token.toLowerCase()));
  const selected = (filtered.length > 0 ? filtered : tokens).slice(0, 4);

  const candidate = selected.map(titleizeWord).join(' ').trim();
  if (!candidate) {
    return 'New Project';
  }

  return candidate.length > 48 ? `${candidate.slice(0, 45).trim()}…` : candidate;
}

const PROJECT_METADATA_RELATIVE_PATH = 'src/project-metadata.json';
const PROJECT_METADATA_ABSOLUTE_PATH = `/workspace/${PROJECT_METADATA_RELATIVE_PATH}`;

type ProjectFileRecord = {
  file_path: string;
  file_content: string;
};

type PlanColorPalette = {
  background?: string;
  card?: string;
  accent?: string;
  ['primary-dark']?: string;
  [key: string]: string | undefined;
};

function buildTaskFlowFromPlan(planJson: any): Task[] {
  const tasks: Task[] = [];
  if (!planJson) return tasks;

  try {
    if (Array.isArray(planJson.task_flow)) {
      planJson.task_flow
        .map((t: any) => ({
          step: t.step || 0,
          task: t.task || '',
          file: t.file || '',
          description: t.description || '',
          dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        }))
        .sort((a: Task, b: Task) => a.step - b.step)
        .forEach((task: Task) => {
          if (task.file) {
            tasks.push(task);
          }
        });
      return tasks;
    }

    const types = Array.isArray(planJson.types) ? planJson.types : [];
    const components = Array.isArray(planJson.components) ? planJson.components : [];
    let stepCounter = 1;

    types.forEach((type: any) => {
      if (type?.file) {
        tasks.push({
          step: stepCounter++,
          task: `Create ${type.name || 'type'} definitions`,
          file: type.file,
          description: type.description || `Define ${type.name} interface`,
          dependencies: [],
        });
      }
    });

    components.forEach((component: any) => {
      if (component?.file && !component.file.includes('App.tsx')) {
        tasks.push({
          step: stepCounter++,
          task: `Create ${component.name || 'component'}`,
          file: component.file,
          description:
            component.description || `Create ${component.name} component using shadcn/ui primitives with zero props`,
          dependencies: types.map((type: any) => type?.file).filter(Boolean),
        });
      }
    });
  } catch (error) {
    console.error('[chat] Failed to build task flow from plan:', error);
  }

  return tasks;
}

function buildProjectSummary(existingFiles: ProjectFileRecord[]): string {
  const summary: {
    routes: Array<{ path: string; element: string }>;
    pages: string[];
    components: string[];
  } = {
    routes: [],
    pages: [],
    components: [],
  };

  try {
    const appFile = existingFiles.find((file) => file.file_path === 'src/App.tsx');
    if (appFile?.file_content) {
      const routeRegex = /<Route\s+path="([^"]+)"\s+element={<([\w./]+)}/g;
      let match: RegExpExecArray | null;
      while ((match = routeRegex.exec(appFile.file_content)) !== null) {
        summary.routes.push({ path: match[1], element: match[2] });
      }
    }

    summary.pages = existingFiles
      .filter((file) => file.file_path.startsWith('src/pages/') && file.file_path.endsWith('.tsx'))
      .map((file) => file.file_path.replace('src/pages/', ''));

    summary.components = existingFiles
      .filter((file) => file.file_path.startsWith('src/components/') && file.file_path.endsWith('.tsx'))
      .map((file) => file.file_path.replace('src/components/', ''));
  } catch (err) {
    console.error('[chat] Failed to build project summary:', err);
  }

  return JSON.stringify(summary, null, 2);
}

function applyPlanColorPalette(
  planJson: any,
  projectMetadata: ProjectMetadata | null,
  projectMetadataChanged: boolean
): { metadata: ProjectMetadata | null; changed: boolean } {
  if (!projectMetadata) {
    return { metadata: projectMetadata, changed: projectMetadataChanged };
  }

  try {
    const palette: PlanColorPalette | null =
      planJson?.visual_guidelines?.color_palette && typeof planJson.visual_guidelines.color_palette === 'object'
        ? planJson.visual_guidelines.color_palette
        : null;

    if (!palette) {
      return { metadata: projectMetadata, changed: projectMetadataChanged };
    }

    const brand = { ...projectMetadata.brand };
    let changed = false;

    const normalizedHex = (value: string | undefined): string | null => {
      if (!value || typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
        return trimmed.toUpperCase();
      }
      return null;
    };

    const primary = normalizedHex(palette.accent);
    if (primary && brand.primaryColor !== primary) {
      brand.primaryColor = primary;
      changed = true;
    }

    const secondary = normalizedHex(palette['primary-dark'] || palette.card);
    if (secondary && brand.secondaryColor !== secondary) {
      brand.secondaryColor = secondary;
      changed = true;
    }

    const accentCandidates: string[] = [];
    const background = normalizedHex(palette.background);
    const card = normalizedHex(palette.card);
    const accentAlt = normalizedHex(palette['accent-alt']);

    [background, card, accentAlt].forEach((hex) => {
      if (hex && !accentCandidates.includes(hex)) {
        accentCandidates.push(hex);
      }
    });

    if (primary && !accentCandidates.includes(primary)) {
      accentCandidates.push(primary);
    }
    if (secondary && !accentCandidates.includes(secondary)) {
      accentCandidates.push(secondary);
    }

    const filteredAccents = accentCandidates.slice(0, 4);
    if (
      filteredAccents.length > 0 &&
      (brand.accentColors.length !== filteredAccents.length ||
        filteredAccents.some((hex, index) => brand.accentColors[index] !== hex))
    ) {
      brand.accentColors = filteredAccents;
      changed = true;
    }

    if (changed) {
      projectMetadata.brand = brand;
    }

    return { metadata: projectMetadata, changed: projectMetadataChanged || changed };
  } catch (paletteError) {
    console.error('[chat] Failed to apply color palette from plan:', paletteError);
    return { metadata: projectMetadata, changed: projectMetadataChanged };
  }
}

/**
 * Distills the stored plan into a lightweight excerpt so planner updates stay within token limits.
 */
function buildExistingPlanExcerpt(plan: any): any {
  if (!plan || typeof plan !== 'object') return null;
  return {
    summary: plan.summary ?? null,
    design_language: plan.design_language ?? null,
    tone: plan.tone ?? null,
    visual_guidelines: plan.visual_guidelines ?? null,
    routes: Array.isArray(plan.routes) ? plan.routes : [],
    components: Array.isArray(plan.components) ? plan.components : [],
    data_models: Array.isArray(plan.data_models) ? plan.data_models : [],
    task_flow: Array.isArray(plan.task_flow) ? plan.task_flow : [],
  };
}

function mergeRoutesWithPrior(
  currentRoutes: any[],
  previousRoutes: any[]
): { routes: any[]; restoredCount: number; changed: boolean } {
  const currentByPath = new Map<string, any>();
  const restored: any[] = [];

  (currentRoutes || []).forEach((route) => {
    if (!route) return;
    const key = typeof route.path === 'string' ? route.path : route.name || '';
    if (key) currentByPath.set(key, route);
  });

  let changed = false;
  for (const prior of previousRoutes || []) {
    if (!prior) continue;
    const key = typeof prior.path === 'string' ? prior.path : prior.name || '';
    if (!key) continue;

    const existing = currentByPath.get(key);
    if (!existing) {
      currentByPath.set(key, prior);
      restored.push(prior);
      changed = true;
      continue;
    }

    const currentSections = Array.isArray(existing.sections) ? existing.sections : [];
    if (currentSections.length === 0 && Array.isArray(prior.sections) && prior.sections.length > 0) {
      existing.sections = prior.sections;
      restored.push(prior);
      changed = true;
    }
  }

  return {
    routes: Array.from(currentByPath.values()),
    restoredCount: restored.length,
    changed,
  };
}

function deepMergeExistingPlan(prior: any, current: any): any {
  if (!prior || typeof prior !== 'object') {
    return current || {};
  }
  const merged: any = { ...(current || {}) };

  if (!Array.isArray(merged.components) || merged.components.length === 0) {
    if (Array.isArray(prior.components) && prior.components.length > 0) {
      merged.components = prior.components;
      console.log('[plan] Restored components array from prior plan.');
    }
  }

  if (!Array.isArray(merged.task_flow) || merged.task_flow.length === 0) {
    if (Array.isArray(prior.task_flow) && prior.task_flow.length > 0) {
      merged.task_flow = prior.task_flow;
      console.log('[plan] Restored task_flow from prior plan.');
    }
  }

  if (!Array.isArray(merged.routes) || merged.routes.length === 0) {
    if (Array.isArray(prior.routes) && prior.routes.length > 0) {
      merged.routes = prior.routes;
      console.log('[plan] Restored routes array from prior plan.');
    }
  }

  return merged;
}

function buildFallbackPlan(
  requestId: string,
  userPrompt: string,
  template: string
): { planJson: any; planString: string } {
  const projectName = deriveProjectName(userPrompt || 'New Project');
  const lowerPrompt = (userPrompt || '').toLowerCase();
  const includesSwap = lowerPrompt.includes('swap');
  const includesLiquidity = lowerPrompt.includes('liquidity');
  const includesDashboard = lowerPrompt.includes('dashboard');
  const includesPricing = lowerPrompt.includes('pricing');
  const includesTestimonials = lowerPrompt.includes('testimonial');

  const baseHeroStatement = `Experience ${projectName} with a cinematic interface that feels alive and trustworthy.`;

  const homeSections = [
    {
      id: 'hero',
      headline: `${projectName}: next-level digital experience`,
      narrative:
        'Deliver a dramatic hero fold with layered gradients, animated badges, and a primary CTA that drives immediate engagement.',
      ui_elements: [
        'gradient hero background',
        'floating badge row',
        'primary and secondary CTAs',
        'metrics chips'
      ],
      interactions: [
        'Hover reveals on CTA buttons',
        'Scroll cue animation to encourage exploration'
      ],
      lucide_icons: ['Sparkles', 'Rocket', 'ArrowRight'],
      animation: 'Parallax glow layers with particle drift',
      color_story: 'bg-primary to bg-secondary gradient with accent-emerald outlines',
      data_sources: ['hero_metrics', 'features'],
      image_prompt: `Cinematic wide hero for ${projectName} with futuristic lighting, immersive gradients, and product UI holograms`
    },
    {
      id: 'feature_showcase',
      headline: 'Powerful capabilities built for ambitious teams',
      narrative:
        'Display feature tiles with iconography, badges, and descriptive copy that proves depth immediately.',
      ui_elements: [
        '3x2 feature grid with depth',
        'iconic badges per feature',
        'hover-lift card animation'
      ],
      interactions: [
        'Feature card hover elevates with glow',
        'Optional Learn More micro-interaction'
      ],
      lucide_icons: ['Layers', 'ShieldCheck', 'Zap'],
      animation: 'Card hover scaling with background glow',
      color_story: 'bg-card with accent-blue and accent-purple border treatments',
      data_sources: ['features']
    },
    {
      id: 'metrics',
      headline: 'Proof that momentum is real',
      narrative:
        'A strip of animated counters and comparison stats to build trust with quantifiable wins.',
      ui_elements: [
        'animated counter row',
        'comparison badge group',
        'progress gradient bar'
      ],
      interactions: [
        'Counters animate on scroll',
        'Hover reveals micro copy for each metric'
      ],
      lucide_icons: ['BarChart3', 'TrendingUp', 'Activity'],
      animation: 'Count-up motion with subtle shimmer',
      color_story: 'dark surfaces with accent-lime highlights',
      data_sources: ['metrics']
    },
    {
      id: 'solution_overview',
      headline: 'Workflow built around real outcomes',
      narrative:
        'Explain the multi-step journey using cards, timeline chips, and callouts aligned to primary use cases.',
      ui_elements: [
        'timeline cards with icons',
        'callout badges per phase',
        'supporting illustration tile'
      ],
      interactions: [
        'Timeline cards highlight on hover',
        'CTA button inside final card triggers modal in future iterations'
      ],
      lucide_icons: ['Workflow', 'Target', 'CheckCircle2'],
      animation: 'Timeline connector glows during hover',
      color_story: 'bg-muted with accent-amber connectors',
      data_sources: ['workflow_steps']
    },
    {
      id: 'testimonials',
      headline: 'Loved by pioneers pushing the boundary',
      narrative:
        'Carousel of client quotes with avatar, company, and proof badges to validate credibility.',
      ui_elements: [
        'testimonial carousel',
        'avatar with gradient ring',
        'quote highlight typography'
      ],
      interactions: [
        'Auto-play carousel with manual controls',
        'Keyboard navigation support'
      ],
      lucide_icons: ['Quote', 'Star', 'Handshake'],
      animation: 'Slide-in transitions with blur reveal',
      color_story: 'bg-card with accent-gold underline treatments',
      data_sources: ['testimonials']
    },
    {
      id: 'faq',
      headline: 'Answers that remove every barrier',
      narrative:
        'Accordion with rich answers, inline callouts, and contact micro-CTA for additional support.',
      ui_elements: [
        'accordion list',
        'inline badge callouts',
        'support CTA chip'
      ],
      interactions: [
        'Accordion expand/collapse with smooth motion',
        'Keyboard accessible toggles'
      ],
      lucide_icons: ['HelpCircle', 'ChevronDown', 'Phone'],
      animation: 'Accordion content slides with fade',
      color_story: 'bg-muted with accent-cyan separators',
      data_sources: ['faqs']
    },
    {
      id: 'primary_call_to_action',
      headline: 'Ready to launch something unforgettable?',
      narrative:
        'High-energy CTA block with gradient panel, benefit bullets, and secondary reassurance text.',
      ui_elements: [
        'gradient CTA panel',
        'button group',
        'reassurance bullet list'
      ],
      interactions: [
        'Primary CTA hover with glow trail',
        'Secondary CTA toggles contact modal (future)'
      ],
      lucide_icons: ['Flame', 'ArrowRightCircle', 'Shield'],
      animation: 'Glow pulse on idle CTA',
      color_story: 'accent-purple with accent-mint button glow',
      data_sources: ['cta_content']
    }
  ];

  const secondaryRoutes: any[] = [];

  if (includesSwap) {
    secondaryRoutes.push({
      name: 'Swap',
      path: '/swap',
      purpose: 'Let users exchange assets with confidence and clarity.',
      primary_actions: ['Execute swap', 'Adjust slippage', 'Review route'],
      wow_moment: 'Live price impact visual and multi-hop route preview.',
      layout: 'Two-column layout with sticky review panel on the right.',
      hero_statement: 'Trade any asset in seconds with transparency baked in.',
      sections: [
        {
          id: 'swap_form',
          headline: 'Instant swaps with pro-grade controls',
          narrative:
            'Form with token selectors, amount fields, and slippage controls backed by responsive validation.',
          ui_elements: [
            'token select combobox',
            'amount numeric inputs',
            'slippage slider',
            'swap direction toggle'
          ],
          interactions: [
            'Swap direction toggles values inline',
            'Slippage slider updates confirmation copy dynamically'
          ],
          lucide_icons: ['Repeat2', 'ArrowLeftRight', 'Settings2'],
          animation: 'Swap arrow animates on hover',
          color_story: 'bg-card with accent-cyan borders',
          data_sources: ['swap_tokens', 'swap_preferences'],
          image_prompt: `Dynamic dashboard visualization of crypto asset swap UI for ${projectName}`
        },
        {
          id: 'market_overview',
          headline: 'Market depth and route insights',
          narrative:
            'Visualize price impact, route hops, and historical performance in a compressed card grid.',
          ui_elements: [
            'route breakdown card',
            'price impact meter',
            'mini depth chart'
          ],
          interactions: [
            'Hover over route entries reveals breakdown tooltip',
            'Chart animates data updates'
          ],
          lucide_icons: ['LineChart', 'Compass', 'Gauge'],
          animation: 'Chart lines animate on load',
          color_story: 'dark panels with accent-lime indicators',
          data_sources: ['market_stats']
        }
      ]
    });
  }

  if (includesLiquidity) {
    secondaryRoutes.push({
      name: 'Liquidity',
      path: '/liquidity',
      purpose: 'Manage pools and monitor yields effortlessly.',
      primary_actions: ['Provide liquidity', 'Withdraw', 'Track earnings'],
      wow_moment: 'Animated ROI projections and pool health indicators.',
      layout: 'Card dashboard with sticky summary bar.',
      hero_statement: 'Stay in control of pool performance with precision.',
      sections: [
        {
          id: 'pool_overview',
          headline: 'Your pools at a glance',
          narrative: 'Cards summarizing positions, fees earned, and APR trends.',
          ui_elements: [
            'pool summary cards',
            'earnings trend chart',
            'status badges'
          ],
          interactions: [
            'Hover cards reveal detail breakdown',
            'Chart allows timeframe toggles'
          ],
          lucide_icons: ['Droplet', 'Coins', 'TrendingUp'],
          animation: 'Card glow on hover, chart animated lines',
          color_story: 'bg-card with accent-teal highlights',
          data_sources: ['liquidity_positions'],
          image_prompt: `Stylized liquidity dashboard illustrating pool analytics for ${projectName}`
        },
        {
          id: 'manage_liquidity',
          headline: 'Take action with confidence',
          narrative: 'Accordion or tabs for deposit/withdraw with safeguards.',
          ui_elements: [
            'tabbed action cards',
            'form inputs with validation',
            'confirmation drawer'
          ],
          interactions: [
            'Tabs animate between deposit/withdraw flows',
            'Confirmation drawer slides up with summary'
          ],
          lucide_icons: ['Wallet', 'ShieldCheck', 'HandCoins'],
          animation: 'Drawer slides with shadow reveal',
          color_story: 'bg-muted with accent-gold CTAs',
          data_sources: ['liquidity_actions']
        }
      ]
    });
  }

  if (includesDashboard || includesPricing) {
    secondaryRoutes.push({
      name: includesDashboard ? 'Dashboard' : 'Pricing',
      path: includesDashboard ? '/dashboard' : '/pricing',
      purpose: includesDashboard
        ? 'Provide a snapshot of KPIs, growth, and tasks.'
        : 'Outline subscription tiers with comparative value.',
      primary_actions: includesDashboard
        ? ['Filter metrics', 'Review alerts', 'Download report']
        : ['Select plan', 'Compare tiers', 'Start trial'],
      wow_moment: includesDashboard
        ? 'Animated metric grid and actionable notifications.'
        : 'Plan cards that morph on hover with gradient halos.',
      layout: includesDashboard ? 'Dashboard grid with charts and tables.' : 'Pricing card trio with toggles.',
      hero_statement: includesDashboard
        ? 'Monitor live KPIs with clarity.'
        : 'Choose the plan that unlocks your next milestone.',
      sections: includesDashboard
        ? [
            {
              id: 'kpi_grid',
              headline: 'Performance snapshot',
              narrative: 'KPIs with comparison deltas and icons.',
              ui_elements: [
                'metric grid',
                'delta badges',
                'alert chips'
              ],
              interactions: [
                'Hover reveals detailed tooltip',
                'Filter toggles adjust visible metrics'
              ],
              lucide_icons: ['Activity', 'Sparkle', 'BellRing'],
              animation: 'Counters animate, alerts pulse gently',
              color_story: 'bg-card with accent-emerald highlights',
              data_sources: ['metrics']
            },
            {
              id: 'task_timeline',
              headline: 'Stay ahead of the curve',
              narrative: 'Timeline of key initiatives with owners and due dates.',
              ui_elements: [
                'timeline list',
                'owner avatars',
                'status badges'
              ],
              interactions: [
                'Timeline expands on click',
                'Keyboard navigation friendly'
              ],
              lucide_icons: ['CalendarClock', 'Users', 'Timer'],
              animation: 'Timeline connectors glow on hover',
              color_story: 'bg-muted with accent-purple connectors',
              data_sources: ['tasks']
            }
          ]
        : [
            {
              id: 'plan_cards',
              headline: 'Plans that scale with you',
              narrative: 'Three plan cards with badges, feature bullets, and CTA buttons.',
              ui_elements: [
                'tier card trio',
                'toggle for monthly/yearly',
                'comparison checklist'
              ],
              interactions: [
                'Toggle animates price changes',
                'Hover card raises with glow outline'
              ],
              lucide_icons: ['Layers', 'Gem', 'Sparkles'],
              animation: 'Card hover with glow and slight tilt',
              color_story: 'bg-card with accent-rose and accent-indigo',
              data_sources: ['pricing_plans'],
              image_prompt: `Vibrant pricing plan layout for ${projectName} with futuristic gradients`
            },
            {
              id: 'faq_support',
              headline: 'Need custom enterprise options?',
              narrative: 'Compact FAQ list with direct contact CTA.',
              ui_elements: [
                'mini accordion',
                'contact pill button',
                'support badge'
              ],
              interactions: [
                'Accordion toggles with smooth transitions',
                'Contact button opens support flow'
              ],
              lucide_icons: ['LifeBuoy', 'Headset', 'MessageCircle'],
              animation: 'Support badge pulses lightly',
              color_story: 'bg-muted with accent-cyan text',
              data_sources: ['faqs']
            }
          ]
    });
  }

  const allRoutes = [
    {
      name: 'Home',
      path: '/',
      purpose: 'Present the core story, value, and social proof of the product.',
      primary_actions: ['Start building', 'Explore features', 'Contact team'],
      wow_moment: 'Hero animation with layered gradients and interactive CTAs.',
      layout: 'Stacked sections with full-bleed visuals and anchored navigation.',
      hero_statement: baseHeroStatement,
      sections: homeSections
    },
    ...secondaryRoutes
  ];

  const componentsSet: Record<string, any> = {};

  const addComponent = (file: string, component: any) => {
    if (!componentsSet[file]) {
      componentsSet[file] = component;
    }
  };

  addComponent('src/components/LayoutShell.tsx', {
    name: 'LayoutShell',
    file: 'src/components/LayoutShell.tsx',
    purpose: 'Provides global layout wrapper that renders Header, Outlet content, and Footer with background gradients.',
    child_elements: ['header', 'main content outlet via <Outlet />', 'footer', 'background gradients'],
    shadcn_primitives: ['navigation-menu', 'button', 'sheet'],
    lucide_icons: ['Menu', 'Sun', 'Moon'],
    data_dependencies: [],
    zero_props_justification: 'Layout pulls from context and plan data; no external props required.',
    light_mode_semantics: ['bg-background', 'text-foreground', 'border-border'],
    dark_mode_semantics: ['dark:bg-background', 'dark:text-foreground', 'dark:border-border'],
    button_tokens: {
      primary: ['bg-primary', 'text-primary-foreground', 'hover:bg-primary-dark'],
      secondary: ['bg-muted', 'text-muted-foreground', 'hover:bg-muted/80']
    }
  });

  addComponent('src/components/HeroSection.tsx', {
    name: 'HeroSection',
    file: 'src/components/HeroSection.tsx',
    purpose:
      'First-fold hero with layered visuals, CTA buttons, metrics, and supporting badges.',
    child_elements: ['headline', 'supporting text', 'cta buttons', 'metric chips', 'hero art'],
    shadcn_primitives: ['badge', 'button', 'card'],
    lucide_icons: ['Sparkles', 'Rocket', 'ArrowRight'],
    data_dependencies: ['hero_metrics'],
    zero_props_justification: 'All copy and metrics sourced from plan metadata; no runtime props.',
    light_mode_semantics: ['bg-card', 'text-foreground', 'text-muted-foreground', 'border-border'],
    dark_mode_semantics: ['dark:bg-card', 'dark:text-foreground', 'dark:text-muted-foreground'],
    button_tokens: {
      primary: ['bg-accent-blue', 'text-foreground', 'hover:bg-accent-blue/90'],
      secondary: ['bg-transparent', 'text-foreground', 'border-border', 'hover:bg-muted/40']
    },
    image_prompt: `Vivid hero art for ${projectName} featuring futuristic UI holograms and neon gradients`
  });

  addComponent('src/components/FeatureGrid.tsx', {
    name: 'FeatureGrid',
    file: 'src/components/FeatureGrid.tsx',
    purpose: 'Display feature cards with iconography, badges, and supportive copy.',
    child_elements: ['card grid', 'icon badges', 'description paragraphs', 'cta links'],
    shadcn_primitives: ['card', 'badge', 'tooltip'],
    lucide_icons: ['Layers', 'ShieldCheck', 'Zap'],
    data_dependencies: ['features'],
    zero_props_justification: 'Feature data loaded internally from plan dataset.',
    light_mode_semantics: ['bg-card', 'text-foreground', 'border-border'],
    dark_mode_semantics: ['dark:bg-card', 'dark:text-foreground', 'dark:border-border'],
    button_tokens: {
      primary: ['bg-primary', 'text-primary-foreground', 'hover:bg-primary-dark']
    }
  });

  addComponent('src/components/MetricsStrip.tsx', {
    name: 'MetricsStrip',
    file: 'src/components/MetricsStrip.tsx',
    purpose: 'Animated counter strip for key product metrics.',
    child_elements: ['metric item', 'icon chip', 'delta badge'],
    shadcn_primitives: ['card', 'badge'],
    lucide_icons: ['BarChart3', 'TrendingUp', 'Activity'],
    data_dependencies: ['metrics'],
    zero_props_justification: 'Metrics stored locally; no parent props needed.',
    light_mode_semantics: ['bg-muted', 'text-foreground'],
    dark_mode_semantics: ['dark:bg-muted', 'dark:text-foreground']
  });

  addComponent('src/components/TestimonialsCarousel.tsx', {
    name: 'TestimonialsCarousel',
    file: 'src/components/TestimonialsCarousel.tsx',
    purpose: 'Carousel showcasing testimonial quotes with avatars.',
    child_elements: ['carousel container', 'quote card', 'avatar ring', 'navigation controls'],
    shadcn_primitives: ['card', 'button', 'avatar'],
    lucide_icons: ['Quote', 'Star', 'ChevronRight'],
    data_dependencies: ['testimonials'],
    zero_props_justification: 'Testimonials defined within module data arrays.',
    light_mode_semantics: ['bg-card', 'text-foreground'],
    dark_mode_semantics: ['dark:bg-card', 'dark:text-foreground']
  });

  addComponent('src/components/FaqAccordion.tsx', {
    name: 'FaqAccordion',
    file: 'src/components/FaqAccordion.tsx',
    purpose: 'Accordion to display FAQs with contact callout.',
    child_elements: ['accordion container', 'question button', 'answer panel', 'support CTA'],
    shadcn_primitives: ['accordion', 'button', 'badge'],
    lucide_icons: ['HelpCircle', 'ChevronDown', 'MessageSquare'],
    data_dependencies: ['faqs'],
    zero_props_justification: 'FAQ entries loaded within component scope.',
    light_mode_semantics: ['bg-muted', 'text-foreground', 'border-border'],
    dark_mode_semantics: ['dark:bg-muted', 'dark:text-foreground', 'dark:border-border'],
    button_tokens: {
      primary: ['bg-accent-green', 'text-foreground', 'hover:bg-accent-green/90']
    }
  });

  addComponent('src/components/CallToActionBanner.tsx', {
    name: 'CallToActionBanner',
    file: 'src/components/CallToActionBanner.tsx',
    purpose: 'Final CTA strip with gradient panel and buttons.',
    child_elements: ['headline stack', 'benefit bullets', 'button group'],
    shadcn_primitives: ['card', 'button'],
    lucide_icons: ['Flame', 'ArrowRightCircle'],
    data_dependencies: ['cta_content'],
    zero_props_justification: 'CTA text defined alongside component, no props needed.',
    light_mode_semantics: ['bg-accent-purple', 'text-primary-foreground'],
    dark_mode_semantics: ['dark:bg-accent-purple', 'dark:text-primary-foreground'],
    button_tokens: {
      primary: ['bg-primary', 'text-primary-foreground', 'hover:bg-primary-dark'],
      secondary: ['bg-transparent', 'text-primary-foreground', 'border-primary', 'hover:bg-primary/10']
    }
  });

  addComponent('src/components/Header.tsx', {
    name: 'Header',
    file: 'src/components/Header.tsx',
    purpose: 'Responsive navigation with logo, menu, and theme toggle.',
    child_elements: ['logo mark', 'nav links', 'theme toggle', 'wallet button'],
    shadcn_primitives: ['navigation-menu', 'button', 'dropdown-menu'],
    lucide_icons: ['Gamepad2', 'Menu', 'Sun'],
    data_dependencies: [],
    zero_props_justification: 'Links and labels defined within component.',
    light_mode_semantics: ['bg-background', 'text-foreground'],
    dark_mode_semantics: ['dark:bg-background', 'dark:text-foreground'],
    button_tokens: {
      primary: ['bg-accent-blue', 'text-foreground', 'hover:bg-accent-blue/80']
    }
  });

  addComponent('src/components/Footer.tsx', {
    name: 'Footer',
    file: 'src/components/Footer.tsx',
    purpose: 'Footer with navigation columns and social buttons.',
    child_elements: ['brand tagline', 'link columns', 'social buttons'],
    shadcn_primitives: ['button', 'separator'],
    lucide_icons: ['Twitter', 'Github', 'Linkedin'],
    data_dependencies: [],
    zero_props_justification: 'Footer content lives inside component, no props.',
    light_mode_semantics: ['bg-background', 'text-muted-foreground'],
    dark_mode_semantics: ['dark:bg-background', 'dark:text-muted-foreground']
  });

  addComponent('src/App.tsx', {
    name: 'AppShell',
    file: 'src/App.tsx',
    purpose:
      'Root application shell that wraps BrowserRouter, registers LayoutShell as the parent route, and delegates nav/footer rendering to LayoutShell (do NOT render Header/Footer here).',
    child_elements: ['helmet metadata', 'browser router', 'parent route with LayoutShell', 'nested routes for all pages'],
    shadcn_primitives: ['navigation-menu', 'button'],
    lucide_icons: ['Sparkles', 'ArrowRight'],
    data_dependencies: ['hero_metrics', 'features', 'metrics', 'testimonials', 'faqs'],
    zero_props_justification: 'App composes internal pages and layout; it receives no props.',
    light_mode_semantics: ['bg-background', 'text-foreground'],
    dark_mode_semantics: ['dark:bg-background', 'dark:text-foreground'],
    implementation_notes:
      'Import LayoutShell from "@/components/LayoutShell" plus each page component. Wrap Routes with BrowserRouter (main.tsx handles providers). Declare <Route path="/" element={<LayoutShell />}> and nest Home plus secondary routes using <Route index ...>. Export default App.'
  });

  if (includesSwap) {
    addComponent('src/pages/Swap.tsx', {
      name: 'SwapPage',
      file: 'src/pages/Swap.tsx',
      purpose: 'Page containing swap interface, market overview, and action drawer.',
      child_elements: ['swap form section', 'market cards', 'sticky review panel'],
      shadcn_primitives: ['card', 'input', 'select', 'tabs', 'button', 'badge'],
      lucide_icons: ['Repeat2', 'ArrowLeftRight', 'LineChart'],
      data_dependencies: ['swap_tokens', 'market_stats'],
      zero_props_justification: 'Swap state managed inside component using local data mocks.',
      light_mode_semantics: ['bg-background', 'text-foreground'],
      dark_mode_semantics: ['dark:bg-background', 'dark:text-foreground'],
      button_tokens: {
        primary: ['bg-accent-cyan', 'text-foreground', 'hover:bg-accent-cyan/80']
      }
    });
  }

  if (includesLiquidity) {
    addComponent('src/pages/Liquidity.tsx', {
      name: 'LiquidityPage',
      file: 'src/pages/Liquidity.tsx',
      purpose: 'Page to manage and visualize liquidity pools.',
      child_elements: ['pool summary grid', 'earnings chart', 'actions tabs'],
      shadcn_primitives: ['card', 'tabs', 'form', 'button', 'badge'],
      lucide_icons: ['Droplet', 'Coins', 'TrendingUp'],
      data_dependencies: ['liquidity_positions', 'liquidity_actions'],
      zero_props_justification: 'Data seeded internally; no props.',
      light_mode_semantics: ['bg-background', 'text-foreground'],
      dark_mode_semantics: ['dark:bg-background', 'dark:text-foreground']
    });
  }

  if (includesDashboard) {
    addComponent('src/pages/Dashboard.tsx', {
      name: 'DashboardPage',
      file: 'src/pages/Dashboard.tsx',
      purpose: 'Executive dashboard showing KPIs and task timeline.',
      child_elements: ['metric grid', 'alerts list', 'timeline'],
      shadcn_primitives: ['card', 'table', 'badge', 'scroll-area'],
      lucide_icons: ['Activity', 'Bell', 'Timer'],
      data_dependencies: ['metrics', 'tasks'],
      zero_props_justification: 'Dashboard loads mock data from module scope.',
      light_mode_semantics: ['bg-background', 'text-foreground'],
      dark_mode_semantics: ['dark:bg-background', 'dark:text-foreground']
    });
  }

  if (includesPricing) {
    addComponent('src/pages/Pricing.tsx', {
      name: 'PricingPage',
      file: 'src/pages/Pricing.tsx',
      purpose: 'Pricing layout with plan cards and FAQ support.',
      child_elements: ['plan cards', 'toggle', 'comparison checklist', 'support CTA'],
      shadcn_primitives: ['card', 'button', 'toggle', 'accordion'],
      lucide_icons: ['Layers', 'Sparkles', 'LifeBuoy'],
      data_dependencies: ['pricing_plans', 'faqs'],
      zero_props_justification: 'Pricing info defined locally for deterministic output.',
      light_mode_semantics: ['bg-background', 'text-foreground'],
      dark_mode_semantics: ['dark:bg-background', 'dark:text-foreground']
    });
  }

  const components = Object.values(componentsSet);

  const taskSteps: any[] = [];

  taskSteps.push({
    task: 'Create layout shell with header/footer scaffolding',
    file: 'src/components/LayoutShell.tsx',
    description:
      'Set up layout with theme toggle, nav links placeholder, background gradients, and slot for routed pages.',
    dependencies: [],
    validation: 'Layout renders wrapper structure, applies semantic tokens, and exports default component.'
  });

  taskSteps.push({
    task: 'Implement header navigation',
    file: 'src/components/Header.tsx',
    description:
      'Build header with brand mark, navigation links, connect button, and theme toggle using shadcn primitives.',
    dependencies: ['src/components/LayoutShell.tsx'],
    validation: 'Header compiles without props, exports default component, and uses semantic tokens for light/dark.'
  });

  taskSteps.push({
    task: 'Implement footer',
    file: 'src/components/Footer.tsx',
    description:
      'Create footer with brand tagline, link clusters, and social buttons themed for light/dark modes.',
    dependencies: ['src/components/LayoutShell.tsx'],
    validation: 'Footer exports default component, uses semantic tokens, and renders link/social sections.'
  });

  taskSteps.push({
    task: 'Implement hero section with CTA buttons and imagery',
    file: 'src/components/HeroSection.tsx',
    description:
      'Build hero with layered gradients, metrics, CTA buttons, and generated illustration asset.',
    dependencies: ['src/components/Header.tsx'],
    validation: 'Hero compiles with zero props, applies semantic tokens, imagery sourced locally.'
  });

  taskSteps.push({
    task: 'Build feature showcase grid',
    file: 'src/components/FeatureGrid.tsx',
    description:
      'Render feature cards using shadcn card/badge primitives with hover effects and icons.',
    dependencies: ['src/components/HeroSection.tsx'],
    validation: 'Grid shows 6 features with icons and badges, no placeholder text remain.'
  });

  taskSteps.push({
    task: 'Implement metrics strip counters',
    file: 'src/components/MetricsStrip.tsx',
    description:
      'Animated counters display metrics with icons and delta badges synchronized to scroll.',
    dependencies: ['src/components/FeatureGrid.tsx'],
    validation: 'Counters animate via hooks, uses semantic colors, no console errors.'
  });

  taskSteps.push({
    task: 'Create FAQ accordion component',
    file: 'src/components/FaqAccordion.tsx',
    description:
      'Accordion list with question triggers, animated answers, and support CTA chip using shadcn primitives.',
    dependencies: ['src/components/MetricsStrip.tsx'],
    validation: 'Accordion toggles smoothly, zero props, semantic tokens for light/dark.'
  });

  taskSteps.push({
    task: 'Add testimonials carousel component',
    file: 'src/components/TestimonialsCarousel.tsx',
    description:
      'Carousel showcasing testimonial quotes with avatars, navigation controls, and autoplay behaviour.',
    dependencies: ['src/components/FaqAccordion.tsx'],
    validation: 'Carousel auto-plays with controls, keyboard accessible, uses semantic tokens.'
  });

  taskSteps.push({
    task: 'Create call-to-action banner',
    file: 'src/components/CallToActionBanner.tsx',
    description:
      'Gradient CTA block with button group and reassurance bullet list, hooking into plan data.',
    dependencies: ['src/components/TestimonialsCarousel.tsx'],
    validation: 'CTA shows gradient, three benefits, and styled buttons with hover states.'
  });

  taskSteps.push({
    task: 'Compose Home route integrating sections',
    file: 'src/pages/Home.tsx',
    description:
      'Assemble home page using all sections, ensure semantic ordering and sticky navigation anchors.',
    dependencies: [
      'src/components/LayoutShell.tsx',
      'src/components/Header.tsx',
      'src/components/Footer.tsx',
      'src/components/HeroSection.tsx',
      'src/components/FeatureGrid.tsx',
      'src/components/MetricsStrip.tsx',
      'src/components/TestimonialsCarousel.tsx',
      'src/components/FaqAccordion.tsx',
      'src/components/CallToActionBanner.tsx'
    ],
    validation: 'Home route renders without props, uses LayoutShell, applies Helmet metadata, passes lint/tsc.'
  });

  taskSteps.push({
    task: 'Wire App shell with routing and layout',
    file: 'src/App.tsx',
    description:
      'Update App component to register LayoutShell as a parent route and nest Home/secondary pages without duplicating Header/Footer.',
    dependencies: [
      'src/components/LayoutShell.tsx',
      'src/components/Header.tsx',
      'src/components/Footer.tsx',
      'src/pages/Home.tsx'
    ].concat(
      includesSwap ? ['src/pages/Swap.tsx'] : [],
      includesLiquidity ? ['src/pages/Liquidity.tsx'] : [],
      includesDashboard ? ['src/pages/Dashboard.tsx'] : [],
      includesPricing ? ['src/pages/Pricing.tsx'] : []
    ),
    validation:
      'App imports LayoutShell and page components, declares <Route path="/" element={<LayoutShell />}> with nested routes, does NOT render Header/Footer directly, and exports default App.'
  });

  if (includesSwap) {
    taskSteps.push({
      task: 'Implement Swap page with form and market overview',
      file: 'src/pages/Swap.tsx',
      description:
        'Build swap interface with token selectors, slippage slider, route breakdown, and market cards.',
      dependencies: [
        'src/components/LayoutShell.tsx',
        'src/components/Header.tsx',
        'src/components/Footer.tsx'
      ],
      validation: 'Swap page renders form controls, uses semantic tokens, no TypeScript errors.'
    });
  }

  if (includesLiquidity) {
    taskSteps.push({
      task: 'Build Liquidity management page',
      file: 'src/pages/Liquidity.tsx',
      description:
        'Show pool summaries, earnings chart, and action tabs using shadcn primitives.',
      dependencies: [
        'src/components/LayoutShell.tsx',
        'src/components/Header.tsx',
        'src/components/Footer.tsx'
      ],
      validation: 'Liquidity page renders cards and tabs, charts placeholder compiles, zero errors.'
    });
  }

  if (includesDashboard) {
    taskSteps.push({
      task: 'Construct Dashboard page with KPI grid',
      file: 'src/pages/Dashboard.tsx',
      description:
        'KPI grid and timeline with badges and scroll-area for notifications.',
      dependencies: [
        'src/components/LayoutShell.tsx',
        'src/components/Header.tsx',
        'src/components/Footer.tsx'
      ],
      validation: 'Dashboard compiles and displays KPIs without placeholder copy.'
    });
  }

  if (includesPricing) {
    taskSteps.push({
      task: 'Create Pricing page with plan cards and FAQ support',
      file: 'src/pages/Pricing.tsx',
      description:
        'Pricing card trio, billing toggle, and FAQ support block with CTA.',
      dependencies: [
        'src/components/LayoutShell.tsx',
        'src/components/Header.tsx',
        'src/components/Footer.tsx'
      ],
      validation: 'Pricing page renders three plan cards, toggle works, uses semantic tokens.'
    });
  }

  const task_flow = taskSteps.map((task, index) => ({
    step: index + 1,
    ...task
  }));

  const data_models: any[] = [
    {
      name: 'hero_metrics',
      description: 'KPI chips displayed within the hero section.',
      fields: [
        { key: 'label', type: 'string', description: 'Metric name' },
        { key: 'value', type: 'string', description: 'Primary value' },
        { key: 'caption', type: 'string', description: 'Supporting caption' }
      ],
      sample_values: [
        { label: 'Users onboarded', value: '12K+', caption: 'In the last 30 days' },
        { label: 'Retention', value: '94%', caption: 'Rolling 90-day average' }
      ]
    },
    {
      name: 'workflow_steps',
      description: 'Steps used in the solution overview timeline.',
      fields: [
        { key: 'title', type: 'string' },
        { key: 'description', type: 'string' },
        { key: 'icon', type: 'string' }
      ],
      sample_values: [
        {
          title: 'Discover',
          description: 'Collect audience insights and requirements.',
          icon: 'Search'
        },
        {
          title: 'Design',
          description: 'Rapid design sprints to validate visuals.',
          icon: 'PenTool'
        },
        {
          title: 'Launch',
          description: 'Deploy production-ready experience with analytics.',
          icon: 'Rocket'
        }
      ]
    },
    {
      name: 'features',
      description: 'Feature cards showcased in the home page.',
      fields: [
        { key: 'title', type: 'string', description: 'Feature headline' },
        { key: 'description', type: 'string', description: 'Supporting copy' },
        { key: 'icon', type: 'string', description: 'Lucide icon name' },
        { key: 'badge', type: 'string', description: 'Status or label e.g. Live' }
      ],
      sample_values: [
        {
          title: 'Instant execution',
          description: 'Sub-3 second settlement with transparent fees.',
          icon: 'Zap',
          badge: 'Live'
        },
        {
          title: 'Institution-grade security',
          description: 'Multi-layer encryption and on-chain proofs.',
          icon: 'ShieldCheck',
          badge: 'Audited'
        },
        {
          title: 'Automation ready',
          description: 'Trigger complex workflows with a single click.',
          icon: 'Sparkles',
          badge: 'New'
        }
      ]
    },
    {
      name: 'metrics',
      description: 'Key performance indicators displayed in metrics strip.',
      fields: [
        { key: 'label', type: 'string' },
        { key: 'value', type: 'string' },
        { key: 'delta', type: 'string' },
        { key: 'icon', type: 'string' }
      ],
      sample_values: [
        { label: 'TVL Secured', value: '$842M', delta: '+12% WoW', icon: 'Layers' },
        { label: 'Active users', value: '94K', delta: '+8% MoM', icon: 'Users' },
        { label: 'Avg. latency', value: '1.2s', delta: '-32%', icon: 'Activity' }
      ]
    },
    {
      name: 'testimonials',
      description: 'Testimonials powering social proof carousel.',
      fields: [
        { key: 'quote', type: 'string' },
        { key: 'name', type: 'string' },
        { key: 'role', type: 'string' },
        { key: 'company', type: 'string' },
        { key: 'avatar', type: 'string' }
      ],
      sample_values: includesTestimonials
        ? [
            {
              quote: 'The platform amplified our community reach overnight.',
              name: 'Sascha Start',
              role: 'Sports Journalist',
              company: 'Schwarzgelbe Runde',
              avatar: '/generated-images/testimonial-sascha.png'
            }
          ]
        : [
            {
              quote: 'We shipped a flagship experience in record time.',
              name: 'Amelia Rivers',
              role: 'Founder',
              company: 'Nebula Labs',
              avatar: '/generated-images/testimonial-amelia.png'
            },
            {
              quote: 'The UI polish rivals top-tier digital agencies.',
              name: 'Xavier Holden',
              role: 'Design Lead',
              company: 'Flux Finance',
              avatar: '/generated-images/testimonial-xavier.png'
            }
          ]
    },
    {
      name: 'faqs',
      description: 'Frequently asked questions for support.',
      fields: [
        { key: 'question', type: 'string' },
        { key: 'answer', type: 'string' }
      ],
      sample_values: [
        {
          question: 'How fast can we launch?',
          answer: 'The starter template ships in under an hour, with customizations layered iteratively.'
        },
        {
          question: 'Do you support dark mode?',
          answer: 'Dark mode is default with semantic tokens ensuring accessibility.'
        }
      ]
    },
    {
      name: 'cta_content',
      description: 'Call-to-action copy and reassurance bullets.',
      fields: [
        { key: 'headline', type: 'string' },
        { key: 'subheading', type: 'string' },
        { key: 'bullets', type: 'string[]' }
      ],
      sample_values: [
        {
          headline: 'Launch with confidence today',
          subheading: 'Join builders rewriting the rules of digital product experiences.',
          bullets: ['Guided onboarding', 'Dedicated support channel', 'Enterprise-ready stack']
        }
      ]
    }
  ];

  if (includesSwap) {
    data_models.push(
      {
        name: 'swap_preferences',
        description: 'User settings for default slippage and transaction speed.',
        fields: [
          { key: 'label', type: 'string' },
          { key: 'value', type: 'string' },
          { key: 'description', type: 'string' }
        ],
        sample_values: [
          { label: 'Slippage', value: '0.5%', description: 'Default tolerance for swaps.' },
          { label: 'Transaction speed', value: 'Standard', description: 'Balanced gas usage.' }
        ]
      },
      {
        name: 'swap_tokens',
        description: 'Token pairs available for swap interface.',
        fields: [
          { key: 'symbol', type: 'string' },
          { key: 'name', type: 'string' },
          { key: 'icon', type: 'string' }
        ],
        sample_values: [
          { symbol: 'ETH', name: 'Ethereum', icon: 'eth.svg' },
          { symbol: 'USDC', name: 'USD Coin', icon: 'usdc.svg' },
          { symbol: 'SOL', name: 'Solana', icon: 'sol.svg' }
        ]
      },
      {
        name: 'market_stats',
        description: 'Stats powering market overview cards.',
        fields: [
          { key: 'pair', type: 'string' },
          { key: 'price', type: 'string' },
          { key: 'change24h', type: 'string' },
          { key: 'route', type: 'string[]' }
        ],
        sample_values: [
          { pair: 'ETH/USDC', price: '$3,482.19', change24h: '+2.3%', route: ['ETH', 'wBTC', 'USDC'] }
        ]
      }
    );
  }

  if (includesLiquidity) {
    data_models.push(
      {
        name: 'liquidity_positions',
        description: 'Positions summarised on liquidity page.',
        fields: [
          { key: 'pool', type: 'string' },
          { key: 'value', type: 'string' },
          { key: 'apr', type: 'string' },
          { key: 'status', type: 'string' }
        ],
        sample_values: [
          { pool: 'ETH/USDC', value: '$120,341', apr: '18.6%', status: 'Healthy' }
        ]
      },
      {
        name: 'liquidity_actions',
        description: 'Action presets for deposit/withdraw flows.',
        fields: [
          { key: 'action', type: 'string' },
          { key: 'minAmount', type: 'string' },
          { key: 'fee', type: 'string' }
        ],
        sample_values: [
          { action: 'Provide liquidity', minAmount: '$1,000', fee: '0.15%' },
          { action: 'Withdraw earnings', minAmount: '$250', fee: '0%' }
        ]
      }
    );
  }

  if (includesDashboard) {
    data_models.push({
      name: 'tasks',
      description: 'Timeline items for dashboard.',
      fields: [
        { key: 'title', type: 'string' },
        { key: 'owner', type: 'string' },
        { key: 'due', type: 'string' },
        { key: 'status', type: 'string' }
      ],
      sample_values: [
        { title: 'Launch staking rewards', owner: 'Alex', due: '2025-11-30', status: 'In Progress' },
        { title: 'Security audit refresh', owner: 'Priya', due: '2025-12-08', status: 'Planned' }
      ]
    });
  }

  if (includesPricing) {
    data_models.push({
      name: 'pricing_plans',
      description: 'Plan tiers for pricing page.',
      fields: [
        { key: 'name', type: 'string' },
        { key: 'priceMonthly', type: 'string' },
        { key: 'priceYearly', type: 'string' },
        { key: 'features', type: 'string[]' },
        { key: 'ctaLabel', type: 'string' }
      ],
      sample_values: [
        {
          name: 'Starter',
          priceMonthly: '$49',
          priceYearly: '$39',
          features: ['Core analytics', 'Email support', 'Base integrations'],
          ctaLabel: 'Start trial'
        },
        {
          name: 'Pro',
          priceMonthly: '$129',
          priceYearly: '$109',
          features: ['Advanced routing', 'Priority support', 'Automation toolkit'],
          ctaLabel: 'Upgrade'
        },
        {
          name: 'Enterprise',
          priceMonthly: 'Custom',
          priceYearly: 'Custom',
          features: ['Dedicated CSM', 'Custom SLAs', 'On-prem options'],
          ctaLabel: 'Contact sales'
        }
      ]
    });
  }

  const planJson = {
    plan_origin: 'fallback',
    summary: `Deterministic fallback plan for ${projectName} generated due to planner failure.`,
    design_language: [
      'Cinematic gradients',
      'Layered depth with glassmorphism accents',
      'Semantic Tailwind tokens only',
      'High contrast dark-first palette'
    ],
    tone: 'Confident, future-forward, customer-obsessed',
    visual_guidelines: {
      brand_colors: {
        primary: '#6366F1',
        secondary: '#22D3EE',
        accent: '#F97316',
        success: '#22C55E',
        warning: '#FACC15'
      },
      gradients: [
        'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--secondary)) 100%)',
        'radial-gradient(circle at top, rgba(34,211,238,0.35), transparent 70%)'
      ],
      surfaces: {
        card: 'bg-card/95 with subtle border-border',
        background: 'bg-background with noise overlay',
        muted: 'bg-muted/80 for supporting sections'
      },
      typography: {
        heading: 'Clamp-based display with tracking-tight',
        body: 'Inter 16/28, text-muted-foreground for secondary copy'
      }
    },
    routes: allRoutes,
    components,
    data_models,
    task_flow
  };

  const planString = JSON.stringify(planJson, null, 2);
  console.warn(`[chat:${requestId}] ⚠️ Using deterministic fallback plan due to planner failure.`);
  debugLog(requestId, '📋 Fallback project plan generated', planJson);
  return { planJson, planString };
}

/**
 * Build style-specific instructions for the system prompt based on selected style, colors, and logo
 */
function buildStyleInstructions(
  selectedStyle: string | null | undefined,
  colors: string[] | null | undefined,
  logo: string | null | undefined,
  uploadedAssets: Array<{ filePath: string; buffer: Buffer; storagePath: string; publicUrl: string }> = []
): string {
  let instructions = '';

  // Style-specific instructions
  if (selectedStyle === 'neo_brutalism') {
    instructions += `- STYLE: Neo Brutalism
  - Use bold, high-contrast design with heavy borders (border-4, border-8)
  - Bright, vibrant colors with strong shadows (shadow-[8px_8px_0px_0px_rgb(0,0,0)])
  - Sharp edges, no rounded corners (rounded-none or minimal rounding)
  - Heavy typography with bold weights (font-black, font-bold)
  - Black outlines on colored elements
  - Strong visual hierarchy with contrasting backgrounds
  - Use border-black for all borders
  - Add drop-shadow effects for depth\n\n`;
  } else if (selectedStyle === 'gaming_3d') {
    instructions += `- STYLE: Gaming with 3D Objects
  - Use dynamic gaming aesthetic with 3D visual elements
  - Neon effects and glowing borders (ring-2 ring-cyan-400, shadow-[0_0_20px_rgba(34,211,238,0.5)])
  - Animated gradients and motion effects (animate-pulse, animate-bounce)
  - Dark backgrounds with bright accent colors
  - Use transform and perspective for 3D effects (transform-gpu, perspective-1000)
  - Add glow effects to buttons and important elements (shadow-[0_0_30px_rgba(59,130,246,0.6)])
  - Use vibrant, saturated colors (cyan, purple, pink, yellow)
  - Add hover effects with scale and glow (hover:scale-110 hover:shadow-lg)
  - Use gradient backgrounds with multiple colors (bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500)\n\n`;
  } else if (selectedStyle === 'defi_clean') {
    instructions += `- STYLE: DeFi Clean & Minimal
  - Clean, professional design perfect for DeFi applications
  - Minimalist layout with plenty of white space
  - Clear data visualization with charts and tables
  - Professional color scheme (blues, greens, grays)
  - Subtle shadows and borders (shadow-sm, border border-gray-200)
  - Clear typography hierarchy (text-sm, text-base, text-lg, text-xl)
  - Focus on readability and clarity
  - Use subtle hover effects (hover:bg-gray-50, hover:shadow-md)
  - Professional buttons with clear CTAs
  - Clean card designs with subtle borders
  - Data-focused components (tables, charts, stats)\n\n`;
  } else if (selectedStyle === 'modern_gradient') {
    instructions += `- STYLE: Modern Gradient
  - Sleek modern design with smooth gradients
  - Glassmorphism effects (backdrop-blur-md bg-white/10)
  - Fluid animations and transitions
  - Smooth color transitions (bg-gradient-to-r, bg-gradient-to-br)
  - Soft shadows and rounded corners (rounded-2xl, shadow-xl)
  - Modern typography with good spacing
  - Use gradient backgrounds for hero sections
  - Add hover effects with smooth transitions (transition-all duration-300)
  - Use glassmorphic cards with backdrop blur
  - Modern color palette with smooth gradients\n\n`;
  } else if (selectedStyle === 'custom') {
    instructions += `- STYLE: Custom (AI-selected)
  - Choose the most appropriate style based on the project type
  - Apply consistent design language throughout
  - Ensure visual harmony and coherence
  - Use appropriate colors and typography for the project\n\n`;
  }

  // Color instructions
  if (colors && Array.isArray(colors) && colors.length > 0) {
    instructions += `- COLORS: Use the following color palette throughout the application:
  ${colors.map((color, index) => {
      const colorName = index === 0 ? 'primary' : index === 1 ? 'secondary' : `accent-${index - 1}`;
      return `  - ${colorName}: ${color}`;
    }).join('\n')}
  - Apply these colors consistently across all components
  - Use these colors for buttons, accents, gradients, and highlights
  - Ensure sufficient contrast for text readability
  - Map these colors to semantic Tailwind tokens (primary, secondary, accent)
  - Use these colors in both light and dark modes\n\n`;
  }

  // Logo instructions
  if (logo) {
    instructions += `- LOGO: A logo has been provided for this project
  - Logo file: public/logo.png (already uploaded to sandbox)
  - Use the logo in the header/navigation with: <img src="/logo.png" alt="Logo" className="h-8 w-auto" />
  - The logo is available at /logo.png (public folder is served from root in Vite)
  - Ensure the logo is properly sized and positioned
  - Use the logo as a link to the home page
  - Ensure the logo works in both light and dark modes
  - Add appropriate alt text for accessibility\n\n`;
  }

  // Uploaded images instructions
  if (uploadedAssets && uploadedAssets.length > 0) {
    instructions += `- UPLOADED IMAGES: ${uploadedAssets.length} image(s) have been uploaded for this project
  - Images are available at: ${uploadedAssets.map(a => `/${a.filePath.replace('public/', '')}`).join(', ')}
  - Use these images in your components with: <img src="/${uploadedAssets[0].filePath.replace('public/', '')}" alt="..." />
  - Images are stored in public/uploads/ and served from root in Vite
  - Reference uploaded images using their file paths (e.g., /uploads/image-1.png)
  - Add descriptive alt text for all uploaded images\n\n`;
  }

  // General image generation instructions
  instructions += `- IMAGES: Generate AI images for hero sections and key visuals
  - Never use stock images or external URLs
  - All images must be AI-generated and saved to '/generated-images/...' or use uploaded images
  - Use descriptive alt text for all images
  - Generate images that match the selected style and color scheme
  - Ensure images are optimized and properly sized
  - Use relative paths for all images (e.g., /logo.png, /uploads/image.png, /generated-images/hero.png)
  - Never use Supabase Storage URLs in code - assets are copied to the sandbox and included in the build\n\n`;

  return instructions;
}

/**
 * Orchestrates the two-pass GPT-4o-mini planner that produces the full project blueprint
 * (sections, components, task flow, imagery prompts) used by the sequential build step.
 */
async function generateProjectPlan(
  requestId: string,
  userPrompt: string,
  template: string,
  existingPlan: string | null,
  projectSummary: string | null
): Promise<{ planString: string; planJson: any }> {
  if (!process.env.OPENAI_KEY) {
    console.warn(`[chat:${requestId}] ⚠️ OPENAI_KEY missing, skipping project planning step.`);
    return { planString: '', planJson: null };
  }

  const planSystemPrompt = `You are an EXPERT product architect and UI/UX lead. Produce a complete application blueprint as STRICT JSON (no markdown) so engineers and AI writers can implement it without guessing.

CRITICAL: This is a PLANNING PHASE. Generate a catalog of possible pages/routes that COULD be built based on the user's prompt. The user will then SELECT which pages they want, and ONLY those pages will be built.

If the user's prompt is GENERAL (e.g., "create a website", "build an app"), generate ONLY a single landing page route. If the user's prompt is SPECIFIC (e.g., "create a DEX with swap and liquidity pages"), generate those specific pages PLUS a landing page.

Requirements:
- Always include "summary", "design_language", "tone", "visual_guidelines", "page_catalog", "routes", "components", "data_models", and "task_flow".
- page_catalog[] is a NEW REQUIRED field that lists ALL possible pages that could be built, each with: id (unique identifier), name (human-readable), path (URL path), description (what this page does), category (e.g., "core", "feature", "utility"), recommended (boolean - true for pages that should definitely be built based on the prompt), and estimated_complexity (1-5 scale).
- routes[] entries must include: name, path, purpose, primary_actions, wow_moment, layout, hero_statement, and sections (array). ONLY include routes for pages that are marked as "recommended: true" in page_catalog, OR if no specific pages are mentioned, create ONLY a single landing page route.
- Every section MUST be an object with: id (snake_case), headline, narrative, ui_elements (array describing shadcn/ui primitives or bespoke widgets, e.g. "card grid", "stats strip", "loan calculator form"), interactions (array describing user flows), lucide_icons (array), animation, color_story, and data_sources (array referencing data_models keys). Text-only sections are forbidden.
- The landing route (path "/") MUST contain at least sections with ids hero, feature_showcase, metrics, solution_overview, testimonials, faq, and primary_call_to_action. Each of those sections must list >=2 ui_elements and >=1 lucide icon.
- Secondary routes (any non-landing pages) must include substantive interactive UI: forms with fields, tables, charts, action panels, status badges, etc. Each section must define ui_elements and interactions.
- components[] must enumerate every custom component to build, with file path, purpose, child elements, shadcn/ui building blocks, lucide icons, data dependencies, zero_props justification, AND explicit Tailwind semantic color usage for both light and dark mode (use the tokens defined in index.css/tailwind.config.ts such as bg-card, text-foreground, accent-* etc.). Every component description must call out the exact tokens/variants to apply to shadcn primitives so the UI is fully themed in both modes. Buttons MUST specify primary/hover/disabled styling (background, border, text) using those semantic tokens—never leave buttons on default white/gray.
- components[] MUST NEVER reference "@/components/lib/*". Those entries are template stubs only; always point to the actual implementation path (e.g., "src/components/Header.tsx").
- task_flow[] MUST be an ordered list describing every build step with: step (number), task (human-readable summary), file (relative path to create), description (execution notes), dependencies (array of file paths that must exist first), and validation criteria. No step may omit "file". ONLY include tasks for recommended pages.
- data_models[] should describe any local or mock data needed (stats, testimonials, loan tables, activity feeds, charts) with field definitions and sample values or generation rules.
- Imagery must never reference external hosts or stock libraries. Instead, provide clear 'image_prompt' descriptions so the build pipeline can generate assets (e.g., "Hero illustration: neon-lit gamer avatar with holographic UI").
- Honour shadcn/ui usage: only reference components that exist under "@/components/ui/*".
- Honour Lucide icon catalogue: only list icons that exist; prefer names like ArrowRight, ShieldCheck, Sparkles, Wallet.
- Express colors and gradients using semantic tokens (background, card, accent, primary-dark, etc.) and describe how to apply them.
- Keep JSON compact but expressive. Do NOT include markdown code fences.`;

  const planSystemPromptUpdate = `You are an EXPERT product architect updating an existing blueprint.
- Inputs include the current plan (JSON), a project summary (current routes/pages/components), and the user's new request.
- Produce an UPDATED plan following the same schema (including task_flow with executable steps and file paths). Preserve existing sections/routes/components unless changes are required. Introduce new ones as needed, mark deprecations, and ensure consistency with the current file structure.
- When updating existing components, keep their light/dark styling requirements explicit—restate the exact semantic color tokens and shadcn variants that must remain in place, including button backgrounds/hover states and any AI imagery prompts that should produce new assets instead of reusing stock images. Never reintroduce external image URLs; always describe assets to generate.
- Never point updated components to "@/components/lib/*". If a prior plan referenced a lib stub, correct it to the canonical component path under "src/components".
- Keep JSON compact. No markdown code fences.`;

  let existingPlanJson: any = null;
  if (existingPlan) {
    try {
      existingPlanJson = JSON.parse(existingPlan);
    } catch (parseErr) {
      console.warn(
        `[chat:${requestId}] ⚠️ Stored plan is not valid JSON, ignoring for planner context:`,
        (parseErr as Error).message
      );
      existingPlanJson = null;
    }
  }

  const existingPlanExcerpt = existingPlanJson ? buildExistingPlanExcerpt(existingPlanJson) : null;
  const excerptString = existingPlanExcerpt ? JSON.stringify(existingPlanExcerpt) : null;

  const sanitizedExistingPlan =
    excerptString && excerptString.length > 0 ? excerptString.slice(0, 20000) : null;
  const sanitizedSummary = projectSummary ? projectSummary.slice(0, 8000) : null;

  const planPayload = {
    user_prompt: userPrompt,
    template,
    required_sections: ['hero', 'feature_showcase', 'metrics', 'testimonials', 'faq', 'primary_call_to_action'],
    shadcn_components: [
      'accordion',
      'alert',
      'alert-dialog',
      'aspect-ratio',
      'avatar',
      'badge',
      'breadcrumb',
      'button',
      'calendar',
      'card',
      'carousel',
      'chart',
      'checkbox',
      'collapsible',
      'command',
      'context-menu',
      'dialog',
      'drawer',
      'dropdown-menu',
      'form',
      'hover-card',
      'input',
      'input-otp',
      'label',
      'menubar',
      'navigation-menu',
      'pagination',
      'popover',
      'progress',
      'radio-group',
      'resizable',
      'scroll-area',
      'select',
      'separator',
      'sheet',
      'sidebar',
      'skeleton',
      'slider',
      'sonner',
      'switch',
      'table',
      'tabs',
      'textarea',
      'toast',
      'toaster',
      'toggle',
      'toggle-group',
      'tooltip'
    ],
    lucide_reference: 'Import icons from lucide-react. Use only valid icon names.',
    quality_bar:
      'Every page must feel like a premium SaaS product: cinematic hero, feature grids, metrics, testimonials, FAQs, CTA strips, plus substantive interactive flows (forms, tables, cards, charts) for secondary routes. Zero tolerance for placeholder copy-only sections.'
  };
  if (sanitizedExistingPlan) {
    (planPayload as any).existing_plan = sanitizedExistingPlan;
  }
  if (sanitizedSummary) {
    (planPayload as any).project_summary = sanitizedSummary;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sanitizedExistingPlan ? planSystemPromptUpdate : planSystemPrompt },
          { role: 'user', content: JSON.stringify(planPayload) }
        ]
      });

      const planRaw = completion.choices[0]?.message?.content || '{}';
      console.log(`[chat:${requestId}] Project plan tokens=${completion.usage?.total_tokens || 0}`);

      let planJson: any = {};
      try {
        planJson = JSON.parse(planRaw);
        if (existingPlanJson) {
          planJson = deepMergeExistingPlan(existingPlanJson, planJson);
        }
      } catch (parseError) {
        console.error(`[chat:${requestId}] ⚠️ Failed to parse plan JSON (attempt ${attempt}):`, parseError);
        if (attempt === 2) {
          throw new Error('Failed to parse project plan JSON');
        }
        continue;
      }

      let routes: any[] = Array.isArray(planJson?.routes) ? planJson.routes : [];
      if ((!routes || routes.length === 0) && existingPlanJson?.routes) {
        routes = Array.isArray(existingPlanJson.routes) ? existingPlanJson.routes : [];
        planJson.routes = routes;
        console.warn(`[chat:${requestId}] ⚠️ Planner omitted routes; restoring from prior plan.`);
      }

      if (existingPlanJson?.routes) {
        const mergedRoutes = mergeRoutesWithPrior(routes, existingPlanJson.routes);
        if (mergedRoutes.changed) {
          planJson.routes = mergedRoutes.routes;
          routes = mergedRoutes.routes;
          console.log(`[chat:${requestId}] ℹ️ Restored ${mergedRoutes.restoredCount} route section(s) from prior plan.`);
        }
      }
      const landingRoute =
        routes.find((route) => route?.path === '/') ||
        routes.find((route) => typeof route?.name === 'string' && route.name.toLowerCase().includes('home'));

      const requiredSections = ['hero', 'feature', 'metric', 'testimonial', 'faq', 'call_to_action'];
      const landingSections = Array.isArray(landingRoute?.sections) ? landingRoute.sections : [];
      const normalizedSections = landingSections.map((section: any) => {
        if (typeof section === 'string') return section.toLowerCase();
        if (typeof section?.id === 'string') return section.id.toLowerCase();
        if (typeof section?.headline === 'string') return section.headline.toLowerCase();
        return '';
      });

      const missingSections = requiredSections.filter(
        (keyword) => !normalizedSections.some((sectionId: string) => sectionId.includes(keyword))
      );

      const landingRichEnough =
        Array.isArray(landingSections) &&
        landingSections.length >= 6 &&
        landingSections.every(
          (section: any) =>
            Array.isArray(section?.ui_elements) &&
            section.ui_elements.length >= 2 &&
            Array.isArray(section?.interactions) &&
            section.interactions.length >= 1 &&
            typeof section?.headline === 'string' &&
            section.headline.trim().length > 0
        );

      const secondaryRoutes = routes.filter((route) => route !== landingRoute);
      const secondaryIssues = secondaryRoutes
        .map((route) => {
          const sections = Array.isArray(route?.sections) ? route.sections : [];
          if (sections.length === 0) return route?.path || route?.name || 'unknown';
          const richSections = sections.filter(
            (section: any) =>
              Array.isArray(section?.ui_elements) &&
              section.ui_elements.some((el: any) => typeof el === 'string' && el.trim().length > 0) &&
              Array.isArray(section?.interactions) &&
              section.interactions.length > 0
          );
          return richSections.length >= Math.min(2, sections.length) ? null : route?.path || route?.name || 'unknown';
        })
        .filter(Boolean);

      let candidateTasks = buildTaskFlowFromPlan(planJson);
      let hasComponents =
        Array.isArray(planJson?.components) && planJson.components.some((comp: any) => comp?.file);

      if (existingPlanJson) {
        if (!hasComponents && Array.isArray(existingPlanJson.components)) {
          planJson.components = existingPlanJson.components;
          hasComponents = true;
        }
        if (candidateTasks.length === 0 && Array.isArray(existingPlanJson.task_flow)) {
          planJson.task_flow = existingPlanJson.task_flow;
          candidateTasks = buildTaskFlowFromPlan(planJson);
        }
      }

      if (!landingRoute || missingSections.length > 0 || !landingRichEnough || secondaryIssues.length > 0) {
        console.warn(
          `[chat:${requestId}] ⚠️ Plan insufficient (missing=${missingSections.join(
            ', '
          )}, landingRich=${landingRichEnough}, secondaryIssues=${secondaryIssues.join(', ')}) – retrying (${attempt}/2)`
        );
        if (attempt === 2) {
          if (existingPlanJson) {
            console.warn(
              `[chat:${requestId}] ⚠️ Planner could not satisfy landing requirements; reusing previous plan.`
            );
            return { planString: JSON.stringify(existingPlanJson), planJson: existingPlanJson };
          }
          throw new Error('Project plan missing required sections or richness.');
        }
        continue;
      }

      if (!hasComponents || candidateTasks.length === 0) {
        console.warn(
          `[chat:${requestId}] ⚠️ Plan missing actionable task flow (components=${hasComponents}, tasks=${candidateTasks.length}) – retrying (${attempt}/2)`
        );
        if (attempt === 2) {
          if (existingPlanJson) {
            console.warn(
              `[chat:${requestId}] ⚠️ Planner failed to produce components/task_flow; reusing previous plan.`
            );
            return { planString: JSON.stringify(existingPlanJson), planJson: existingPlanJson };
          }
          const fallback = buildFallbackPlan(requestId, userPrompt, template);
          return fallback;
        }
        continue;
      }

      const planString = JSON.stringify(planJson, null, 2);
      debugLog(requestId, '📋 Project plan generated', {
        summary: planJson?.summary || '',
        routes: Array.isArray(planJson?.routes) ? planJson.routes.map((route: any) => ({
          path: route?.path,
          sections: Array.isArray(route?.sections) ? route.sections.map((section: any) => section?.id || section?.headline || 'unknown') : []
        })) : [],
        componentsCount: Array.isArray(planJson?.components) ? planJson.components.length : 0,
        dataModelsCount: Array.isArray(planJson?.data_models) ? planJson.data_models.length : 0
      });
      debugLog(requestId, '📋 Project plan preview', planString.slice(0, 2000));
      return { planString, planJson };
    } catch (error: any) {
      console.error(`[chat:${requestId}] ⚠️ Plan generation error (attempt ${attempt}):`, error?.message || error);
      if (attempt === 2) {
        if (existingPlanJson) {
          console.warn(
            `[chat:${requestId}] ⚠️ Planner failed after retries (${error?.message || error}). Reusing previous plan.`
          );
          return { planString: JSON.stringify(existingPlanJson), planJson: existingPlanJson };
        }
        const fallback = buildFallbackPlan(requestId, userPrompt, template);
        return fallback;
      }
    }
  }

  if (existingPlanJson) {
    console.warn(
      `[chat:${requestId}] ⚠️ Planner returned no content; falling back to stored plan.`
    );
    return { planString: JSON.stringify(existingPlanJson), planJson: existingPlanJson };
  }

  const fallback = buildFallbackPlan(requestId, userPrompt, template);
  return fallback;
}
type ProjectBrandMetadata = {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColors: string[];
  typography: string | null;
};

type ProjectMetadata = {
  name: string;
  prompt: string;
  template: string | null;
  summary: string | null;
  tagline: string | null;
  brand: ProjectBrandMetadata;
  notes: string[];
  plan: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeProjectMetadata(
  raw: any,
  fallbackName: string,
  fallbackPrompt: string,
  fallbackTemplate: string | null,
  fallbackCreatedAt: string
): ProjectMetadata {
  const brand: ProjectBrandMetadata = {
    primaryColor: typeof raw?.brand?.primaryColor === 'string' ? raw.brand.primaryColor : null,
    secondaryColor: typeof raw?.brand?.secondaryColor === 'string' ? raw.brand.secondaryColor : null,
    accentColors: Array.isArray(raw?.brand?.accentColors)
      ? raw.brand.accentColors.filter((value: any) => typeof value === 'string')
      : [],
    typography: typeof raw?.brand?.typography === 'string' ? raw.brand.typography : null
  };

  return {
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName,
    prompt: typeof raw?.prompt === 'string' && raw.prompt.trim() ? raw.prompt.trim() : fallbackPrompt,
    template: typeof raw?.template === 'string' ? raw.template : fallbackTemplate,
    summary: typeof raw?.summary === 'string' ? raw.summary : null,
    tagline: typeof raw?.tagline === 'string' ? raw.tagline : null,
    brand,
    notes: Array.isArray(raw?.notes) ? raw.notes.filter((note: any) => typeof note === 'string') : [],
    plan: typeof raw?.plan === 'string' ? raw.plan : null,
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : fallbackCreatedAt,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : fallbackCreatedAt
  };
}

function buildProjectMetadata(
  projectRecord: any,
  userMessage: string,
  template: string | null
): { metadata: ProjectMetadata; changed: boolean } {
  const fallbackName = projectRecord?.name || 'Untitled Project';
  const fallbackPrompt =
    (typeof projectRecord?.prompt === 'string' && projectRecord.prompt.trim()) ||
    (typeof userMessage === 'string' ? userMessage.trim() : '');
  const fallbackTemplate = template || null;
  const fallbackCreatedAt = projectRecord?.created_at || new Date().toISOString();

  let parsedMetadata: any = null;
  if (projectRecord?.description) {
    try {
      parsedMetadata = JSON.parse(projectRecord.description);
    } catch {
      parsedMetadata = null;
    }
  }

  let metadata = normalizeProjectMetadata(parsedMetadata, fallbackName, fallbackPrompt, fallbackTemplate, fallbackCreatedAt);
  let changed = !parsedMetadata;
  const now = new Date().toISOString();

  if (metadata.name !== fallbackName) {
    metadata.name = fallbackName;
    changed = true;
  }

  if (fallbackPrompt && metadata.prompt !== fallbackPrompt) {
    metadata.prompt = fallbackPrompt;
    changed = true;
  }

  if (metadata.template !== fallbackTemplate) {
    metadata.template = fallbackTemplate;
    changed = true;
  }

  if (!metadata.createdAt) {
    metadata.createdAt = fallbackCreatedAt;
    changed = true;
  }

  if (changed) {
    metadata.updatedAt = now;
  } else if (!metadata.updatedAt) {
    metadata.updatedAt = now;
  }

  return { metadata, changed };
}

/**
 * Guarantees that Supabase and the sandbox share a normalized project-metadata.json snapshot
 * before generation/amendment begins, creating or updating records as needed.
 */
async function ensureProjectMetadata(
  context: any,
  projectId: string,
  metadata: ProjectMetadata,
  metadataChanged: boolean,
  existingDescription: string | null | undefined
): Promise<string> {
  const metadataString = JSON.stringify(metadata, null, 2);

  if (metadataChanged || !existingDescription) {
    try {
      await updateProject(projectId, { description: metadataString });
    } catch (error) {
      console.error(`[chat] Failed to persist project metadata for ${projectId}:`, error);
    }
  }

  if (context?.sandbox) {
    try {
      await context.sandbox.fs.uploadFile(Buffer.from(metadataString, 'utf-8'), PROJECT_METADATA_ABSOLUTE_PATH);
    } catch (error) {
      console.error(`[chat] Failed to write project metadata file for ${projectId}:`, (error as Error).message);
    }
  }

  return metadataString;
}

function upsertMetadataFile(
  existingFiles: any[],
  metadataString: string,
  projectId: string
) {
  const existingEntry = existingFiles.find((file) => file.file_path === PROJECT_METADATA_RELATIVE_PATH);
  if (existingEntry) {
    existingEntry.file_content = metadataString;
  } else {
    existingFiles.push({
      project_id: projectId,
      file_path: PROJECT_METADATA_RELATIVE_PATH,
      file_content: metadataString,
      created_at: new Date().toISOString()
    });
  }
}

// Tool definitions for Gemini (functionDeclarations format)
// NOTE: These are just DESCRIPTIONS/schemas. The actual implementations are in lib/tool-orchestrator.ts
const GEMINI_TOOLS = [
  {
    functionDeclarations: [
    {
      name: 'lov-view',
      description: 'Read the contents of a file. If it\'s a project file, the file path should be relative to the project root. You can optionally specify line ranges to read using the lines parameter (e.g., "1-800, 1001-1500"). By default, the first 500 lines are read if lines is not specified.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to read' },
          lines: { type: 'string', description: 'Optional line ranges (e.g., "1-100, 201-300")' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'lov-write',
      description: 'Write to a file. Overwrites the existing file if there is one. The file path should be relative to the project root. Use "// ... keep existing code" for large unchanged sections.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to write' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['file_path', 'content'],
      },
    },
    {
      name: 'lov-line-replace',
      description: 'Line-based search and replace. This is the PREFERRED tool for editing existing files. Always use this tool when modifying existing code rather than rewriting entire files.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to modify' },
          search: { type: 'string', description: 'Content to search for (use ellipsis ... for large sections)' },
          replace: { type: 'string', description: 'New content to replace the found content' },
          first_replaced_line: { type: 'number', description: 'First line number to replace (1-indexed)' },
          last_replaced_line: { type: 'number', description: 'Last line number to replace (1-indexed)' },
        },
        required: ['file_path', 'search', 'replace', 'first_replaced_line', 'last_replaced_line'],
      },
    },
    {
      name: 'lov-delete',
      description: 'Delete a file. The file path should be relative to the project root.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to delete' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'lov-rename',
      description: 'Rename a file. The original and new file path should be relative to the project root.',
      parameters: {
        type: 'object',
        properties: {
          original_file_path: { type: 'string', description: 'Original file path' },
          new_file_path: { type: 'string', description: 'New file path' },
        },
        required: ['original_file_path', 'new_file_path'],
      },
    },
    {
      name: 'lov-search-files',
      description: 'Regex-based code search with file filtering. Search using regex patterns across files in your project.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Regex pattern to find (e.g., "useState")' },
          include_pattern: { type: 'string', description: 'Files to include using glob syntax (e.g., "src/**")' },
          exclude_pattern: { type: 'string', description: 'Files to exclude using glob syntax' },
          case_sensitive: { type: 'boolean', description: 'Whether to match case (default: false)' },
        },
        required: ['query', 'include_pattern'],
      },
    },
    {
      name: 'lov-read-console-logs',
      description: 'Read the contents of the latest console logs. You can optionally provide a search query to filter the logs.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Optional search query to filter logs' },
        },
        required: [],
      },
    },
    {
      name: 'lov-read-network-requests',
      description: 'Read the contents of the latest network requests. You can optionally provide a search query to filter the requests.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Optional search query to filter requests' },
        },
        required: [],
      },
    },
    {
      name: 'lov-add-dependency',
      description: 'Add a dependency to the project. The dependency should be a valid npm package name.',
      parameters: {
        type: 'object',
        properties: {
          package: { type: 'string', description: 'npm package name (e.g., "lodash@latest")' },
        },
        required: ['package'],
      },
    },
    {
      name: 'lov-remove-dependency',
      description: 'Uninstall a package from the project.',
      parameters: {
        type: 'object',
        properties: {
          package: { type: 'string', description: 'npm package name to remove' },
        },
        required: ['package'],
      },
    },
    ],
  },
];

// Helper to log to both console and file for debugging
function debugLog(requestId: string, message: string, data?: any) {
  const logMessage = `[chat:${requestId}] ${message}`;
  console.log(logMessage, data || '');
  // Also write to a log file for easier debugging
  try {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(process.cwd(), 'chat-debug.log');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${logMessage}${data ? ' ' + JSON.stringify(data, null, 2) : ''}\n`;
    fs.appendFileSync(logFile, logEntry);
  } catch (e) {
    // Ignore file write errors
  }
}

/**
 * Primary chat endpoint: validates auth, loads context, runs planning + sequential build,
 * persists artifacts, and returns preview status to the frontend.
 */
export async function POST(req: Request) {
  let requestId = Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  
  try {
    const {
      message,
      projectId,
      template = 'vite-react',
      images = [],
      imageNames = [],
      requestId: clientRequestId,
      // New multi-step planning fields
      planData,
      selectedPages,
      selectedStyle,
      colors,
      logo,
      additionalInfo,
    } = await req.json();
    
    if (typeof clientRequestId === 'string' && clientRequestId.trim().length > 0) {
      requestId = clientRequestId.trim();
    }

    debugLog(requestId, '====== NEW REQUEST ======');
    
    console.log(`[chat:${requestId}] Request params:`, { 
      messageLength: message?.length, 
      projectId, 
      template, 
      imagesCount: images?.length,
      hasMessage: !!message 
    });

    if (!message) {
      console.error(`[chat:${requestId}] ERROR: No message provided`);
      return NextResponse.json(
        { error: 'Message is required' },
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
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      console.error(`[chat:${requestId}] ERROR: Unauthorized - no user`);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = userData.user.id;
    const trimmedMessage = message.trim();
    console.log(`[chat:${requestId}] User authenticated: ${userId}`);

    // Get or create project
    let currentProjectId = projectId;
    let projectRecord: any = null;
    let projectMetadata: ProjectMetadata | null = null;
    let projectMetadataChanged = false;
    let projectMetadataString = '';

    if (!currentProjectId) {
      console.log(`[chat:${requestId}] Creating new project...`);
      const projectName = deriveProjectName(message);
      const newProject = await createProject(userId, projectName, trimmedMessage);
      currentProjectId = newProject.id;
      projectRecord = newProject;
      console.log(`[chat:${requestId}] Created project: ${currentProjectId}`);
    } else {
      console.log(`[chat:${requestId}] Using existing project: ${currentProjectId}`);
      projectRecord = await getProjectById(currentProjectId);
      if (!projectRecord) {
        console.error(`[chat:${requestId}] ERROR: Project not found or inaccessible`);
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
    }

    if (!projectRecord) {
      projectRecord = await getProjectById(currentProjectId);
    }

    if (!projectRecord) {
      console.error(`[chat:${requestId}] ERROR: Failed to load project record`);
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const metadataResult = buildProjectMetadata(projectRecord, trimmedMessage, template || null);
    projectMetadata = metadataResult.metadata;
    projectMetadataChanged = metadataResult.changed;

    // Get tool context (sandbox, etc.)
    console.log(`[chat:${requestId}] Getting tool context (sandbox)...`);
    const context = await getToolContext(currentProjectId, userId, template);
    console.log(`[chat:${requestId}] Tool context ready, sandboxId: ${context.sandboxId}`);
    
    // Setup template files if sandbox is new (check if package.json exists)
    if (context.sandbox) {
      try {
        await context.sandbox.fs.downloadFile('/workspace/package.json');
        console.log(`[chat:${requestId}] Template files already exist in sandbox`);
      } catch (e) {
        console.log(`[chat:${requestId}] Setting up template files in new sandbox...`);
        if (template === 'vite-react' || !template) {
          const { ViteHandler } = await import('@/app/api/generate/templates/vite-handler');
          const handler = new ViteHandler();
          await handler.setupProject(context.sandbox);
          console.log(`[chat:${requestId}] ✅ Template files uploaded`);
        } else {
          // Next.js template setup
          const fs = await import('fs');
          const path = await import('path');
          const templatesPath = path.join(process.cwd(), 'sandbox-templates');
          const packageJson = fs.readFileSync(path.join(templatesPath, 'package.json'), 'utf-8');
          const nextConfig = fs.readFileSync(path.join(templatesPath, 'next.config.js'), 'utf-8');
          const tailwindConfig = fs.readFileSync(path.join(templatesPath, 'tailwind.config.js'), 'utf-8');
          const postcssConfig = fs.readFileSync(path.join(templatesPath, 'postcss.config.js'), 'utf-8');
          const tsConfig = fs.readFileSync(path.join(templatesPath, 'tsconfig.json'), 'utf-8');
          
          await context.sandbox.fs.createFolder('/workspace/app', '755');
          await context.sandbox.fs.uploadFile(Buffer.from(packageJson), '/workspace/package.json');
          await context.sandbox.fs.uploadFile(Buffer.from(nextConfig), '/workspace/next.config.js');
          await context.sandbox.fs.uploadFile(Buffer.from(tailwindConfig), '/workspace/tailwind.config.js');
          await context.sandbox.fs.uploadFile(Buffer.from(postcssConfig), '/workspace/postcss.config.js');
          await context.sandbox.fs.uploadFile(Buffer.from(tsConfig), '/workspace/tsconfig.json');
          console.log(`[chat:${requestId}] ✅ Next.js template files uploaded`);
        }
      }
    }

    // Handle logo and image uploads to Supabase Storage
    let logoUrl: string | null = null;
    const uploadedImageUrls: string[] = [];
    const uploadedAssets: Array<{ filePath: string; buffer: Buffer; storagePath: string; publicUrl: string }> = [];
    
    // Upload logo if provided
    if (logo && typeof logo === 'string' && logo.trim().length > 0 && context.sandbox) {
      try {
        console.log(`[chat:${requestId}] Uploading logo to Supabase Storage...`);
        const { uploadProjectAsset } = await import('@/lib/storage');
        const { saveProjectAsset } = await import('@/lib/db');
        
        // Convert base64 to Buffer
        const base64Data = logo.replace(/^data:image\/\w+;base64,/, '');
        const logoBuffer = Buffer.from(base64Data, 'base64');
        
        // Determine mime type from base64 data URI
        const mimeMatch = logo.match(/^data:image\/(\w+);base64,/);
        const mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
        const extension = mimeType.split('/')[1] || 'png';
        const logoFilePath = 'public/logo.png'; // Path used in code
        
        // Upload to Supabase Storage
        const uploadResult = await uploadProjectAsset(userId, currentProjectId, {
          name: `logo.${extension}`,
          content: logoBuffer,
          mimeType
        });
        
        logoUrl = uploadResult.publicUrl;
        console.log(`[chat:${requestId}] ✅ Logo uploaded to ${uploadResult.storagePath}`);
        
        // Store asset for copying to sandbox
        uploadedAssets.push({
          filePath: logoFilePath,
          buffer: logoBuffer,
          storagePath: uploadResult.storagePath,
          publicUrl: uploadResult.publicUrl
        });
        
        // Save metadata to project_files (will be linked to build_id later)
        await saveProjectAsset(
          currentProjectId,
          null, // build_id will be set later
          logoFilePath,
          {
            storagePath: uploadResult.storagePath,
            publicUrl: uploadResult.publicUrl,
            mimeType,
            fileSize: logoBuffer.length,
            bucket: 'project-assets'
          }
        );
        
        console.log(`[chat:${requestId}] ✅ Logo metadata saved to project_files`);
      } catch (logoError: any) {
        console.error(`[chat:${requestId}] ⚠️ Failed to upload logo:`, logoError?.message || logoError);
        // Continue without logo if upload fails
        logoUrl = null;
      }
    }
    
    // Upload images if provided
    if (images && Array.isArray(images) && images.length > 0 && context.sandbox) {
      try {
        console.log(`[chat:${requestId}] Uploading ${images.length} image(s) to Supabase Storage...`);
        const { uploadProjectAsset } = await import('@/lib/storage');
        const { saveProjectAsset } = await import('@/lib/db');
        
        for (let i = 0; i < images.length; i++) {
          const imageBase64 = images[i];
          const imageName = imageNames && imageNames[i] ? imageNames[i] : `image-${i + 1}.png`;
          
          try {
            // Convert base64 to Buffer
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            // Determine mime type from base64 data URI
            const mimeMatch = imageBase64.match(/^data:image\/(\w+);base64,/);
            const mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            const extension = mimeType.split('/')[1] || 'png';
            const sanitizedName = imageName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]*$/, '') || `image-${i + 1}`;
            const finalName = `${sanitizedName}.${extension}`;
            const imageFilePath = `public/uploads/${finalName}`; // Path used in code
            
            // Upload to Supabase Storage
            const uploadResult = await uploadProjectAsset(userId, currentProjectId, {
              name: finalName,
              content: imageBuffer,
              mimeType
            });
            
            uploadedImageUrls.push(uploadResult.publicUrl);
            console.log(`[chat:${requestId}] ✅ Image ${i + 1} uploaded to ${uploadResult.storagePath}`);
            
            // Store asset for copying to sandbox
            uploadedAssets.push({
              filePath: imageFilePath,
              buffer: imageBuffer,
              storagePath: uploadResult.storagePath,
              publicUrl: uploadResult.publicUrl
            });
            
            // Save metadata to project_files
            await saveProjectAsset(
              currentProjectId,
              null, // build_id will be set later
              imageFilePath,
              {
                storagePath: uploadResult.storagePath,
                publicUrl: uploadResult.publicUrl,
                mimeType,
                fileSize: imageBuffer.length,
                bucket: 'project-assets'
              }
            );
          } catch (imageError: any) {
            console.error(`[chat:${requestId}] ⚠️ Failed to upload image ${i + 1}:`, imageError?.message || imageError);
            // Continue with other images
          }
        }
        
        console.log(`[chat:${requestId}] ✅ Uploaded ${uploadedImageUrls.length} image(s) to Supabase Storage`);
      } catch (imagesError: any) {
        console.error(`[chat:${requestId}] ⚠️ Failed to upload images:`, imagesError?.message || imagesError);
        // Continue without images if upload fails
      }
    }

    // Copy newly uploaded assets directly to sandbox (before getting project files)
    if (context.sandbox && uploadedAssets.length > 0) {
      try {
        console.log(`[chat:${requestId}] Copying ${uploadedAssets.length} newly uploaded asset(s) to sandbox...`);
        for (const asset of uploadedAssets) {
          try {
            const sandboxPath = `/workspace/${asset.filePath}`;
            
            // Create directory if needed
            const dirPath = sandboxPath.substring(0, sandboxPath.lastIndexOf('/'));
            if (dirPath && dirPath !== '/workspace') {
              try {
                await context.sandbox.fs.createFolder(dirPath, '755');
              } catch (e) {
                // Folder might already exist
              }
            }
            
            // Upload asset to sandbox
            await context.sandbox.fs.uploadFile(asset.buffer, sandboxPath);
            console.log(`[chat:${requestId}] ✅ Copied asset ${asset.filePath} to sandbox`);
          } catch (assetError: any) {
            console.error(`[chat:${requestId}] ⚠️ Failed to copy asset ${asset.filePath}:`, assetError?.message || assetError);
          }
        }
      } catch (assetsError: any) {
        console.error(`[chat:${requestId}] ⚠️ Failed to copy assets to sandbox:`, assetsError?.message || assetsError);
      }
    }

    // Get existing files for context (if project exists)
    // This now includes the newly uploaded assets since we saved them to project_files
    let existingFiles = currentProjectId ? await getProjectFiles(currentProjectId) : [];
    
    // Copy existing assets from previous builds to sandbox
    if (context.sandbox && currentProjectId) {
      try {
        console.log(`[chat:${requestId}] Copying existing project assets to sandbox...`);
        const { downloadProjectAsset } = await import('@/lib/storage');
        
        // Filter for asset files (excluding newly uploaded ones that we already copied)
        const uploadedFilePaths = new Set(uploadedAssets.map(a => a.filePath));
        const existingAssetFiles = existingFiles.filter((file: any) => {
          try {
            const content = JSON.parse(file.file_content);
            if (content.type === 'asset') {
              // Skip if we already copied this asset
              return !uploadedFilePaths.has(file.file_path);
            }
            return false;
          } catch {
            return false;
          }
        });
        
        console.log(`[chat:${requestId}] Found ${existingAssetFiles.length} existing asset file(s) to copy to sandbox`);
        
        // Copy each existing asset to sandbox
        for (const assetFile of existingAssetFiles) {
          try {
            const assetMetadata = JSON.parse(assetFile.file_content);
            if (assetMetadata.type === 'asset') {
              // Download asset from Supabase Storage
              const assetBuffer = await downloadProjectAsset(
                assetMetadata.storage_path,
                assetMetadata.bucket || 'project-assets'
              );
              
              if (assetBuffer) {
                // Copy to sandbox at the specified file_path
                const sandboxPath = `/workspace/${assetFile.file_path}`;
                
                // Create directory if needed
                const dirPath = sandboxPath.substring(0, sandboxPath.lastIndexOf('/'));
                if (dirPath && dirPath !== '/workspace') {
                  try {
                    await context.sandbox.fs.createFolder(dirPath, '755');
                  } catch (e) {
                    // Folder might already exist
                  }
                }
                
                // Upload asset to sandbox
                await context.sandbox.fs.uploadFile(assetBuffer, sandboxPath);
                console.log(`[chat:${requestId}] ✅ Copied existing asset ${assetFile.file_path} to sandbox`);
              } else {
                console.warn(`[chat:${requestId}] ⚠️ Failed to download existing asset ${assetFile.file_path} from storage`);
              }
            }
          } catch (assetError: any) {
            console.error(`[chat:${requestId}] ⚠️ Failed to copy existing asset ${assetFile.file_path}:`, assetError?.message || assetError);
            // Continue with other assets
          }
        }
      } catch (existingAssetsError: any) {
        console.error(`[chat:${requestId}] ⚠️ Failed to copy existing assets to sandbox:`, existingAssetsError?.message || existingAssetsError);
        // Continue without existing assets if copy fails
      }
    }
    let fileContext = '';
    let hasCodeChanges = false;
    let finalResponse = '';
    let iteration = 0;
    const geminiHistory: any[] = [];
    let skipToolLoop = false;

    const projectSummary = buildProjectSummary(existingFiles as ProjectFileRecord[]);
    const needsFreshPlan =
      !projectMetadata?.plan ||
      (typeof projectMetadata.plan === 'string' && projectMetadata.plan.trim().length === 0);

    let planJson: any = null;

    // If planData is provided (from multi-step planning), use it directly
    if (planData && typeof planData === 'object') {
      console.log(`[chat:${requestId}] Using provided plan data from multi-step planning`);
      planJson = planData;
      
      // Enhance plan with style, colors, and additional info
      if (selectedStyle) {
        planJson.design_language = selectedStyle;
      }
      if (colors && Array.isArray(colors) && colors.length > 0) {
        planJson.colors = colors;
        // Update visual_guidelines with colors
        if (!planJson.visual_guidelines) {
          planJson.visual_guidelines = {};
        }
        planJson.visual_guidelines.color_palette = colors.map((color: string, index: number) => ({
          name: index === 0 ? 'primary' : index === 1 ? 'secondary' : `accent-${index - 1}`,
          hex: color,
        }));
      }
      if (additionalInfo) {
        planJson.additional_info = additionalInfo;
      }
      if (selectedPages && Array.isArray(selectedPages)) {
        // Filter routes to only include selected pages
        if (planJson.routes && Array.isArray(planJson.routes)) {
          const selectedPaths = new Set(selectedPages.map((p: any) => p.path || p));
          planJson.routes = planJson.routes.filter((route: any) => 
            selectedPaths.has(route.path) || route.path === '/'
          );
        }
      }
      
      const planString = JSON.stringify(planJson);
      if (projectMetadata) {
        projectMetadata.plan = planString;
        projectMetadataChanged = true;
      }
      addStatus(requestId, 'planning', 'Using selected plan configuration', 12);
    } else {
      // Original planning flow
      try {
        addStatus(
          requestId,
          'planning',
          needsFreshPlan ? 'Planning your project structure…' : 'Updating project plan…',
          8
        );
        const { planString, planJson: generatedPlan } = await generateProjectPlan(
          requestId,
          trimmedMessage || message,
          template || 'vite-react',
          projectMetadata?.plan ?? null,
          projectSummary
        );

        if (planString) {
          planJson = generatedPlan;
          if (projectMetadata) {
            projectMetadata.plan = planString;
            projectMetadataChanged = true;
          }
          addStatus(requestId, 'planning', 'Project plan finalized', 12);
        } else if (projectMetadata?.plan) {
          debugLog(requestId, '📋 Reusing existing project plan', {
            planPreview: projectMetadata.plan.slice(0, 500),
          });
        } else {
          console.warn(`[chat:${requestId}] ⚠️ Project plan generation returned empty plan.`);
        }
      } catch (planError: any) {
        console.error(`[chat:${requestId}] ⚠️ Project planning failed:`, planError?.message || planError);
      }
    }

    if (!planJson && projectMetadata?.plan) {
      try {
        planJson = JSON.parse(projectMetadata.plan);
      } catch (planParseError) {
        console.error(`[chat:${requestId}] ⚠️ Failed to parse stored plan JSON:`, planParseError);
      }
    }

    const paletteResult = applyPlanColorPalette(planJson, projectMetadata, projectMetadataChanged);
    projectMetadata = paletteResult.metadata;
    projectMetadataChanged = paletteResult.changed;

    if (projectMetadata) {
      projectMetadataString = await ensureProjectMetadata(
        context,
        currentProjectId,
        projectMetadata,
        projectMetadataChanged,
        projectRecord.description
      );
      projectRecord.description = projectMetadataString;
      projectMetadataChanged = false;
    }

    const planStringForUse = projectMetadata?.plan ?? null;

    const isNewProject = existingFiles.length === 0;

    if (isNewProject && context.sandbox && planJson && planStringForUse) {
      try {
        addStatus(requestId, 'setup', 'Installing dependencies...', 15);
        console.log(`[chat:${requestId}] Installing dependencies before sequential workflow...`);
        await context.sandbox.process.executeCommand('cd /workspace && npm install');
        addStatus(requestId, 'setup', 'Dependencies installed', 18);

        const taskFlow = buildTaskFlowFromPlan(planJson);
        if (taskFlow.length === 0) {
          console.warn(`[chat:${requestId}] ⚠️ Plan did not yield any tasks; falling back to interactive loop.`);
        } else {
          console.log(`[chat:${requestId}] Starting sequential workflow (${taskFlow.length} task(s))`);
          addStatus(requestId, 'components', `Building ${taskFlow.length} components...`, 30);
          // Build enhanced system prompt with style and color instructions
          let enhancedInstruction = instruction.toString();
          if (selectedStyle || colors || logoUrl || (uploadedAssets && uploadedAssets.length > 0)) {
            const styleInstructions = buildStyleInstructions(selectedStyle, colors, logoUrl, uploadedAssets || []);
            enhancedInstruction = `${instruction}\n\n## Style & Design Requirements\n\n${styleInstructions}`;
          }

          const workflowResult = await executeSequentialWorkflow(
            gemini,
            openai,
            context.sandbox,
            enhancedInstruction,
            planStringForUse,
            taskFlow,
            images,
            imageNames,
            requestId,
            trimmedMessage || message
          );
          console.log(
            `[chat:${requestId}] Sequential workflow complete. Generated files=${workflowResult.files.length}`
          );
          
          // Generate missing images referenced in code (e.g., /generated-images/...)
          if (context.sandbox) {
            try {
              const { localizeRemoteImages } = await import('@/lib/tool-orchestrator');
              console.log(`[chat:${requestId}] Generating missing images referenced in code...`);
              await localizeRemoteImages(context);
              console.log(`[chat:${requestId}] ✅ Image generation complete`);
            } catch (imageError: any) {
              console.warn(`[chat:${requestId}] ⚠️ Failed to generate missing images:`, imageError.message);
            }
          }
          
          skipToolLoop = true;
          hasCodeChanges = workflowResult.files.length > 0;
          finalResponse =
            workflowResult.files.length > 0
              ? `Generated ${workflowResult.files.length} files from the project plan.`
              : 'Project plan processed, but no files were produced.';
          addStatus(requestId, 'components', 'Component generation complete', 60);
        }
      } catch (sequentialError: any) {
        console.error(`[chat:${requestId}] ⚠️ Sequential workflow failed:`, sequentialError?.message || sequentialError);
      }
    }

    // For amendments: Use vector DB semantic search to find relevant files
    if (projectMetadataString) {
      upsertMetadataFile(existingFiles, projectMetadataString, currentProjectId);
    }

    if (!skipToolLoop && currentProjectId && existingFiles.length > 0) {
      try {
        const { embedTexts } = await import('@/lib/embeddings');
        const { matchFileChunks, getLatestBuildId } = await import('@/lib/db');
        
        const latestBuildId = await getLatestBuildId(currentProjectId);
        if (latestBuildId) {
          console.log(`[chat:${requestId}] Using latest build_id for vector search: ${latestBuildId}`);
        }
        
        // Embed the user's message to find semantically relevant files
        const [queryEmbedding] = await embedTexts([message]);
        const matches = await matchFileChunks(currentProjectId, queryEmbedding, 30, latestBuildId);
        const topFiles = Array.from(new Set(matches.map(m => m.file_path))).slice(0, 12);
        
        console.log(`[chat:${requestId}] Vector search found ${matches.length} chunks, top files: ${topFiles.slice(0, 5).join(', ')}`);
        
        // Get full content of top relevant files
        const relevantFiles = existingFiles.filter(f => topFiles.includes(f.file_path));
        
        // Also include critical files (App.tsx, main.tsx, package.json, etc.)
        const criticalFiles = existingFiles.filter((f) =>
          [
            'src/App.tsx',
            'src/main.tsx',
            'package.json',
            'index.html',
            'src/index.css',
            'tailwind.config.ts',
            PROJECT_METADATA_RELATIVE_PATH
          ].includes(f.file_path)
        );
        
        // Combine relevant and critical files, deduplicate
        const allContextFiles = Array.from(
          new Map([...relevantFiles, ...criticalFiles].map(f => [f.file_path, f])).values()
        );

        const metadataIndex = allContextFiles.findIndex(f => f.file_path === PROJECT_METADATA_RELATIVE_PATH);
        if (metadataIndex > 0) {
          const [metadataFile] = allContextFiles.splice(metadataIndex, 1);
          allContextFiles.unshift(metadataFile);
        }
        
        // Build context from semantically relevant files
        fileContext = allContextFiles
          .slice(0, 15) // Limit to top 15 files
          .map(f => {
            const fileContent = f.file_content || '';
            // Include more content for relevant files (up to 2000 chars)
            const previewLength = topFiles.includes(f.file_path) ? 2000 : 500;
            return `FILE: ${f.file_path}\n${fileContent.substring(0, previewLength)}${fileContent.length > previewLength ? '...' : ''}`;
          })
          .join('\n\n');
        
        console.log(`[chat:${requestId}] Built context from ${allContextFiles.length} files (${relevantFiles.length} from vector search, ${criticalFiles.length} critical)`);
      } catch (vectorError: any) {
        console.error(`[chat:${requestId}] Vector search failed, falling back to file list:`, vectorError.message);
        // Fallback to original behavior
        const fallbackFiles = existingFiles
          .slice(0, 20);

        const fallbackMetadataIndex = fallbackFiles.findIndex(f => f.file_path === PROJECT_METADATA_RELATIVE_PATH);
        if (fallbackMetadataIndex > 0) {
          const [metadataFile] = fallbackFiles.splice(fallbackMetadataIndex, 1);
          fallbackFiles.unshift(metadataFile);
        }

        fileContext = fallbackFiles
          .map(f => `FILE: ${f.file_path}\n${f.file_content.substring(0, 500)}${f.file_content.length > 500 ? '...' : ''}`)
          .join('\n\n');
      }
    } else if (!skipToolLoop && existingFiles.length > 0) {
      // For new projects or if vector search isn't available, use first 20 files
      fileContext = existingFiles
        .slice(0, 20)
        .map(f => `FILE: ${f.file_path}\n${f.file_content.substring(0, 500)}...`)
        .join('\n\n');
    }

    // Load conversation history (last 50 messages for context)
    const history = currentProjectId ? await getConversationHistory(currentProjectId, 50) : [];
    console.log(`[chat:${requestId}] Loaded ${history.length} messages from history`);

    if (!skipToolLoop) {
      // Build initial messages with conversation history
    const messages: any[] = [
      {
        role: 'system',
        content: instruction,
      },
    ];

    if (projectMetadataString) {
      messages.push({
        role: 'system',
        content: `PROJECT BRIEF:\n${projectMetadataString}`
      });
    }

    if (projectMetadata?.plan) {
      messages.push({
        role: 'system',
        content: `PROJECT PLAN:\n${projectMetadata.plan}`
      });
    }

    // Add conversation history (excluding system messages)
    for (const msg of history) {
      if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          name: msg.tool_name,
          content: msg.content,
        });
      } else {
        messages.push({
          role: msg.role,
          content: msg.content,
          // Reconstruct tool_calls if this was an assistant message with tools
          tool_calls: msg.metadata?.tool_calls || undefined,
        });
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message + (fileContext ? `\n\nCurrent project files:\n${fileContext}` : '\n\nThis is a new project.'),
    });

    // Execute tool calls iteratively (support multiple rounds)
    iteration = 0;
    finalResponse = '';
    hasCodeChanges = false;
    geminiHistory.length = 0;
    const maxIterations = 10; // Prevent infinite loops
    let recitationRetry = false;

    // Convert initial messages to Gemini format
    const geminiMessages = convertMessagesToGemini(messages);
    geminiHistory.push(...geminiMessages);

    const systemInstructionContent: any = {
      role: 'user',
      parts: [{ text: instruction }],
    };

    // Initial AI call with Gemini
    console.log(`[chat:${requestId}] Calling Gemini 2.5 Flash with ${geminiHistory.length} messages...`);
    
    let geminiResponse: any;
    try {
      console.log(`[chat:${requestId}] Gemini API call params:`, {
        model: 'gemini-2.5-flash',
        historyLength: geminiHistory.length,
        hasSystemInstruction: !!instruction,
        toolsCount: GEMINI_TOOLS[0]?.functionDeclarations?.length || 0,
      });
      
      geminiResponse = await gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: geminiHistory,
        config: {
          systemInstruction: systemInstructionContent,
          tools: GEMINI_TOOLS as any,
          temperature: 0.6,
        },
      });
      
      console.log(`[chat:${requestId}] Gemini API call successful`);
      
      // Log the actual response object structure
      console.log(`[chat:${requestId}] Response object type:`, typeof geminiResponse);
      console.log(`[chat:${requestId}] Response object keys:`, Object.keys(geminiResponse || {}));
      console.log(`[chat:${requestId}] Response has .text:`, !!geminiResponse?.text);
      console.log(`[chat:${requestId}] Response has .candidates:`, !!geminiResponse?.candidates);
      if (geminiResponse?.text) {
        console.log(`[chat:${requestId}] Response .text length:`, geminiResponse.text.length);
        console.log(`[chat:${requestId}] Response .text preview:`, geminiResponse.text.substring(0, 300));
      }
    } catch (error: any) {
      console.error(`[chat:${requestId}] Gemini API error:`, error);
      console.error(`[chat:${requestId}] Error details:`, {
        message: error.message,
        stack: error.stack,
        response: error.response,
      });
      throw error;
    }

    console.log(`[chat:${requestId}] Gemini response received`);
    console.log(`[chat:${requestId}] Raw Gemini response structure:`, JSON.stringify({
      hasCandidates: !!geminiResponse.candidates,
      candidatesLength: geminiResponse.candidates?.length || 0,
      firstCandidate: geminiResponse.candidates?.[0] ? {
        hasContent: !!geminiResponse.candidates[0].content,
        hasParts: !!geminiResponse.candidates[0].content?.parts,
        partsLength: geminiResponse.candidates[0].content?.parts?.length || 0,
        partsTypes: geminiResponse.candidates[0].content?.parts?.map((p: any) => Object.keys(p)) || [],
        finishReason: geminiResponse.candidates[0].finishReason,
      } : null,
      hasText: !!geminiResponse.text,
      textLength: geminiResponse.text?.length || 0,
    }, null, 2));
    
    // Check for safety or other abnormal finish reasons
    let finishReason = geminiResponse.candidates?.[0]?.finishReason;
    const needsRetryReasons = new Set(['RECITATION', 'SAFETY', 'MAX_TOKENS', 'OTHER']);
    if (finishReason && finishReason !== 'STOP' && needsRetryReasons.has(finishReason)) {
      console.warn(`[chat:${requestId}] ⚠️ Non-STOP finish reason: ${finishReason}`);

      if (hasCodeChanges && finishReason !== 'MAX_TOKENS') {
        console.log(`[chat:${requestId}] ⚠️ ${finishReason} detected but code changes already exist, continuing with existing changes...`);
      } else {
        console.log(`[chat:${requestId}] Attempting fallback retry for finish reason ${finishReason}...`);
        if (recitationRetry) {
          console.error(`[chat:${requestId}] ❌ Retry already attempted, aborting.`);
          return NextResponse.json({
            success: false,
            error: 'The model could not safely process the request. Please rephrase or break it into smaller steps.',
            finishReason,
          }, { status: 400 });
        }

        recitationRetry = true;

        try {
          let retryMessages = messages.map((m) => ({ ...m }));

          if (finishReason === 'MAX_TOKENS') {
            const lastIndex = retryMessages.findIndex((m) => m.role === 'user');
            if (lastIndex >= 0) {
              retryMessages[lastIndex] = {
                ...retryMessages[lastIndex],
                content: `${(trimmedMessage || message).slice(0, 2000)}\n\nFocus on core layout and sections only.`
              };
            }
            console.log(`[chat:${requestId}] 🔁 MAX_TOKENS retry: truncating user prompt to 2000 chars`);
          } else {
            console.log(`[chat:${requestId}] 🔁 Retry with original system prompt for finish reason ${finishReason}`);
          }

          const retryHistory = convertMessagesToGemini(retryMessages);

          const retryResponse = await gemini.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: retryHistory,
            config: {
              systemInstruction: systemInstructionContent,
              tools: GEMINI_TOOLS as any,
              temperature: 0.8,
            },
          });

          const retryFinishReason = retryResponse.candidates?.[0]?.finishReason;
          if (retryFinishReason && retryFinishReason !== 'STOP') {
            console.error(`[chat:${requestId}] ❌ Retry also blocked with finish reason: ${retryFinishReason}`);
            return NextResponse.json({
              success: false,
              error: 'The model could not safely process the request. Please rephrase or break it into smaller steps.',
              finishReason: retryFinishReason,
            }, { status: 400 });
          }

          console.log(`[chat:${requestId}] ✅ Retry successful, using retry response`);
          geminiHistory.length = 0;
          geminiHistory.push(...retryHistory);
          geminiResponse = retryResponse;
          finishReason = retryFinishReason; // Update finish reason
        } catch (retryError: any) {
          console.error(`[chat:${requestId}] ❌ Retry failed:`, retryError);
          return NextResponse.json({
            success: false,
            error: 'The model could not safely process the request. Please rephrase or break it into smaller steps.',
            finishReason,
          }, { status: 400 });
        }
      }
    } else if (finishReason && finishReason !== 'STOP') {
      console.warn(`[chat:${requestId}] ⚠️ Unexpected finish reason without retry path: ${finishReason}`);
    }
    
    // Extract function calls and text from response
    const functionCalls = extractFunctionCalls(geminiResponse);
    const responseText = getGeminiText(geminiResponse);
    console.log(`[chat:${requestId}] Function calls: ${functionCalls.length}, Text length: ${responseText.length}`);
    if (functionCalls.length > 0) {
      console.log(`[chat:${requestId}] Function calls details:`, functionCalls);
    }
    if (responseText) {
      console.log(`[chat:${requestId}] Response text preview:`, responseText.substring(0, 200));
    }

    // Add model response to history
    if (responseText || functionCalls.length > 0) {
      const modelParts: any[] = [];
      if (responseText) {
        modelParts.push({ text: responseText });
      }
      for (const fc of functionCalls) {
        modelParts.push({
          functionCall: {
            id: fc.id,
            name: fc.name,
            args: fc.args,
          },
        });
      }
      geminiHistory.push({
        role: 'model',
        parts: modelParts,
      });
    }

    // Process function calls iteratively
    while (functionCalls.length > 0 && iteration < maxIterations) {
      iteration++;
      console.log(`[chat:${requestId}] Iteration ${iteration}/${maxIterations}, processing ${functionCalls.length} function calls`);

      // Execute all function calls in parallel
      const functionResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const toolName = fc.name;
          const params = fc.args;
          console.log(`[chat:${requestId}] Executing tool: ${toolName}`, params);

          // Track if this is a code-modifying tool
          if (['lov-write', 'lov-line-replace', 'lov-delete', 'lov-rename'].includes(toolName)) {
            hasCodeChanges = true;
            console.log(`[chat:${requestId}] Code-modifying tool detected: ${toolName}`);
          }

          const result = await executeTool(toolName, params, context);
          console.log(`[chat:${requestId}] Tool ${toolName} result:`, { success: result.success, error: result.error });
          
          return {
             functionResponse: {
               name: toolName,
               response: result,
             },
            callId: fc.id,
          };
        })
      );

      // Add function responses to history
      for (const responsePart of functionResponses) {
        geminiHistory.push({
          role: 'function',
          parts: [{
            functionResponse: responsePart.functionResponse,
            functionCallId: responsePart.callId,
          }],
        });
      }

      // Get AI's follow-up response
      console.log(`[chat:${requestId}] Getting Gemini follow-up response...`);
      try {
        geminiResponse = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: geminiHistory,
        config: {
          systemInstruction: systemInstructionContent,
            tools: GEMINI_TOOLS as any,
            temperature: 0.6,
          },
        });

        // Check for RECITATION in follow-up response
        const followUpFinishReason = geminiResponse.candidates?.[0]?.finishReason;
        if (followUpFinishReason === 'RECITATION') {
          console.warn(`[chat:${requestId}] ⚠️ RECITATION in follow-up response`);
          // If we already have code changes, break the loop and continue with what we have
          if (hasCodeChanges) {
            console.log(`[chat:${requestId}] Code changes exist, breaking loop despite RECITATION`);
            break;
          }
          // Otherwise, continue to try extracting function calls (might have some before RECITATION)
        }
        
        const newFunctionCalls = extractFunctionCalls(geminiResponse);
        const newResponseText = getGeminiText(geminiResponse);
        
        // Deduplicate function calls by name + args (simple string comparison)
        const seen = new Set<string>();
        const uniqueFunctionCalls = newFunctionCalls.filter(fc => {
          const key = `${fc.name}:${JSON.stringify(fc.args)}`;
          if (seen.has(key)) {
            console.log(`[chat:${requestId}] Skipping duplicate function call: ${fc.name}`);
            return false;
          }
          seen.add(key);
          return true;
        });
        
        // Update for next iteration
        functionCalls.length = 0; // Clear array
        functionCalls.push(...uniqueFunctionCalls);
        finalResponse = newResponseText || finalResponse;

        console.log(`[chat:${requestId}] Follow-up: ${uniqueFunctionCalls.length} unique function calls (${newFunctionCalls.length} total), ${newResponseText.length} chars text`);

        // Add model response to history (use unique calls)
        if (newResponseText || uniqueFunctionCalls.length > 0) {
          const modelParts: any[] = [];
          if (newResponseText) {
            modelParts.push({ text: newResponseText });
          }
          for (const fc of uniqueFunctionCalls) {
            modelParts.push({
              functionCall: {
                id: fc.id,
                name: fc.name,
                args: fc.args,
              },
            });
          }
          geminiHistory.push({
            role: 'model',
            parts: modelParts,
          });
        }

        // If no more function calls, break
        if (uniqueFunctionCalls.length === 0) {
          console.log(`[chat:${requestId}] No more function calls, breaking loop`);
          break;
        }
      } catch (error: any) {
        console.error(`[chat:${requestId}] Gemini follow-up error:`, error);
        break;
      }
    }

    // Use final response text
    if (!finalResponse && geminiHistory.length > 0) {
      const lastModelMsg = geminiHistory.filter(m => m.role === 'model').pop();
      if (lastModelMsg?.parts) {
        finalResponse = lastModelMsg.parts
          .filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join('');
      }
    }
    
    console.log(`[chat:${requestId}] Final response length: ${finalResponse.length}`);
    console.log(`[chat:${requestId}] Final response length: ${finalResponse.length}`);
    console.log(`[chat:${requestId}] Has code changes: ${hasCodeChanges}`);
    console.log(`[chat:${requestId}] Iterations completed: ${iteration}`);
    console.log(`[chat:${requestId}] Sandbox available: ${!!context.sandbox}`);
    }

    // If no tools were called and this is a new project, we need to create files
    if (iteration === 0 && !projectId && !hasCodeChanges) {
      console.log(`[chat:${requestId}] No tools called for new project - AI may need to be prompted to use tools`);
      // Return error to user
      return NextResponse.json({
        success: false,
        error: 'The AI did not generate any code. Please try again with a more specific prompt.',
        message: finalResponse || 'No response generated',
      }, { status: 400 });
    }

    // Ensure critical files exist (src/lib/utils.ts, etc.)
    if (hasCodeChanges && context.sandbox) {
      try {
        console.log(`[chat:${requestId}] Checking for critical files...`);
        
        // Check if src/lib/utils.ts exists
        try {
          await context.sandbox.fs.downloadFile('/workspace/src/lib/utils.ts');
          console.log(`[chat:${requestId}] ✅ src/lib/utils.ts exists`);
        } catch (e) {
          console.log(`[chat:${requestId}] ⚠️ src/lib/utils.ts missing, creating it...`);
          // Create src/lib/utils.ts if missing
          const utilsContent = `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`;
          await context.sandbox.fs.createFolder('/workspace/src/lib', '755');
          await context.sandbox.fs.uploadFile(
            Buffer.from(utilsContent),
            '/workspace/src/lib/utils.ts'
          );
          console.log(`[chat:${requestId}] ✅ Created src/lib/utils.ts`);
        }
        
        // Check if src/hooks/use-mobile.ts exists (needed by sidebar)
        try {
          await context.sandbox.fs.downloadFile('/workspace/src/hooks/use-mobile.ts');
          console.log(`[chat:${requestId}] ✅ src/hooks/use-mobile.ts exists`);
        } catch (e) {
          console.log(`[chat:${requestId}] ⚠️ src/hooks/use-mobile.ts missing, creating it...`);
          const useMobileContent = `import { useEffect, useState } from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(false)

  useEffect(() => {
    const mql = window.matchMedia(\`(max-width: \${MOBILE_BREAKPOINT - 1}px)\`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
`;
          await context.sandbox.fs.createFolder('/workspace/src/hooks', '755');
          await context.sandbox.fs.uploadFile(
            Buffer.from(useMobileContent),
            '/workspace/src/hooks/use-mobile.ts'
          );
          console.log(`[chat:${requestId}] ✅ Created src/hooks/use-mobile.ts`);
        }
        
        // Validate imports after tool execution
        console.log(`[chat:${requestId}] Validating imports after tool execution...`);
        const { validateImports } = await import('@/lib/tool-orchestrator');
        const importValidation = await validateImports(context);
        if (!importValidation.valid) {
          console.warn(`[chat:${requestId}] ⚠️ Import validation found issues:`);
          importValidation.errors.forEach((err: string) => console.warn(`[chat:${requestId}]   - ${err}`));
          // The validation function will try to auto-create missing files
        } else {
          console.log(`[chat:${requestId}] ✅ All imports validated`);
        }
      } catch (criticalFileError: any) {
        console.error(`[chat:${requestId}] Error ensuring critical files:`, criticalFileError);
        // Don't fail the request if this fails
      }
    }

    // Create build record BEFORE saving files (if code was modified)
    let buildRecord: any = null;
    if (hasCodeChanges && currentProjectId) {
      try {
        const { createBuild } = await import('@/lib/db');
        buildRecord = await createBuild(currentProjectId, userId, {});
        console.log(`[chat:${requestId}] ✅ Created build record: ${buildRecord?.id} (version: ${buildRecord?.version})`);
      } catch (buildRecordError: any) {
        console.error(`[chat:${requestId}] ⚠️ Failed to create build record:`, buildRecordError.message);
        // Continue without build record (files will be saved without build_id)
      }
    }

    // Validate and fix config files BEFORE saving to database (so frontend doesn't see duplicates)
    if (hasCodeChanges && context.sandbox) {
      try {
        const { validateAndFixConfigFiles } = await import('@/lib/tool-orchestrator');
        await validateAndFixConfigFiles(context);
        console.log(`[chat:${requestId}] ✅ Config files validated and fixed before saving`);
      } catch (configError: any) {
        console.warn(`[chat:${requestId}] ⚠️ Config validation failed:`, configError.message);
      }
    }

    let savedSourceFiles: Array<{ path: string; content: string }> = [];

    // Save project files to database after tool execution (so frontend can display them)
    if (hasCodeChanges && context.sandbox && currentProjectId) {
      try {
        console.log(`[chat:${requestId}] Saving project files to database...`);
        const { saveProjectFilesToBuild } = await import('@/lib/db');
        
        // Get all source files from sandbox
        const sourceFiles: Array<{ path: string; content: string }> = [];
        
        // Get all files from workspace - use a more comprehensive find command
        try {
          // Find all source files, excluding node_modules and dist
          const findResult = await context.sandbox.process.executeCommand(
            'cd /workspace && find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.css" -o -name "*.json" -o -name "*.html" -o -name "*.svg" \\) ! -path "*/node_modules/*" ! -path "*/dist/*" ! -path "*/.git/*" | head -100'
          );
          
          if (findResult.result) {
            const filePaths = findResult.result.trim().split('\n').filter((p: string) => {
              const path = p.trim();
              return path && 
                     !path.includes('node_modules') && 
                     !path.includes('dist') &&
                     !path.includes('.git');
            });
            
            console.log(`[chat:${requestId}] Found ${filePaths.length} files to save`);
            
            // Filter out duplicate tailwind.config.js if tailwind.config.ts exists
            const hasTailwindTs = filePaths.some((p: string) => p.includes('tailwind.config.ts'));
            const filteredFilePaths = filePaths.filter((p: string) => {
              // Exclude tailwind.config.js if tailwind.config.ts exists
              if (p.includes('tailwind.config.js') && hasTailwindTs) {
                console.log(`[chat:${requestId}] Skipping duplicate tailwind.config.js (tailwind.config.ts exists)`);
                return false;
              }
              return true;
            });
            
            for (const filePath of filteredFilePaths) {
              try {
                const normalizedPath = filePath.startsWith('./') ? filePath.substring(2) : filePath.replace('/workspace/', '');
                if (
                  normalizedPath.endsWith('package-lock.json') ||
                  normalizedPath.endsWith('pnpm-lock.yaml') ||
                  normalizedPath.endsWith('yarn.lock')
                ) {
                  console.log(`[chat:${requestId}] Skipping lock file ${normalizedPath}`);
                  continue;
                }
                const fullPath = `/workspace/${normalizedPath}`;
                const content = await context.sandbox.fs.downloadFile(fullPath);
                sourceFiles.push({
                  path: normalizedPath,
                  content: content.toString('utf-8'),
                });
              } catch (e: any) {
                // Skip files that can't be read (like deleted tailwind.config.js)
                console.warn(`[chat:${requestId}] Could not read file ${filePath}:`, e.message);
              }
            }
          } else {
            console.warn(`[chat:${requestId}] No files found in workspace`);
          }
        } catch (e: any) {
          console.error(`[chat:${requestId}] Error finding files:`, e.message);
        }
        
        if (sourceFiles.length > 0) {
          // Save files with build_id if available
          const targetBuildId = buildRecord?.id || null;
          await saveProjectFilesToBuild(currentProjectId, targetBuildId, sourceFiles);
          if (targetBuildId) {
            console.log(`[chat:${requestId}] ✅ Saved ${sourceFiles.length} files to database with build_id: ${targetBuildId}`);
          } else {
            console.warn(`[chat:${requestId}] ⚠️ Saved ${sourceFiles.length} files without build_id`);
          }
          savedSourceFiles = sourceFiles;
        }
      } catch (fileSaveError: any) {
        console.error(`[chat:${requestId}] Error saving files to database:`, fileSaveError);
        // Don't fail the request if file saving fails
      }
    }

    // Build and upload if code was modified
    let previewUrl: string | null = null;
    console.log(`[chat:${requestId}] ====== BUILD CHECK ======`);
    console.log(`[chat:${requestId}] hasCodeChanges: ${hasCodeChanges}`);
    console.log(`[chat:${requestId}] context.sandbox: ${!!context.sandbox}`);
    console.log(`[chat:${requestId}] currentProjectId: ${currentProjectId}`);
    
    if (hasCodeChanges && context.sandbox) {
      console.log(`[chat:${requestId}] ✅ Code was modified and sandbox available, starting build...`);
      try {
        const { buildAndUploadProject } = await import('@/lib/tool-orchestrator');
        console.log(`[chat:${requestId}] Calling buildAndUploadProject...`);
        const buildResult = await buildAndUploadProject(context, userId);
        console.log(`[chat:${requestId}] buildAndUploadProject returned:`, { 
          success: !!buildResult,
          type: typeof buildResult 
        });

        if (buildResult) {
          previewUrl = `/api/preview/${userId}/${currentProjectId}?path=index.html&t=${Date.now()}`;
          console.log(`[chat:${requestId}] ✅ Build successful, preview URL: ${previewUrl}`);
          
          // Update build record with success
          if (buildRecord?.id) {
            try {
              const { finalizeBuild, linkAssetsToBuild } = await import('@/lib/db');
              
              // Link assets to build_id
              await linkAssetsToBuild(currentProjectId, buildRecord.id);
              
              // Finalize build
              await finalizeBuild(buildRecord.id, 'success');
              console.log(`[chat:${requestId}] ✅ Finalized build record: ${buildRecord.id}`);
            } catch (finalizeError: any) {
              console.error(`[chat:${requestId}] ⚠️ Failed to finalize build record:`, finalizeError.message);
            }
          }
          
          // Update project with preview URL
          await updateProject(currentProjectId, {
            preview_url: previewUrl,
            status: 'active',
          });
          console.log(`[chat:${requestId}] ✅ Project updated with preview URL`);

          if (savedSourceFiles.length > 0) {
            try {
              const { embedTexts, codeAwareChunks } = await import('@/lib/embeddings');
              const { saveFileChunks } = await import('@/lib/db');

              const buildIdForChunks = buildRecord?.id || null;
              const chunkCandidates = savedSourceFiles.filter((f) => !f.path.startsWith('src/components/ui/'));
              console.log(
                `[chat:${requestId}] Chunking and embedding ${chunkCandidates.length} file(s) for vector DB (build_id: ${buildIdForChunks})...`
              );

              const allChunks: Array<{ file_path: string; chunk_index: number; content: string }> = [];
              for (const f of chunkCandidates) {
                const parts = codeAwareChunks(f.path, f.content);
                parts.forEach((p, i) => allChunks.push({ file_path: f.path, chunk_index: i, content: p }));
              }

              const oversizedChunks = allChunks.filter((c) => c.content.length > 2000);
              if (oversizedChunks.length > 0) {
                console.warn(
                  `[chat:${requestId}] ⚠️ Found ${oversizedChunks.length} oversized chunk(s):`,
                  oversizedChunks.map((c) => `${c.file_path}[${c.chunk_index}]: ${c.content.length} chars`)
                );
              }

              if (allChunks.length > 0) {
                const batchSize = 50;
                const embeddings: number[][] = [];

                for (let i = 0; i < allChunks.length; i += batchSize) {
                  const batch = allChunks.slice(i, i + batchSize);
                  const batchEmbeddings = await embedTexts(batch.map((c) => c.content));
                  embeddings.push(...batchEmbeddings);
                  console.log(
                    `[chat:${requestId}] Embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}`
                  );
                }

                const chunkRows = allChunks.map((c, idx) => ({
                  file_path: c.file_path,
                  chunk_index: c.chunk_index,
                  content: c.content,
                  embedding: embeddings[idx],
                }));

                await saveFileChunks(currentProjectId, buildIdForChunks, chunkRows);
                console.log(`[chat:${requestId}] ✅ Saved ${allChunks.length} chunks to vector DB`);
              }
            } catch (embedError: any) {
              console.error(`[chat:${requestId}] ⚠️ Failed to chunk/embed files for vector DB:`, embedError.message);
            }
          }
        } else {
          console.error(`[chat:${requestId}] ❌ Build returned null/undefined`);
          
          // Mark build as failed if it exists
          if (buildRecord?.id) {
            try {
              const { finalizeBuild } = await import('@/lib/db');
              await finalizeBuild(buildRecord.id, 'failed');
              console.log(`[chat:${requestId}] ❌ Marked build record as failed: ${buildRecord.id}`);
            } catch (finalizeError: any) {
              console.error(`[chat:${requestId}] ⚠️ Failed to mark build as failed:`, finalizeError.message);
            }
          }
        }
      } catch (buildError: any) {
        console.error(`[chat:${requestId}] ❌ Build error caught:`, {
          message: buildError?.message,
          name: buildError?.name,
          stack: buildError?.stack,
          cause: buildError?.cause,
        });
        
        // Log detailed error information
        if (buildError?.message) {
          console.error(`[chat:${requestId}] Build error message:`, buildError.message);
        }
        if (buildError?.stack) {
          console.error(`[chat:${requestId}] Build error stack:`, buildError.stack);
        }
        
        // Mark build record as failed if it exists
        if (buildRecord?.id) {
          try {
            const { finalizeBuild } = await import('@/lib/db');
            await finalizeBuild(buildRecord.id, 'failed');
            console.log(`[chat:${requestId}] ❌ Marked build record as failed: ${buildRecord.id}`);
          } catch (finalizeError: any) {
            console.error(`[chat:${requestId}] ⚠️ Failed to mark build as failed:`, finalizeError.message);
          }
        }
        // Continue even if build fails - return error in response
      }
    } else {
      if (!hasCodeChanges) {
        console.log(`[chat:${requestId}] ⚠️ No code changes detected, skipping build`);
      }
      if (!context.sandbox) {
        console.log(`[chat:${requestId}] ⚠️ No sandbox available, skipping build`);
      }
    }

    // Save conversation messages to database
    // Convert Gemini history back to OpenAI format for storage
    console.log(`[chat:${requestId}] Saving conversation messages to database...`);
    const messagesToSave: any[] = [];
    
    // Save user message
    messagesToSave.push({
      role: 'user' as const,
      content: message,
      metadata: {},
    });
    
    // Save model responses and function calls from Gemini history
    for (const geminiMsg of geminiHistory) {
      if (geminiMsg.role === 'model') {
        const textParts = geminiMsg.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('') || '';
        const functionCalls = geminiMsg.parts?.filter((p: any) => p.functionCall).map((p: any) => ({
          name: p.functionCall.name,
          args: p.functionCall.args,
        })) || [];
        
        if (textParts || functionCalls.length > 0) {
          messagesToSave.push({
            role: 'assistant' as const,
            content: textParts,
            metadata: {
              tool_calls: functionCalls,
            },
          });
        }
      } else if (geminiMsg.role === 'function') {
        // Save function responses
        for (const part of geminiMsg.parts || []) {
          if (part.functionResponse) {
            messagesToSave.push({
              role: 'tool' as const,
              content: JSON.stringify(part.functionResponse.response),
              tool_name: part.functionResponse.name,
              tool_call_id: part.functionCallId || null,
              metadata: {},
            });
          }
        }
      }
    }
    
    if (messagesToSave.length > 0) {
      await saveConversationMessages(currentProjectId, messagesToSave);
      console.log(`[chat:${requestId}] Saved ${messagesToSave.length} messages to database`);
    }

    console.log(`[chat:${requestId}] ====== REQUEST COMPLETE ======`);
    console.log(`[chat:${requestId}] Response:`, { 
      success: true, 
      toolCalls: iteration, 
      projectId: currentProjectId, 
      hasPreviewUrl: !!previewUrl,
      hasCodeChanges 
    });

    // If no preview URL but we have a project, try to get existing preview URL
    if (!previewUrl && currentProjectId) {
      try {
        const { supabaseAdmin } = await import('@/lib/supabase');
        const { data: project } = await supabaseAdmin
          .from('projects')
          .select('preview_url')
          .eq('id', currentProjectId)
          .single();
        if (project?.preview_url) {
          previewUrl = project.preview_url;
          console.log(`[chat:${requestId}] Using existing preview URL from project`);
        }
      } catch (err) {
        console.error(`[chat:${requestId}] Error fetching existing preview URL:`, err);
      }
    }

    // Fetch project files to return to frontend
    let projectFiles: Array<{ path: string; content: string }> = [];
    if (currentProjectId) {
      try {
        const files = await getProjectFiles(currentProjectId);
        projectFiles = files.map(f => ({
          path: f.file_path,
          content: f.file_content,
        }));
        console.log(`[chat:${requestId}] Fetched ${projectFiles.length} files for response`);
      } catch (err) {
        console.error(`[chat:${requestId}] Error fetching files for response:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      message: finalResponse,
      toolCalls: iteration,
      projectId: currentProjectId,
      previewUrl: previewUrl || null,
      hasCodeChanges,
      files: projectFiles, // Include files in response
      requestId,
    });

  } catch (error: any) {
    console.error(`[chat:${requestId}] ====== ERROR ======`);
    console.error(`[chat:${requestId}] Error:`, error);
    console.error(`[chat:${requestId}] Stack:`, error.stack);
    return NextResponse.json(
      { error: error.message || 'Chat request failed', requestId },
      { status: 500 }
    );
  }
}



