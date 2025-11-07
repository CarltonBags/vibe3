# How Context Works in the Tool-Based System

## Answer: How Does the Orchestrator Know What It Did Before?

**Yes, we feed it ALL past messages and responses from the session!** Here's how:

## Two Levels of Context

### 1. **In-Request Context** (Within a Single Request)

During one request, the AI maintains context through a `messages` array:

```typescript
const messages: any[] = [
  { role: 'system', content: instruction },
  { role: 'user', content: 'Create a header' },
  { role: 'assistant', content: '...', tool_calls: [{name: 'lov-write', ...}] },
  { role: 'tool', name: 'lov-write', content: '{success: true, ...}' },
  { role: 'assistant', content: 'Created Header.tsx' },
]
```

**Each AI call receives the ENTIRE messages array**, so it sees:
- What the user said
- What tools it called
- What the tools returned
- Its previous responses

This allows iterative tool calling (up to 10 rounds) within one request.

### 2. **Cross-Session Context** (Between Requests)

When a user sends a **second message later**, we load conversation history from the database:

```typescript
// Load last 50 messages from database
const history = await getConversationHistory(projectId, 50);

// Build messages array with history
const messages = [
  { role: 'system', content: instruction },
  ...history,  // ← ALL previous messages loaded here!
  { role: 'user', content: 'New message' },
]
```

## Example Flow

### Request 1: "Create a header"
```
1. Load history: [] (empty)
2. Messages: [system, user: "Create a header"]
3. AI calls lov-write → tool result → AI responds
4. Save to DB: [user, assistant, tool, assistant]
```

### Request 2: "Make it sticky" (later)
```
1. Load history: [
     {role: 'user', content: 'Create a header'},
     {role: 'assistant', content: '...', tool_calls: [...]},
     {role: 'tool', name: 'lov-write', ...},
     {role: 'assistant', content: 'Created Header.tsx'}
   ]
2. Messages: [system, ...history, user: "Make it sticky"]
3. AI sees full context - knows Header.tsx exists!
4. AI calls lov-line-replace on Header.tsx
5. Save new messages to DB
```

## Database Storage

All messages are stored in `conversation_messages` table:

```sql
CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  role TEXT, -- 'user', 'assistant', 'tool'
  content TEXT,
  tool_name TEXT, -- For tool messages
  tool_call_id TEXT, -- Links tool results to tool calls
  metadata JSONB, -- Additional data
  created_at TIMESTAMPTZ
);
```

## Key Points

1. **Within a request**: All messages are in-memory in the `messages` array
2. **Between requests**: We load the last 50 messages from the database
3. **System prompt**: Always included (not saved to DB)
4. **Tool calls**: Stored with their results, linked by `tool_call_id`
5. **Context limit**: Last 50 messages to prevent token overflow

## Benefits

- ✅ **Full conversation memory**: AI remembers everything discussed
- ✅ **File awareness**: AI knows what files exist from previous messages
- ✅ **Tool history**: AI can see what tools were used before
- ✅ **Natural continuity**: Multi-turn conversations work seamlessly

## Answer: How Does the Orchestrator Know What It Did Before?

**Yes, we feed it ALL past messages and responses from the session!** Here's how:

## Two Levels of Context

### 1. **In-Request Context** (Within a Single Request)

During one request, the AI maintains context through a `messages` array:

```typescript
const messages: any[] = [
  { role: 'system', content: instruction },
  { role: 'user', content: 'Create a header' },
  { role: 'assistant', content: '...', tool_calls: [{name: 'lov-write', ...}] },
  { role: 'tool', name: 'lov-write', content: '{success: true, ...}' },
  { role: 'assistant', content: 'Created Header.tsx' },
]
```

**Each AI call receives the ENTIRE messages array**, so it sees:
- What the user said
- What tools it called
- What the tools returned
- Its previous responses

This allows iterative tool calling (up to 10 rounds) within one request.

### 2. **Cross-Session Context** (Between Requests)

When a user sends a **second message later**, we load conversation history from the database:

```typescript
// Load last 50 messages from database
const history = await getConversationHistory(projectId, 50);

// Build messages array with history
const messages = [
  { role: 'system', content: instruction },
  ...history,  // ← ALL previous messages loaded here!
  { role: 'user', content: 'New message' },
]
```

## Example Flow

### Request 1: "Create a header"
```
1. Load history: [] (empty)
2. Messages: [system, user: "Create a header"]
3. AI calls lov-write → tool result → AI responds
4. Save to DB: [user, assistant, tool, assistant]
```

### Request 2: "Make it sticky" (later)
```
1. Load history: [
     {role: 'user', content: 'Create a header'},
     {role: 'assistant', content: '...', tool_calls: [...]},
     {role: 'tool', name: 'lov-write', ...},
     {role: 'assistant', content: 'Created Header.tsx'}
   ]
2. Messages: [system, ...history, user: "Make it sticky"]
3. AI sees full context - knows Header.tsx exists!
4. AI calls lov-line-replace on Header.tsx
5. Save new messages to DB
```

## Database Storage

All messages are stored in `conversation_messages` table:

```sql
CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  role TEXT, -- 'user', 'assistant', 'tool'
  content TEXT,
  tool_name TEXT, -- For tool messages
  tool_call_id TEXT, -- Links tool results to tool calls
  metadata JSONB, -- Additional data
  created_at TIMESTAMPTZ
);
```

## Key Points

1. **Within a request**: All messages are in-memory in the `messages` array
2. **Between requests**: We load the last 50 messages from the database
3. **System prompt**: Always included (not saved to DB)
4. **Tool calls**: Stored with their results, linked by `tool_call_id`
5. **Context limit**: Last 50 messages to prevent token overflow

## Benefits

- ✅ **Full conversation memory**: AI remembers everything discussed
- ✅ **File awareness**: AI knows what files exist from previous messages
- ✅ **Tool history**: AI can see what tools were used before
- ✅ **Natural continuity**: Multi-turn conversations work seamlessly
