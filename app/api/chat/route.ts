/**
 * Unified Chat API Route
 * Handles both generation and amendments through tool-based system
 * Similar to Lovable.dev's architecture
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { 
  checkUserLimits, 
  incrementUsage, 
  createProject, 
  updateProject,
  getUserWithTier,
  getProjectFiles,
  getConversationHistory,
  saveConversationMessages
} from '@/lib/db';
import { getToolContext, executeTool } from '@/lib/tool-orchestrator';
import { addStatus } from '@/lib/status-tracker';
import instruction from './systemPrompt';
import { convertMessagesToGemini, extractFunctionCalls, getGeminiText } from './gemini-helper';

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_KEY
});

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

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  debugLog(requestId, '====== NEW REQUEST ======');
  
  try {
    const { message, projectId, template = 'vite-react', images = [], imageNames = [] } = await req.json();
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
    console.log(`[chat:${requestId}] User authenticated: ${userId}`);

    // Get or create project
    let currentProjectId = projectId;
    if (!currentProjectId) {
      console.log(`[chat:${requestId}] Creating new project...`);
      // Create new project
      const newProject = await createProject(userId, 'New Project', template);
      currentProjectId = newProject.id;
      console.log(`[chat:${requestId}] Created project: ${currentProjectId}`);
    } else {
      console.log(`[chat:${requestId}] Using existing project: ${currentProjectId}`);
    }

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

    // Get existing files for context (if project exists)
    let existingFiles = projectId ? await getProjectFiles(projectId) : [];
    let fileContext = '';

    // For amendments: Use vector DB semantic search to find relevant files
    if (projectId && existingFiles.length > 0) {
      try {
        const { embedTexts } = await import('@/lib/embeddings');
        const { matchFileChunks, getLatestBuildId } = await import('@/lib/db');
        
        const latestBuildId = await getLatestBuildId(projectId);
        if (latestBuildId) {
          console.log(`[chat:${requestId}] Using latest build_id for vector search: ${latestBuildId}`);
        }
        
        // Embed the user's message to find semantically relevant files
        const [queryEmbedding] = await embedTexts([message]);
        const matches = await matchFileChunks(projectId, queryEmbedding, 30, latestBuildId);
        const topFiles = Array.from(new Set(matches.map(m => m.file_path))).slice(0, 12);
        
        console.log(`[chat:${requestId}] Vector search found ${matches.length} chunks, top files: ${topFiles.slice(0, 5).join(', ')}`);
        
        // Get full content of top relevant files
        const relevantFiles = existingFiles.filter(f => topFiles.includes(f.file_path));
        
        // Also include critical files (App.tsx, main.tsx, package.json, etc.)
        const criticalFiles = existingFiles.filter(f => 
          f.file_path === 'src/App.tsx' || 
          f.file_path === 'src/main.tsx' || 
          f.file_path === 'package.json' ||
          f.file_path === 'index.html'
        );
        
        // Combine relevant and critical files, deduplicate
        const allContextFiles = Array.from(
          new Map([...relevantFiles, ...criticalFiles].map(f => [f.file_path, f])).values()
        );
        
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
        fileContext = existingFiles
          .slice(0, 20)
          .map(f => `FILE: ${f.file_path}\n${f.file_content.substring(0, 500)}...`)
          .join('\n\n');
      }
    } else if (existingFiles.length > 0) {
      // For new projects or if vector search isn't available, use first 20 files
      fileContext = existingFiles
        .slice(0, 20)
        .map(f => `FILE: ${f.file_path}\n${f.file_content.substring(0, 500)}...`)
        .join('\n\n');
    }

    // Load conversation history (last 50 messages for context)
    const history = projectId ? await getConversationHistory(projectId, 50) : [];
    console.log(`[chat:${requestId}] Loaded ${history.length} messages from history`);

    // Build initial messages with conversation history
    const messages: any[] = [
      {
        role: 'system',
        content: instruction,
      },
    ];

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
    let hasCodeChanges = false;
    const maxIterations = 10; // Prevent infinite loops
    let iteration = 0;
    let finalResponse = '';
    let geminiHistory: any[] = []; // Gemini conversation history

    // Convert initial messages to Gemini format
    const geminiMessages = convertMessagesToGemini(messages);
    geminiHistory = geminiMessages;

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
          systemInstruction: instruction,
          tools: GEMINI_TOOLS as any,
          temperature: 0.7,
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
    
    // Check for RECITATION or other safety filter blocks
    let finishReason = geminiResponse.candidates?.[0]?.finishReason;
    if (finishReason === 'RECITATION') {
      console.error(`[chat:${requestId}] ❌ Gemini blocked response with RECITATION finish reason (safety filter)`);
      
      // If we already have code changes, continue with what we have instead of failing
      if (hasCodeChanges) {
        console.log(`[chat:${requestId}] ⚠️ RECITATION detected but code changes already exist, continuing with existing changes...`);
        // Extract any function calls that might have been created before RECITATION
        const functionCallsBeforeRecitation = extractFunctionCalls(geminiResponse);
        if (functionCallsBeforeRecitation.length > 0) {
          console.log(`[chat:${requestId}] Found ${functionCallsBeforeRecitation.length} function calls before RECITATION, processing them...`);
          // Process these function calls normally
        } else {
          // No function calls, but we have code changes, so continue
          console.log(`[chat:${requestId}] No function calls in RECITATION response, but code changes exist - continuing...`);
        }
      } else {
        // No code changes yet, try retry
        console.log(`[chat:${requestId}] Attempting retry with simplified prompt...`);
        
        // Retry with a simplified system instruction
        try {
          const simplifiedInstruction = `You are an AI assistant that helps build web applications using React, Vite, TypeScript, and Tailwind CSS.

When a user requests a new project, immediately start creating files using the lov-write tool. Implement all requested features completely.

Key rules:
- Use React components with zero props for custom components
- Use shadcn/ui components from @/components/ui/
- Create colorful, vibrant designs with gradients
- Use react-router-dom for routing
- All components must compile without errors

Start creating the application files now.`;
          
          const retryResponse = await gemini.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: geminiHistory,
            config: {
              systemInstruction: simplifiedInstruction,
              tools: GEMINI_TOOLS as any,
              temperature: 0.8, // Slightly higher temperature
            },
          });
          
          const retryFinishReason = retryResponse.candidates?.[0]?.finishReason;
          if (retryFinishReason === 'RECITATION' || retryFinishReason === 'SAFETY') {
            console.error(`[chat:${requestId}] ❌ Retry also blocked with finish reason: ${retryFinishReason}`);
            return NextResponse.json({
              success: false,
              error: 'Content was blocked by safety filters. Please try rephrasing your request differently or be more specific about what you want to build.',
              finishReason: 'RECITATION',
              suggestion: 'Try using different wording, or break your request into smaller parts.',
            }, { status: 400 });
          }
          
          // Use the retry response
          console.log(`[chat:${requestId}] ✅ Retry successful, using retry response`);
          geminiResponse = retryResponse;
          finishReason = retryFinishReason; // Update finish reason
        } catch (retryError: any) {
          console.error(`[chat:${requestId}] ❌ Retry failed:`, retryError);
          return NextResponse.json({
            success: false,
            error: 'Content was blocked by safety filters. Please try rephrasing your request or be more specific about what you want to build.',
            finishReason: 'RECITATION',
          }, { status: 400 });
        }
      }
    }
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`[chat:${requestId}] ⚠️ Unexpected finish reason: ${finishReason}`);
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
            systemInstruction: instruction,
            tools: GEMINI_TOOLS as any,
            temperature: 0.7,
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

    // Save project files to database after tool execution (so frontend can display them)
    if (hasCodeChanges && context.sandbox && currentProjectId) {
      try {
        console.log(`[chat:${requestId}] Saving project files to database...`);
        const { saveProjectFiles, saveProjectFilesToBuild } = await import('@/lib/db');
        
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
          if (buildRecord?.id) {
            await saveProjectFilesToBuild(currentProjectId, buildRecord.id, sourceFiles);
            console.log(`[chat:${requestId}] ✅ Saved ${sourceFiles.length} files to database with build_id: ${buildRecord.id}`);
          } else {
            await saveProjectFiles(currentProjectId, sourceFiles, null);
            console.warn(`[chat:${requestId}] ⚠️ Saved ${sourceFiles.length} files without build_id`);
          }
          
          // Chunk and embed files for vector DB semantic search
          try {
            const { embedTexts, codeAwareChunks } = await import('@/lib/embeddings');
            const { saveFileChunks } = await import('@/lib/db');
            
            const buildIdForChunks = buildRecord?.id || null;
            console.log(`[chat:${requestId}] Chunking and embedding ${sourceFiles.length} files for vector DB (build_id: ${buildIdForChunks})...`);
            
            const allChunks: Array<{ file_path: string; chunk_index: number; content: string }> = [];
            for (const f of sourceFiles) {
              const parts = codeAwareChunks(f.path, f.content);
              parts.forEach((p, i) => allChunks.push({ file_path: f.path, chunk_index: i, content: p }));
            }
            
            // Validate chunk sizes
            const oversizedChunks = allChunks.filter(c => c.content.length > 2000);
            if (oversizedChunks.length > 0) {
              console.warn(`[chat:${requestId}] ⚠️ Found ${oversizedChunks.length} oversized chunk(s):`, oversizedChunks.map(c => `${c.file_path}[${c.chunk_index}]: ${c.content.length} chars`));
            }
            
            if (allChunks.length > 0) {
              // Embed chunks in batches to avoid rate limits
              const batchSize = 50;
              const embeddings: number[][] = [];
              
              for (let i = 0; i < allChunks.length; i += batchSize) {
                const batch = allChunks.slice(i, i + batchSize);
                const batchEmbeddings = await embedTexts(batch.map(c => c.content));
                embeddings.push(...batchEmbeddings);
                console.log(`[chat:${requestId}] Embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}`);
              }
              
              const chunkRows = allChunks.map((c, idx) => ({ 
                file_path: c.file_path, 
                chunk_index: c.chunk_index, 
                content: c.content, 
                embedding: embeddings[idx] 
              }));
              
              await saveFileChunks(currentProjectId, buildIdForChunks, chunkRows);
              console.log(`[chat:${requestId}] ✅ Saved ${allChunks.length} chunks to vector DB`);
            }
          } catch (embedError: any) {
            console.error(`[chat:${requestId}] ⚠️ Failed to chunk/embed files for vector DB:`, embedError.message);
            // Don't fail the request if embedding fails
          }
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
              const { finalizeBuild } = await import('@/lib/db');
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
    });

  } catch (error: any) {
    console.error(`[chat:${requestId}] ====== ERROR ======`);
    console.error(`[chat:${requestId}] Error:`, error);
    console.error(`[chat:${requestId}] Stack:`, error.stack);
    return NextResponse.json(
      { error: error.message || 'Chat request failed' },
      { status: 500 }
    );
  }
}

