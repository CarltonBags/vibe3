# How It Works - Automatic Sandbox Creation

## User Flow

```
User Types Prompt → AI Generates Code → Sandbox Spawns → Website Runs
```

## What Happens Automatically

### 1. User Submits Prompt
Example: *"Create a tic-tac-toe game"*

### 2. AI Generates Next.js Code
- GPT-4 generates a complete page component
- Includes React hooks, state management, Tailwind CSS
- Uses FontAwesome icons when appropriate

### 3. Daytona Creates Sandbox
**Automatically happens via API:**
```typescript
const sandbox = await daytona.create({
  image: 'node:20-alpine'
});
```
- Pulls official Node.js 20 image from Docker Hub
- No manual setup required
- Fresh environment every time

### 4. Project Scaffolding
**API automatically:**
- Creates `/workspace/app/` directory structure
- Uploads `package.json` with pinned versions:
  - Next.js 14.2.18
  - React 18.3.1  
  - Tailwind CSS 3.4.17
  - FontAwesome 6.7.2
- Uploads all config files (tailwind, typescript, postcss)
- Uploads the AI-generated page code

### 5. Dependencies Installation
```bash
cd /workspace && npm install
```
- Installs exact versions from package.json
- Takes ~30-60 seconds
- Consistent across all sandboxes

### 6. Dev Server Starts
```bash
npm run dev
```
- Next.js starts on port 3000
- Hot reloading enabled
- Ready for viewing

### 7. URL Generated & Returned
```
https://{sandbox-id}-3000.daytona.app
```
- User sees the live website immediately
- Embedded in iframe on results page
- Can open in new tab

## File Structure in Sandbox

```
/workspace/
├── package.json          # Pinned dependency versions
├── next.config.js       # Next.js config
├── tailwind.config.js   # Tailwind setup
├── postcss.config.js    # PostCSS + Autoprefixer
├── tsconfig.json        # TypeScript config
├── node_modules/        # Installed dependencies
└── app/
    ├── globals.css      # Tailwind directives
    ├── layout.tsx       # Root layout
    └── page.tsx         # AI-GENERATED CODE HERE
```

## Why This Works

✅ **No manual Docker builds** - Uses official Node.js image  
✅ **Pinned versions** - package.json ensures consistency  
✅ **Fully automatic** - Zero user intervention needed  
✅ **Isolated** - Each prompt gets its own sandbox  
✅ **Scalable** - Daytona handles infrastructure  

## Example Timeline

| Time | Action |
|------|--------|
| 0s | User clicks submit |
| 0-3s | AI generates code |
| 3-5s | Sandbox provisions |
| 5-10s | Files uploaded |
| 10-70s | npm install runs |
| 70-75s | Dev server starts |
| 75s | URL returned to user |

Total: ~75 seconds from prompt to live website

## No Manual Steps Required

Everything happens automatically through the API. The user just:
1. Types a prompt
2. Clicks submit  
3. Sees their website running

That's it!
