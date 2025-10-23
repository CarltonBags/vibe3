# Sandbox Template

This directory contains the Docker configuration and Next.js template files used to create predictable, secure Daytona sandboxes.

## 📁 Structure

```
sandbox-templates/
├── Dockerfile              # Docker image with Node 20 + dependencies
├── package.json           # Pinned versions (Next.js, React, Tailwind, FontAwesome)
├── next.config.js         # Next.js configuration
├── tailwind.config.js     # Tailwind CSS configuration
├── postcss.config.js      # PostCSS configuration
├── tsconfig.json          # TypeScript configuration
├── app/
│   ├── globals.css        # Global styles with Tailwind directives
│   └── layout.tsx         # Root layout component
├── VERSIONS.md            # Version tracking and update policy
└── README.md              # This file
```

## 🎯 Purpose

These templates ensure every sandbox created has:
- **Consistent environment**: Same Node.js, Next.js, and dependency versions
- **Pre-configured tools**: Tailwind CSS and FontAwesome ready to use
- **Security**: Pinned versions prevent unexpected breaking changes
- **Speed**: Pre-installed dependencies reduce setup time

## 🔧 How It Works

1. **Dockerfile** builds an image with Node 20 and pre-installs all dependencies
2. **Template files** are copied to each sandbox when created
3. **AI-generated code** is added as `app/page.tsx`
4. **Next.js dev server** starts automatically

## 📦 Creating the Snapshot

From the project root:

```bash
./scripts/create-snapshot.sh
```

This creates a Daytona snapshot named: `nextjs-tailwind-fontawesome-stable`

## 🔄 Updating Dependencies

1. Edit `package.json` with new versions
2. Update `VERSIONS.md` with changes and date
3. Run `./scripts/create-snapshot.sh`
4. Test thoroughly before using in production

## ⚙️ Configuration Files

### Dockerfile
- Base: `node:20-alpine`
- Pre-installs: All npm dependencies
- Exposes: Port 3000 for Next.js

### package.json
- Exact versions (no `^` or `~`)
- Includes all dependencies for a full Next.js + Tailwind + FontAwesome stack

### Config Files
- **next.config.js**: Minimal Next.js config
- **tailwind.config.js**: Standard Tailwind setup
- **postcss.config.js**: Tailwind + Autoprefixer
- **tsconfig.json**: Strict TypeScript configuration

## 🚀 Benefits

✅ **Reproducible**: Every sandbox is identical  
✅ **Fast**: Dependencies pre-installed  
✅ **Secure**: Vetted, stable versions  
✅ **Predictable**: No surprise updates  
✅ **Debuggable**: Known environment for troubleshooting  

## 📝 Notes

- The snapshot is created once and reused for all sandboxes
- Updating the snapshot doesn't affect existing sandboxes
- Old sandboxes can still reference previous snapshot versions
- Daytona handles versioning internally
