# Supabase Integration - Complete Overview

## 🎯 What We've Built

A complete database-backed user system with authentication, project management, usage tracking, and pricing tiers.

## 📦 Files Created

### 1. **`lib/supabase.ts`** - Supabase Client Configuration
- Creates two clients:
  - `supabase` - For client-side with RLS
  - `supabaseAdmin` - For server-side, bypasses RLS
- TypeScript interfaces for all database tables

### 2. **`lib/db.ts`** - Database Helper Functions
Key functions:
- `checkUserLimits()` - Check if user can generate
- `incrementUsage()` - Track generations, tokens, projects
- `createProject()` - Create new project
- `updateProject()` - Update sandbox info
- `saveProjectFiles()` - Store code in database
- `getProjectFiles()` - Retrieve code from database
- `getUserProjects()` - Get user's project list
- `logGeneration()` - Audit logging
- `updateUserTier()` - Change subscription

### 3. **`lib/auth-context.tsx`** - React Authentication Context
Provides:
- `user` - Current user object
- `loading` - Auth loading state
- `signIn()` - Email/password login
- `signUp()` - Create new account
- `signOut()` - Logout
- `signInWithGoogle()` - OAuth login

### 4. **`app/auth/callback/route.ts`** - OAuth Callback Handler
Handles redirect after Google/OAuth login

### 5. **`app/api/generate/route.ts`** - Updated Generation Endpoint
Now includes:
- ✅ User authentication check
- ✅ Usage limit validation
- ✅ Token limit based on tier
- ✅ Project creation/update
- ✅ File storage in database
- ✅ Usage tracking
- ✅ Analytics logging
- ✅ Error logging

### 6. **`supabase/migrations/001_initial_schema.sql`** - Database Schema
Creates all tables, policies, triggers, and functions

## 🗄️ Database Schema

```
┌─────────────────┐
│ pricing_tiers   │
│  - id           │
│  - name         │ (free, starter, pro, team, enterprise)
│  - price        │
│  - limits       │
└─────────────────┘
        ↑
        │
┌─────────────────┐
│ users           │
│  - id           │ ← Linked to auth.users
│  - email        │
│  - tier_id      │ → References pricing_tiers
│  - stripe_*     │
└─────────────────┘
        ↑
        │
┌─────────────────┐       ┌──────────────────┐
│ projects        │       │ project_files    │
│  - id           │←──────│  - project_id    │
│  - user_id      │       │  - file_path     │
│  - name         │       │  - file_content  │
│  - prompt       │       └──────────────────┘
│  - sandbox_id   │
│  - preview_url  │
└─────────────────┘
        ↑
        │
┌─────────────────┐       ┌──────────────────┐
│ user_usage      │       │ generations      │
│  - user_id      │       │  - user_id       │
│  - period       │       │  - project_id    │
│  - gens_used    │       │  - tokens_used   │
│  - tokens_used  │       │  - cost          │
└─────────────────┘       │  - duration      │
                          └──────────────────┘
```

## 🔒 Security Features

### Row Level Security (RLS)
All tables have RLS enabled:
- ✅ Users can only see their own data
- ✅ Projects visible only to owner (or if public)
- ✅ Files protected by project ownership
- ✅ Usage data private
- ✅ Pricing tiers readable by all

### Authentication
- ✅ Email/password signup
- ✅ Google OAuth (optional)
- ✅ Automatic profile creation on signup
- ✅ JWT-based sessions
- ✅ Secure password hashing

## 📊 Usage Tracking & Limits

### How It Works:

1. **User Signs Up**
   - Free tier assigned automatically
   - Usage record created for current month

2. **User Generates Website**
   - Check limits: `can_generate`, `generations_remaining`
   - If exceeded → Show upgrade prompt
   - If ok → Generate code

3. **After Generation**
   - Create/update project
   - Save files to database
   - Increment usage counters
   - Log for analytics

4. **Monthly Reset**
   - New `user_usage` record created automatically
   - Previous month's data retained for history

### Limits by Tier:

```
Free Tier:
├─ 3 generations/month
├─ 3 projects max
├─ 4,000 tokens per generation
└─ 1-hour sandboxes

Starter ($15/mo):
├─ 40 generations/month
├─ 10 projects max
├─ 6,000 tokens per generation
└─ 4-hour sandboxes

Pro ($49/mo):
├─ 200 generations/month
├─ 50 projects max
├─ 8,000 tokens per generation
├─ 12-hour sandboxes
├─ GitHub export
├─ Custom domains
└─ API access

Team ($149/mo):
├─ 1,000 generations/month
├─ Unlimited projects
├─ 10,000 tokens per generation
├─ 24-hour sandboxes
└─ 10 seats

Enterprise ($999/mo):
└─ Everything unlimited
```

## 🔄 User Flow

### First-Time User:
```
1. Visit site
2. Click "Sign Up"
3. Enter email/password
4. Auto-created: user profile (free tier) + usage record
5. Can immediately generate (3 free gens)
```

### Returning User:
```
1. Sign in
2. See dashboard with:
   - Projects list
   - Usage stats (X/Y gens used this month)
   - Upgrade prompt if needed
3. Generate new or resume existing project
```

### Generation Flow:
```
1. User enters prompt
2. Backend checks: auth.uid() exists?
3. Backend checks: can_generate?
4. If yes:
   - Generate with OpenAI
   - Create Daytona sandbox
   - Save project + files to DB
   - Increment usage
   - Return preview URL
5. If no:
   - Return error with upgrade link
```

## 🛠️ API Changes

### `/api/generate` Request:
```json
{
  "prompt": "Build a todo app",
  "projectId": "uuid" // Optional, for regenerating
}
```

### Response (Success):
```json
{
  "success": true,
  "projectId": "uuid",
  "sandboxId": "daytona-id",
  "url": "https://preview.daytona.app",
  "token": "preview-token",
  "files": [...],
  "generationsRemaining": 2,
  "message": "Project created with 8 files"
}
```

### Response (Limit Exceeded):
```json
{
  "error": "Generation limit exceeded for this month",
  "generationsRemaining": 0,
  "upgradeRequired": true
}
```

### Response (Unauthorized):
```json
{
  "error": "Unauthorized - Please sign in"
}
```

## 📈 Analytics Available

### User Metrics:
```sql
-- Total users by tier
SELECT tier, COUNT(*) FROM users GROUP BY tier;

-- Monthly active users
SELECT COUNT(DISTINCT user_id) FROM generations 
WHERE created_at >= NOW() - INTERVAL '30 days';

-- Average tokens per user
SELECT AVG(tokens_used) FROM user_usage 
WHERE period_start = DATE_TRUNC('month', NOW());
```

### Revenue Metrics:
```sql
-- MRR (Monthly Recurring Revenue)
SELECT SUM(price_monthly) / 100 as mrr
FROM users u
JOIN pricing_tiers pt ON u.tier_id = pt.id
WHERE subscription_status = 'active';

-- Revenue by tier
SELECT pt.name, COUNT(*) * pt.price_monthly / 100 as revenue
FROM users u
JOIN pricing_tiers pt ON u.tier_id = pt.id
GROUP BY pt.name, pt.price_monthly;
```

### Performance Metrics:
```sql
-- Average generation time
SELECT AVG(duration_ms) / 1000 as avg_seconds
FROM generations;

-- Success rate
SELECT 
  status,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
FROM generations
GROUP BY status;
```

## 🚀 Next Steps

### 1. Add Authentication UI
Create login/signup forms using the `AuthContext`

### 2. Add Dashboard
Show user's projects, usage, and stats

### 3. Add Stripe Integration
For handling payments and subscription management

### 4. Add Project Management
List, resume, delete, and share projects

### 5. Add Admin Panel
View all users, usage, and manage tiers

## 🔧 Environment Variables Required

```env
# Supabase
SUPABASE_PROJECT_ID=your-project-id
SUPABASE_ANON_PUBLIC=your-anon-key
SUPABASE_SERVICE_ROLE=your-service-role-key

# OpenAI (existing)
OPENAI_KEY=your-openai-key

# Daytona (existing)
DAYTONA_KEY=your-daytona-key
DAYTONA_URL=your-daytona-url

# Stripe (for later)
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## ✅ Testing Checklist

- [ ] Run SQL migration in Supabase
- [ ] Verify tables created
- [ ] Test user signup
- [ ] Verify user profile auto-created
- [ ] Test generation with auth
- [ ] Verify usage increment
- [ ] Test limit enforcement
- [ ] Verify project saved to DB
- [ ] Verify files saved to DB
- [ ] Test error logging

## 📚 Resources

- [Supabase Docs](https://supabase.com/docs)
- [Supabase Auth Guide](https://supabase.com/docs/guides/auth)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Database Functions](https://supabase.com/docs/guides/database/functions)

---

**Status**: ✅ Database integration complete and ready for testing!

