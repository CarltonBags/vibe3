# Environment Variables Reference

## ✅ Correct Variable Names

Copy these **exact names** to your `.env.local`:

```env
# OpenAI
OPENAI_KEY=sk-...

# Daytona
DAYTONA_KEY=dtn_...
DAYTONA_URL=https://app.daytona.io/api

# Supabase (⚠️ Note the NEXT_PUBLIC_ prefix!)
NEXT_PUBLIC_SUPABASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=eyJhbGci...
SUPABASE_SERVICE_ROLE=eyJhbGci...
```

## ⚠️ Common Mistakes

### ❌ WRONG:
```env
SUPABASE_PROJECT_ID=...           # Missing NEXT_PUBLIC_
SUPABASE_ANON_PUBLIC=...          # Missing NEXT_PUBLIC_
```

### ✅ CORRECT:
```env
NEXT_PUBLIC_SUPABASE_PROJECT_ID=...   # Has NEXT_PUBLIC_
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=...  # Has NEXT_PUBLIC_
SUPABASE_SERVICE_ROLE=...              # No prefix (server-only)
```

## 🤔 Why NEXT_PUBLIC_?

Next.js requires the `NEXT_PUBLIC_` prefix for environment variables that need to be accessible in the browser (client-side).

- **Client-side** (browser needs it) → `NEXT_PUBLIC_` prefix
- **Server-only** (API routes only) → No prefix

### Supabase Variables:

| Variable | Where Used | Needs Prefix? |
|----------|------------|---------------|
| `NEXT_PUBLIC_SUPABASE_PROJECT_ID` | Browser (auth modal) | ✅ YES |
| `NEXT_PUBLIC_SUPABASE_ANON_PUBLIC` | Browser (auth modal) | ✅ YES |
| `SUPABASE_SERVICE_ROLE` | Server only (API routes) | ❌ NO |

## 📝 Quick Copy-Paste Template

```env
# ============================================
# VIBE AI WEBSITE BUILDER - ENVIRONMENT VARIABLES
# ============================================

# OpenAI API (Required)
# Get from: https://platform.openai.com/api-keys
OPENAI_KEY=sk-proj-...

# Daytona (Required)
# Get from: https://daytona.io → Settings → API Keys
DAYTONA_KEY=dtn_...
DAYTONA_URL=https://app.daytona.io/api

# Supabase (Required for Auth)
# Get from: https://supabase.com → Project Settings → API
# ⚠️ IMPORTANT: First two need NEXT_PUBLIC_ prefix!
NEXT_PUBLIC_SUPABASE_PROJECT_ID=
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=
SUPABASE_SERVICE_ROLE=

# Optional: Stripe (for payments - add later)
# STRIPE_PUBLIC_KEY=pk_test_...
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...
```

## 🔧 After Adding/Changing Variables

**ALWAYS restart your dev server:**

```bash
# Stop the server (Ctrl+C or Cmd+C)
# Then restart:
npm run dev
```

Environment variables are loaded when Next.js starts, not dynamically!

## ✅ How to Verify

1. **Save** `.env.local` with correct variable names
2. **Restart** dev server
3. **Open** browser console
4. You should **NOT** see:
   - ⚠️ "Supabase is not configured"
   - ⚠️ Yellow warning in auth modal
5. Auth buttons should be **enabled**

## 🐛 Still Seeing Warnings?

Double-check:
- [ ] Variable names are **exactly** as shown above
- [ ] No typos (case-sensitive!)
- [ ] No extra spaces around `=`
- [ ] File is named `.env.local` (not `.env`)
- [ ] File is in project root (next to `package.json`)
- [ ] Dev server was **restarted** after changes

## 📚 Related Docs

- `ENV_SETUP.md` - Detailed setup guide
- `TROUBLESHOOTING.md` - Fix common issues
- `QUICK_START.md` - Get started fast

