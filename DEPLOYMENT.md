# Deployment Guide

## Quick Start

### 1. Install Daytona CLI
```bash
curl -sf -L https://download.daytona.io/daytona/install.sh | sh
```

### 2. Create the Docker Snapshot
```bash
./scripts/create-snapshot.sh
```

### 3. Set Environment Variables
Create `.env.local`:
```env
DAYTONA_KEY=your-daytona-api-key
DAYTONA_URL=https://api.daytona.io
OPENAI_KEY=your-openai-api-key
```

### 4. Run the App
```bash
npm run dev
```

---

## What Happens When a User Submits a Prompt?

1. **AI Generation**: GPT-4 generates a complete Next.js page component
2. **Sandbox Creation**: Daytona creates a sandbox from `nextjs-tailwind-fontawesome-stable` snapshot
3. **Project Setup**: 
   - Creates Next.js project structure
   - Copies config files (tailwind, typescript, etc.)
   - Uploads generated page component
4. **Installation**: Runs `npm install` in the sandbox
5. **Server Start**: Starts Next.js dev server on port 3000
6. **URL Generation**: Returns live URL for the running app
7. **Display**: Shows the working app in an iframe

---

## Snapshot Specifications

**Name**: `nextjs-tailwind-fontawesome-stable`

**Base Image**: `node:20-alpine`

**Pre-installed Dependencies**:
- Next.js 14.2.18
- React 18.3.1
- Tailwind CSS 3.4.17
- FontAwesome 6.7.2
- TypeScript 5.7.2
- All build tools (autoprefixer, postcss, etc.)

**Resources**:
- CPU: 2 vCPUs
- Memory: 4 GB
- Disk: 10 GB

---

## Maintenance

### Update Dependencies

1. Edit `sandbox-templates/package.json`
2. Run `./scripts/create-snapshot.sh`
3. Snapshot name stays the same, Daytona will version it internally

### Monitor Sandboxes

Check active sandboxes in Daytona dashboard:
- Monitor resource usage
- View logs
- Delete old/unused sandboxes

---

## Troubleshooting

### Snapshot Not Found
```bash
# Recreate the snapshot
./scripts/create-snapshot.sh
```

### Dependencies Installation Fails
- Check snapshot has enough disk space (10GB allocated)
- Verify package.json versions are compatible
- Check Daytona logs in dashboard

### Next.js Server Won't Start
- Wait longer (increase timeout in route.ts)
- Check port 3000 is exposed
- Verify npm install completed successfully

---

## Cost Optimization

- Sandboxes are deleted after use
- Snapshot is reused (no rebuild needed)
- Pre-installed dependencies = faster creation
- Only pay for active sandbox time
