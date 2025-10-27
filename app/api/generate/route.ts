import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import instruction from './systemPrompt';
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
    const maxTokens = Math.min(userWithTier.tier.max_tokens_per_generation, 100000);

    
    // Step 1: Generate Next.js project structure using OpenAI
    // Using gpt-4o-mini for cost efficiency (~98% cheaper than gpt-4)
    // Still produces excellent code generation results
    const completions = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an ELITE Next.js developer and UI/UX designer. Your task is to generate a FUNCTIONAL, COMPLETE, PRODUCTION-READY, VISUALLY STUNNING web application.

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
📋 CODE REQUIREMENTS:

1. **Multiple Files**: Generate 3-8 files depending on complexity:
   - app/page.tsx (main page - MUST have 'use client' at top)
   - app/components/*.tsx (reusable components - 2-5 files)
   - app/types/index.ts (TypeScript types/interfaces if needed)
   - app/utils/*.ts (utility functions if needed)

   **CRITICAL**: If you import ANY component in app/page.tsx, you MUST create that component file in app/components/

2. **Component Architecture**: 
   - Extract reusable components into separate files
   - Each component in its own file in app/components/
   - Proper TypeScript interfaces for all props
   - Clean imports and exports

3. **CRITICAL - Single Page Application**:
   - NEVER create additional route folders (like app/about/, app/contact/)
   - NEVER create additional layout.tsx files
   - If multiple "pages" are needed, use useState to toggle between views in app/page.tsx
   - Use client-side state management for navigation, NOT Next.js routing
   - Everything must be in ONE page with conditional rendering

4. **CRITICAL - Avoid Hydration Errors & SSR Issues**:
   - Do NOT use Math.random(), Date.now(), or dynamic IDs in initial render
   - Do NOT conditionally render based on client-only APIs (window, localStorage) without useEffect
   - Keep server and client render identical on first load
   - Load dynamic/user-specific content in useEffect after mount
   - Use stable keys for lists (not random or index-based if items can change)
   - **ALWAYS add 'use client' directive** at the top of EVERY component file
   - Avoid complex server-side logic that could break Next.js bootstrapping
   - Keep components simple and client-side rendered

5. **Must Use**: TypeScript with proper types and interfaces
6. **Styling**: Use ONLY Tailwind CSS classes - no inline styles, no external CSS
7. **NO Syntax Errors**: Code must be valid TypeScript that compiles without errors

8. **Icons & Visual Elements**: Use FontAwesome extensively:
   - Import from '@fortawesome/react-fontawesome'
   - Import icons from '@fortawesome/free-solid-svg-icons'
   - Use icons for EVERY feature, benefit, step, action button
   - Example: import { faRocket, faShield, faBolt, faHeart, faStar, faCheck } from '@fortawesome/free-solid-svg-icons'
   - Add decorative icons to enhance visual appeal

9. **Component Architecture**: Create MULTIPLE internal components:
   - Define 4-8 smaller components within the page file
   - Examples: FeatureCard, TestimonialCard, StatsCounter, PricingCard, FAQItem, etc.
   - Each component should accept props and be reusable
   - This creates cleaner, more maintainable code

10. **Functionality**: Include ALL necessary features:
   - Sophisticated state management with useState, useEffect, useCallback
   - Event handlers for ALL user interactions
   - Form validation with visual feedback
   - Loading states and animations
   - Error handling with user-friendly messages
   - Success states and confirmations
   - Local storage for persistence (if applicable)
   - Smooth scrolling and navigation

11. **Design System**: Create a STUNNING, DETAILED UI:
   
   **HERO SECTION** (MUST INCLUDE):
   - Large, bold headline (text-5xl or text-6xl)
   - Compelling subheadline (text-xl or text-2xl)
   - 2-3 CTA buttons with different styles (primary, secondary, outline)
   - Hero image, illustration, or animated background
   - Trust indicators (ratings, user count, badges)
   
   **FEATURES SECTION** (MUST INCLUDE):
   - 6-9 feature cards in a responsive grid
   - Each card: Icon + Title + Description
   - Hover effects (scale, shadow, border color change)
   - Background gradients or subtle patterns
   
   **SOCIAL PROOF** (INCLUDE 2-3 OF):
   - Statistics/Numbers (users, downloads, ratings)
   - Customer testimonials with avatars
   - Brand logos or client showcase
   - Trust badges or certifications
   
   **INTERACTIVE DEMO** (IF APPLICABLE):
   - The main functionality (game, calculator, tool, etc.)
   - Clear instructions
   - Visual feedback on every action
   - Beautiful result displays
   
   **ADDITIONAL SECTIONS** (INCLUDE 2-4 OF):
   - How It Works (3-5 steps with numbers/icons)
   - Pricing tiers comparison table
   - FAQ section with expandable items
   - Newsletter signup with validation
   - Team members showcase
   - Latest blog posts or updates
   - Call-to-action banner
   
   **FOOTER** (MUST INCLUDE):
   - Multi-column layout
   - Links (Product, Company, Resources, Legal)
   - Social media icons
   - Copyright notice

12. **Visual Design Details**:
   - Use gradient backgrounds (bg-gradient-to-br, bg-gradient-to-r)
   - Add shadows everywhere (shadow-lg, shadow-xl, shadow-2xl)
   - Round corners consistently (rounded-lg, rounded-xl, rounded-2xl)
   - Use backdrop-blur for glassmorphism effects
   - Add borders with opacity (border border-gray-200)
   - Implement hover states on EVERYTHING interactive
   - Use animations (transition, transform, hover:scale-105)
   - Add subtle animations (animate-pulse, animate-bounce on CTAs)
   
13. **Color Schemes**: Choose ONE cohesive palette:
    - Modern Tech: Indigo/Purple/Blue (bg-indigo-600, text-purple-400)
    - Finance/Trust: Blue/Green (bg-blue-600, text-green-500)
    - Creative: Purple/Pink/Orange (bg-purple-600, text-pink-400)
    - Professional: Gray/Blue (bg-slate-800, text-blue-500)
    - Energetic: Orange/Red/Yellow (bg-orange-500, text-red-400)

14. **Typography Hierarchy**:
    - H1: text-5xl or text-6xl font-bold
    - H2: text-4xl font-bold
    - H3: text-2xl or text-3xl font-semibold
    - Body: text-base or text-lg
    - Small: text-sm
    - Use font-bold, font-semibold generously
    - Add text-gray-600 for secondary text

15. **Spacing & Layout**:
    - Full page sections: py-16 or py-20
    - Section containers: max-w-7xl mx-auto px-4
    - Space between sections: space-y-16 or space-y-20
    - Card padding: p-6 or p-8
    - Generous margins everywhere

16. **Responsive Design**:
    - Use grid-cols-1 md:grid-cols-2 lg:grid-cols-3
    - Stack vertically on mobile, rows on desktop
    - Hide/show elements: hidden md:block
    - Adjust text sizes: text-3xl md:text-5xl

17. **Micro-interactions**:
    - Add hover:shadow-2xl to cards
    - Add hover:scale-105 transform transition
    - Add focus:ring-2 focus:ring-offset-2 to inputs
    - Add group hover effects
    - Add smooth scrolling behavior

📝 MULTI-PAGE NAVIGATION - **CRITICAL REQUIREMENT**:

When user requests navigation between pages (e.g., "button navigating to another page", "landing page with button to product page"):

**YOU MUST USE STATE-BASED NAVIGATION - NO EXCEPTIONS**

\`\`\`typescript
'use client'
import { useState } from 'react'

export default function Page() {
  // Define all possible views/pages
  const [currentView, setCurrentView] = useState<'landing' | 'product' | 'about'>('landing')
  
  return (
    <div className="min-h-screen">
      {/* Conditional rendering based on state */}
      {currentView === 'landing' && (
        <div>
          <h1>Welcome</h1>
          <button onClick={() => setCurrentView('product')}>
            Go to Product Page
          </button>
        </div>
      )}
      
      {currentView === 'product' && (
        <div>
          <h1>Product Page</h1>
          <button onClick={() => setCurrentView('landing')}>
            Back to Home
          </button>
        </div>
      )}
    </div>
  )
}
\`\`\`

**NEVER** create app/product/page.tsx or app/about/page.tsx - use state instead!

📝 EXAMPLE STRUCTURE (You MUST expand significantly on this!):

'use client'

import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRocket, faShield, faBolt, faStar, faCheck, faChartLine } from '@fortawesome/free-solid-svg-icons'

// Define multiple sub-components
interface FeatureCardProps {
  icon: any;
  title: string;
  description: string;
}

const FeatureCard = ({ icon, title, description }: FeatureCardProps) => (
  <div className="group p-8 bg-white rounded-2xl border border-gray-200 hover:border-indigo-500 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1">
    <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
      <FontAwesomeIcon icon={icon} className="text-2xl text-white" />
    </div>
    <h3 className="text-xl font-bold mb-3 text-gray-900">{title}</h3>
    <p className="text-gray-600 leading-relaxed">{description}</p>
  </div>
);

interface StatCardProps {
  number: string;
  label: string;
}

const StatCard = ({ number, label }: StatCardProps) => (
  <div className="text-center p-6">
    <div className="text-5xl font-bold text-indigo-600 mb-2">{number}</div>
    <div className="text-gray-600 font-medium">{label}</div>
  </div>
);

export default function Page() {
  const [state, setState] = useState(initialValue)
  
  const features = [
    { icon: faRocket, title: 'Feature One', description: 'Detailed description of this amazing feature' },
    { icon: faShield, title: 'Feature Two', description: 'Another compelling feature description' },
    { icon: faBolt, title: 'Feature Three', description: 'More value proposition here' },
    // Add 3-6 more features
  ];
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-indigo-50 to-purple-50">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-lg z-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="text-2xl font-bold text-indigo-600">Logo</div>
          <div className="hidden md:flex space-x-8">
            <a href="#features" className="text-gray-600 hover:text-indigo-600 transition">Features</a>
            <a href="#pricing" className="text-gray-600 hover:text-indigo-600 transition">Pricing</a>
            <a href="#about" className="text-gray-600 hover:text-indigo-600 transition">About</a>
          </div>
          <button className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition">
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full text-sm font-semibold mb-6">
              <FontAwesomeIcon icon={faStar} className="mr-2" />
              Trusted by 10,000+ users
            </div>
            <h1 className="text-6xl md:text-7xl font-bold text-gray-900 mb-6 leading-tight">
              Your Amazing<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">
                Product Title
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed">
              A compelling description that clearly explains the value proposition and benefits to users
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-8 py-4 rounded-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 text-lg font-semibold">
                Get Started Free
              </button>
              <button className="bg-white text-gray-700 px-8 py-4 rounded-xl border-2 border-gray-300 hover:border-indigo-500 hover:shadow-xl transition-all duration-300 text-lg font-semibold">
                Watch Demo
              </button>
            </div>
          </div>
        </div>
      </section>
      
      {/* Stats Section */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <StatCard number="10K+" label="Active Users" />
            <StatCard number="99.9%" label="Uptime" />
            <StatCard number="24/7" label="Support" />
            <StatCard number="4.9★" label="Rating" />
          </div>
        </div>
      </section>
      
      {/* Features Section */}
      <section id="features" className="py-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-5xl font-bold text-gray-900 mb-4">Powerful Features</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Everything you need to succeed, all in one place
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <FeatureCard key={index} {...feature} />
            ))}
          </div>
        </div>
      </section>
      
      {/* Main Interactive Section - ADD YOUR CORE FUNCTIONALITY HERE */}
      <section className="py-20 px-4 bg-gradient-to-br from-indigo-600 to-purple-700">
        <div className="max-w-5xl mx-auto">
          {/* Your main app functionality, game, calculator, etc. */}
        </div>
      </section>

      {/* Testimonials/Social Proof */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">What People Say</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {/* Add 3-6 testimonial cards */}
          </div>
        </div>
      </section>
      
      {/* CTA Section */}
      <section className="py-20 px-4 bg-gradient-to-r from-indigo-600 to-purple-600">
        <div className="max-w-4xl mx-auto text-center text-white">
          <h2 className="text-5xl font-bold mb-6">Ready to Get Started?</h2>
          <p className="text-xl mb-8 opacity-90">Join thousands of satisfied users today</p>
          <button className="bg-white text-indigo-600 px-10 py-4 rounded-xl text-lg font-bold hover:shadow-2xl hover:scale-105 transition-all">
            Start Free Trial
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12 px-4">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-white font-bold text-lg mb-4">Product</h3>
            <ul className="space-y-2">
              <li><a href="#" className="hover:text-white transition">Features</a></li>
              <li><a href="#" className="hover:text-white transition">Pricing</a></li>
            </ul>
          </div>
          {/* Add 3 more footer columns */}
        </div>
        <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-gray-800 text-center">
          <p>&copy; 2024 Your Company. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

⚠️ ULTRA CRITICAL: 
- Create AT LEAST 6-8 distinct sections
- Define 4-8 reusable components with TypeScript interfaces
- Add rich content, not placeholders
- Make it look like a $50,000 professional website
- Users expect to be AMAZED!
- **MANDATORY**: Every component you import MUST exist as a file in app/components/
- **NO EXCEPTIONS**: If you write import FeatureCard from './components/FeatureCard', you MUST create app/components/FeatureCard.tsx`
        },
        {
          role: "user",
          content: `Generate a complete Next.js application with multiple files for: ${prompt}

Remember: Return ONLY a JSON object with the files array. No explanations, no markdown.`
        }
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    });


    const completion = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{text: prompt}],
      config:{systemInstruction: instruction.toString()}
    });

    let responseText = completion.text || '';
    
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
      console.log('⚠️ CRITICAL: Parse error detected. Response text:', responseText.substring(0, 500));
      
      // Try multiple extraction strategies
      console.log('🔧 Attempting emergency JSON extraction...');
      
      // Strategy 1: Try to find JSON object in the response
      const jsonObjMatch = responseText.match(/\{[\s\S]*"files"[\s\S]*\}/);
      if (jsonObjMatch) {
        try {
          filesData = JSON.parse(jsonObjMatch[0]);
          console.log('✅ Successfully extracted JSON using regex strategy');
        } catch (e) {
          console.error('❌ Regex extraction also failed:', e);
        }
      }
      
      // Strategy 2: If still failed, try to find individual file entries
      if (!filesData) {
        console.log('🔧 Attempting file-by-file extraction...');
        const filesPattern = /"files"\s*:\s*\[([\s\S]*)\]/;
        const filesMatch = responseText.match(filesPattern);
        
        if (filesMatch) {
          const filesContent = '[' + filesMatch[1] + ']';
          try {
            const extractedFiles = JSON.parse(filesContent);
            filesData = { files: extractedFiles };
            console.log('✅ Successfully extracted files array');
          } catch (e) {
            console.error('❌ Files extraction failed:', e);
          }
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
      
      // Clear any existing cache and build for production
      console.log('Building Next.js for production...');
      await sandbox.process.executeCommand('cd /workspace && rm -rf .next node_modules/.cache || true');
      
      // Build the site (capture output and errors)
      console.log('Running npm run build...');
      const buildResult = await sandbox.process.executeCommand('cd /workspace && npm run build 2>&1 || true');
      console.log('Build output:', buildResult.result?.substring(0, 500));
      
      // Check if build succeeded
      if (buildResult.result?.includes('Error:') || buildResult.result?.includes('Failed to compile')) {
        console.error('Build failed, checking logs...');
        const errorLogs = await sandbox.process.executeCommand('cd /workspace && cat /tmp/next.log 2>&1 || echo "No logs"');
        console.log('Build errors:', errorLogs.result);
      }
      
      // Start production server
      console.log('Starting production server...');
      await sandbox.process.executeCommand('cd /workspace && nohup npm run start > /tmp/next.log 2>&1 &');
      
      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 15000));
      
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
        message: `Next.js project created with ${allFiles.length} files (GitHub-ready)`,
        tokensUsed
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