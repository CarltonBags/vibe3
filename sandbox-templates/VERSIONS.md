# Pinned Dependency Versions

This file tracks the exact versions used in the Docker snapshot for reproducible builds.

## Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| Node.js | 20 (Alpine) | JavaScript runtime |

## Core Framework

| Package | Version | Purpose |
|---------|---------|---------|
| next | 14.2.18 | React framework |
| react | 18.3.1 | UI library |
| react-dom | 18.3.1 | React DOM bindings |

## UI Libraries

| Package | Version | Purpose |
|---------|---------|---------|
| tailwindcss | 3.4.17 | Utility-first CSS |
| @fortawesome/fontawesome-svg-core | 6.7.2 | FontAwesome core |
| @fortawesome/free-solid-svg-icons | 6.7.2 | Solid icons |
| @fortawesome/free-regular-svg-icons | 6.7.2 | Regular icons |
| @fortawesome/react-fontawesome | 0.2.2 | React components |

## Build Tools

| Package | Version | Purpose |
|---------|---------|---------|
| typescript | 5.7.2 | Type checking |
| autoprefixer | 10.4.20 | CSS vendor prefixes |
| postcss | 8.4.49 | CSS processing |

## Type Definitions

| Package | Version | Purpose |
|---------|---------|---------|
| @types/node | 22.10.5 | Node.js types |
| @types/react | 18.3.18 | React types |
| @types/react-dom | 18.3.5 | React DOM types |

---

## Update Policy

- **Security patches**: Update immediately
- **Minor versions**: Review and update monthly
- **Major versions**: Plan and test before updating

## Last Updated

2024-01-10 (Initial setup)

## How to Update

1. Edit `package.json` with new versions
2. Run `./scripts/create-snapshot.sh`
3. Test generated sandboxes thoroughly
4. Update this file with new versions and date
