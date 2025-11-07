# Tool-Based Architecture Migration Plan

## Overview

We're migrating from a **batch generation system** to a **tool-based chat system** similar to Lovable.dev. This enables real-time, iterative code editing with immediate preview updates.

## Key Architectural Changes

### 1. **Unified Chat Route** ✅ (Started)

**Before:**
- `/api/generate` - Full project generation
- `/api/amend` - Project amendments

**After:**
- `/api/chat` - Single route handling both generation and amendments through tool calls

**Benefits:**
- Consistent interface for all operations
- Real-time tool execution
- Better error handling and user feedback
- Supports iterative development

### 2. **Tool Orchestrator** ✅ (Created)

**Location:** `lib/tool-orchestrator.ts`

**Responsibilities:**
- Manage sandbox lifecycle (create/get)
- Execute tools (view, write, line-replace, delete, rename, search)
- Maintain tool context (projectId, sandboxId, userId, template)
- Handle file operations on sandbox or database

**Key Functions:**
- `getOrCreateSandbox()` - Initialize sandbox for project
- `getToolContext()` - Get context for tool execution
- `executeTool()` - Execute a tool by name
- Individual tool functions: `toolView()`, `toolWrite()`, `toolLineReplace()`, etc.

### 3. **Core Tools** ✅ (Partially Implemented)

**Implemented:**
- `lov-view` - Read files (with optional line ranges)
- `lov-write` - Write/create files
- `lov-line-replace` - Line-based search/replace (PREFERRED for edits)
- `lov-delete` - Delete files
- `lov-rename` - Rename files
- `lov-search-files` - Regex search (placeholder)

**Still Needed:**
- `lov-read-console-logs` - Debug console logs
- `lov-read-network-requests` - Debug network requests
- `lov-add-dependency` - Add npm packages
- `lov-remove-dependency` - Remove npm packages
- `lov-download-to-repo` - Download files from URLs
- `lov-fetch-website` - Fetch website content
- `lov-copy` - Copy files/directories

### 4. **System Prompt Updates** ⏳ (Pending)

**Current:** Very prescriptive, strict rules, batch-focused

**Target:** More generic, discussion-first, tool-focused (like Lovable.dev)

**Key Changes Needed:**
- Default to discussion mode (ask before implementing)
- Emphasize tool efficiency (batch operations, avoid redundant reads)
- Focus on design system (semantic tokens, no direct colors)
- Minimal changes (prefer line-replace over full rewrites)
- Use debugging tools FIRST before modifying code

### 5. **Frontend Updates** ⏳ (Pending)

**Current:**
- Single prompt → full generation → wait → preview
- Separate amendment flow

**Target:**
- Chat interface with streaming responses
- Real-time preview updates after each tool call
- Show tool execution in UI
- Support iterative refinement

## Implementation Status

### ✅ Completed
1. Created `lib/tool-orchestrator.ts` with core tool functions
2. Created `/api/chat` route with basic tool calling
3. Defined tool schemas (similar to Lovable.dev)

### ⏳ In Progress
1. Tool orchestrator needs more robust error handling
2. Need to implement build/upload after tool calls
3. Need to add more tools (console logs, network requests, etc.)

### 📋 TODO
1. **Update System Prompt** - Make it more generic and discussion-first
2. **Implement Remaining Tools** - Console logs, network requests, dependencies
3. **Add Build Trigger** - After tool calls complete, trigger build and update preview
4. **Update Frontend** - Chat interface with streaming and real-time updates
5. **Add Tool Result Streaming** - Stream tool execution results to frontend
6. **Implement Context Management** - Track "useful-context" to avoid redundant file reads
7. **Add Preview Updates** - Update preview after each tool call (or batch of calls)

## Architecture Comparison

### Lovable.dev (Target)
```
User Message → Chat API → AI (with tools) → Tool Execution → Preview Update → Response
                ↓
         Tool Orchestrator
                ↓
         Sandbox/Database
```

### Our Current System
```
User Prompt → Generate API → Planning → Batch Generation → Compile → Fix → Build → Upload → Preview
```

### Our New System (In Progress)
```
User Message → Chat API → AI (with tools) → Tool Execution → Build → Upload → Preview → Response
                ↓
         Tool Orchestrator
                ↓
         Sandbox/Database
```

## Key Differences from Lovable.dev

1. **Sandbox Management**: We use Daytona sandboxes, Lovable.dev may use different infrastructure
2. **Build System**: We need to trigger builds after tool calls, they may have hot-reload
3. **Storage**: We store builds in Supabase Storage, they may use different storage
4. **Preview**: We serve previews via proxy, they may have direct sandbox access

## Next Steps

1. **Complete Tool Implementation**
   - Add console log reading
   - Add network request reading
   - Add dependency management tools

2. **Enhance Chat Route**
   - Support streaming responses
   - Handle multiple tool calls in sequence
   - Trigger builds after tool execution
   - Update preview URLs

3. **Update System Prompt**
   - Make it more generic
   - Add discussion-first approach
   - Emphasize tool efficiency
   - Focus on design system

4. **Frontend Migration**
   - Create chat interface
   - Add streaming support
   - Show tool execution
   - Real-time preview updates

5. **Testing & Refinement**
   - Test tool execution
   - Test build triggers
   - Test preview updates
   - Refine based on usage

## Questions to Answer

1. **Do we need a separate orchestrator?**
   - **Answer:** The `tool-orchestrator.ts` serves as the orchestrator. It could be a separate service, but for now it's fine as a library module.

2. **Do generate/route and amend/route need to be one route?**
   - **Answer:** Yes, they should be unified into `/api/chat` for consistency. The AI can determine if it's a new project or amendment based on context.

3. **How do we handle builds?**
   - **Answer:** After tool calls complete, we should:
     - Run `npm run build` in sandbox
     - Upload build artifacts to Supabase Storage
     - Update preview URL
     - Return updated preview to frontend

4. **How do we handle streaming?**
   - **Answer:** Use Server-Sent Events (SSE) or WebSockets to stream:
     - Tool execution progress
     - AI responses
     - Build progress
     - Preview updates


## Overview

We're migrating from a **batch generation system** to a **tool-based chat system** similar to Lovable.dev. This enables real-time, iterative code editing with immediate preview updates.

## Key Architectural Changes

### 1. **Unified Chat Route** ✅ (Started)

**Before:**
- `/api/generate` - Full project generation
- `/api/amend` - Project amendments

**After:**
- `/api/chat` - Single route handling both generation and amendments through tool calls

**Benefits:**
- Consistent interface for all operations
- Real-time tool execution
- Better error handling and user feedback
- Supports iterative development

### 2. **Tool Orchestrator** ✅ (Created)

**Location:** `lib/tool-orchestrator.ts`

**Responsibilities:**
- Manage sandbox lifecycle (create/get)
- Execute tools (view, write, line-replace, delete, rename, search)
- Maintain tool context (projectId, sandboxId, userId, template)
- Handle file operations on sandbox or database

**Key Functions:**
- `getOrCreateSandbox()` - Initialize sandbox for project
- `getToolContext()` - Get context for tool execution
- `executeTool()` - Execute a tool by name
- Individual tool functions: `toolView()`, `toolWrite()`, `toolLineReplace()`, etc.

### 3. **Core Tools** ✅ (Partially Implemented)

**Implemented:**
- `lov-view` - Read files (with optional line ranges)
- `lov-write` - Write/create files
- `lov-line-replace` - Line-based search/replace (PREFERRED for edits)
- `lov-delete` - Delete files
- `lov-rename` - Rename files
- `lov-search-files` - Regex search (placeholder)

**Still Needed:**
- `lov-read-console-logs` - Debug console logs
- `lov-read-network-requests` - Debug network requests
- `lov-add-dependency` - Add npm packages
- `lov-remove-dependency` - Remove npm packages
- `lov-download-to-repo` - Download files from URLs
- `lov-fetch-website` - Fetch website content
- `lov-copy` - Copy files/directories

### 4. **System Prompt Updates** ⏳ (Pending)

**Current:** Very prescriptive, strict rules, batch-focused

**Target:** More generic, discussion-first, tool-focused (like Lovable.dev)

**Key Changes Needed:**
- Default to discussion mode (ask before implementing)
- Emphasize tool efficiency (batch operations, avoid redundant reads)
- Focus on design system (semantic tokens, no direct colors)
- Minimal changes (prefer line-replace over full rewrites)
- Use debugging tools FIRST before modifying code

### 5. **Frontend Updates** ⏳ (Pending)

**Current:**
- Single prompt → full generation → wait → preview
- Separate amendment flow

**Target:**
- Chat interface with streaming responses
- Real-time preview updates after each tool call
- Show tool execution in UI
- Support iterative refinement

## Implementation Status

### ✅ Completed
1. Created `lib/tool-orchestrator.ts` with core tool functions
2. Created `/api/chat` route with basic tool calling
3. Defined tool schemas (similar to Lovable.dev)

### ⏳ In Progress
1. Tool orchestrator needs more robust error handling
2. Need to implement build/upload after tool calls
3. Need to add more tools (console logs, network requests, etc.)

### 📋 TODO
1. **Update System Prompt** - Make it more generic and discussion-first
2. **Implement Remaining Tools** - Console logs, network requests, dependencies
3. **Add Build Trigger** - After tool calls complete, trigger build and update preview
4. **Update Frontend** - Chat interface with streaming and real-time updates
5. **Add Tool Result Streaming** - Stream tool execution results to frontend
6. **Implement Context Management** - Track "useful-context" to avoid redundant file reads
7. **Add Preview Updates** - Update preview after each tool call (or batch of calls)

## Architecture Comparison

### Lovable.dev (Target)
```
User Message → Chat API → AI (with tools) → Tool Execution → Preview Update → Response
                ↓
         Tool Orchestrator
                ↓
         Sandbox/Database
```

### Our Current System
```
User Prompt → Generate API → Planning → Batch Generation → Compile → Fix → Build → Upload → Preview
```

### Our New System (In Progress)
```
User Message → Chat API → AI (with tools) → Tool Execution → Build → Upload → Preview → Response
                ↓
         Tool Orchestrator
                ↓
         Sandbox/Database
```

## Key Differences from Lovable.dev

1. **Sandbox Management**: We use Daytona sandboxes, Lovable.dev may use different infrastructure
2. **Build System**: We need to trigger builds after tool calls, they may have hot-reload
3. **Storage**: We store builds in Supabase Storage, they may use different storage
4. **Preview**: We serve previews via proxy, they may have direct sandbox access

## Next Steps

1. **Complete Tool Implementation**
   - Add console log reading
   - Add network request reading
   - Add dependency management tools

2. **Enhance Chat Route**
   - Support streaming responses
   - Handle multiple tool calls in sequence
   - Trigger builds after tool execution
   - Update preview URLs

3. **Update System Prompt**
   - Make it more generic
   - Add discussion-first approach
   - Emphasize tool efficiency
   - Focus on design system

4. **Frontend Migration**
   - Create chat interface
   - Add streaming support
   - Show tool execution
   - Real-time preview updates

5. **Testing & Refinement**
   - Test tool execution
   - Test build triggers
   - Test preview updates
   - Refine based on usage

## Questions to Answer

1. **Do we need a separate orchestrator?**
   - **Answer:** The `tool-orchestrator.ts` serves as the orchestrator. It could be a separate service, but for now it's fine as a library module.

2. **Do generate/route and amend/route need to be one route?**
   - **Answer:** Yes, they should be unified into `/api/chat` for consistency. The AI can determine if it's a new project or amendment based on context.

3. **How do we handle builds?**
   - **Answer:** After tool calls complete, we should:
     - Run `npm run build` in sandbox
     - Upload build artifacts to Supabase Storage
     - Update preview URL
     - Return updated preview to frontend

4. **How do we handle streaming?**
   - **Answer:** Use Server-Sent Events (SSE) or WebSockets to stream:
     - Tool execution progress
     - AI responses
     - Build progress
     - Preview updates

