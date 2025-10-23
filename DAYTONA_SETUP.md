# Daytona Setup Guide

## Docker Image with Pinned Versions

This project uses a custom Daytona Snapshot for **predictable and secure builds** with pinned versions:

### 📦 Pinned Versions
- **Node.js**: 20 (Alpine)
- **Next.js**: 14.2.18
- **React**: 18.3.1
- **Tailwind CSS**: 3.4.17
- **FontAwesome**: 6.7.2
- **TypeScript**: 5.7.2

---

## Setup Instructions

If you want more control over the environment, you can create a custom Snapshot:

### 1. Install Daytona CLI

```bash
# Install Daytona CLI (if not already installed)
curl -sf -L https://download.daytona.io/daytona/install.sh | sh
```

### 2. Create the Snapshot

```bash
# Run the automated setup script
./scripts/create-snapshot.sh
```

This will:
- Build a Docker image with all dependencies pre-installed
- Push it to Daytona as snapshot: `nextjs-tailwind-fontawesome-stable`
- Configure 2 vCPUs, 4GB RAM, 10GB disk

### 3. Verify Setup

The API is already configured to use this snapshot:

```typescript
const sandbox = await daytona.create({
  snapshot: 'nextjs-tailwind-fontawesome-stable'
});
```

---

## Benefits of This Approach

✅ **Predictable Builds**: Pinned versions eliminate "works on my machine" issues  
✅ **Security**: Use tested, stable versions without surprises  
✅ **Speed**: Pre-installed dependencies make sandbox creation faster  
✅ **Control**: Update versions explicitly when needed  

---

## Updating Versions

To update dependencies:

1. Edit `sandbox-templates/package.json` with new versions
2. Run `./scripts/create-snapshot.sh` to rebuild the snapshot
3. Test thoroughly before deploying

---

## Environment Variables

Make sure your `.env.local` contains:

```env
DAYTONA_KEY=your-daytona-api-key
DAYTONA_URL=https://api.daytona.io
OPENAI_KEY=your-openai-api-key
```

---

## What's in the Dockerfile?

The Dockerfile (`sandbox-templates/Dockerfile`) provides:
- Node.js 18 (Alpine)
- Git
- npm latest
- Working directory at `/workspace`
- Port 3000 exposed for Next.js dev server

---

## Recommendation

**Stick with the current approach** (`language: 'typescript'`) unless you need:
- Specific Node.js versions
- Additional system dependencies
- Custom pre-installed npm packages
- Resource guarantees (CPU/memory/disk)

The built-in environment is simpler and faster to provision!
