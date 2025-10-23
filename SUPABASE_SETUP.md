# Supabase Setup Guide

This guide will walk you through setting up Supabase for your Vibe AI Website Builder.

## 📋 Prerequisites

- Supabase account (https://supabase.com)
- Project created in Supabase

## 🚀 Step 1: Get Your Credentials

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the following values to your `.env.local`:

```env
SUPABASE_PROJECT_ID=your-project-id
SUPABASE_ANON_PUBLIC=your-anon-public-key
SUPABASE_SERVICE_ROLE=your-service-role-key
```

## 🗄️ Step 2: Create Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy the entire contents of `supabase/migrations/001_initial_schema.sql`
4. Paste it into the SQL editor
5. Click **Run** (or press Ctrl/Cmd + Enter)

This will create all the necessary tables:
- `pricing_tiers` - Subscription tiers (Free, Starter, Pro, Team, Enterprise)
- `users` - User profiles with tier assignments
- `projects` - User projects with sandbox information
- `project_files` - Stored code files for each project
- `user_usage` - Monthly usage tracking
- `generations` - Audit log of all generations

## 🔐 Step 3: Enable Authentication

### Enable Email Auth:
1. Go to **Authentication** → **Providers**
2. Enable **Email** provider
3. Configure email templates (optional but recommended)

### Enable Google OAuth (Optional):
1. In **Authentication** → **Providers**, enable **Google**
2. Follow Supabase's guide to set up Google OAuth
3. Add authorized redirect URLs:
   - Development: `http://localhost:3000/auth/callback`
   - Production: `https://yourdomain.com/auth/callback`

## 📊 Step 4: Verify Tables Created

1. Go to **Table Editor**
2. You should see all tables created:
   - ✅ pricing_tiers (with 5 default tiers)
   - ✅ users
   - ✅ projects
   - ✅ project_files
   - ✅ user_usage
   - ✅ generations

## 🔒 Step 5: Verify Row Level Security (RLS)

All tables have RLS enabled automatically. Verify policies:

1. Go to **Authentication** → **Policies**
2. Check that policies exist for each table
3. Key policies:
   - Users can only see/edit their own data
   - Projects can be viewed if owned by user OR if public
   - Pricing tiers are viewable by everyone

## 🧪 Step 6: Test the Setup

### Test User Creation:
```sql
-- Run in SQL Editor
SELECT * FROM pricing_tiers WHERE name = 'free';
```

You should see the Free tier with default settings.

### Create a Test User:
1. Go to **Authentication** → **Users**
2. Click **Add User**
3. Create a test user with email/password
4. Check **Table Editor** → **users** - user profile should be auto-created

### Verify Functions:
```sql
-- Test limit checking function
SELECT * FROM check_user_limits('your-test-user-uuid');

-- Test usage increment
SELECT increment_user_usage('your-test-user-uuid', 1000, true);

-- Verify usage was recorded
SELECT * FROM user_usage WHERE user_id = 'your-test-user-uuid';
```

## 📝 Database Schema Overview

### Pricing Tiers
```
free: $0/mo - 3 gens/month, 3 projects max
starter: $15/mo - 40 gens/month, 10 projects
pro: $49/mo - 200 gens/month, 50 projects
team: $149/mo - 1000 gens/month, unlimited projects
enterprise: $999/mo - unlimited everything
```

### User Flow
1. User signs up → `auth.users` created
2. Trigger fires → `users` profile created with free tier
3. Trigger fires → `user_usage` record created for current month
4. User generates → Check limits → Create project → Save files → Increment usage

### Key Functions

**`check_user_limits(user_id)`**
- Returns: `can_generate`, `reason`, `generations_remaining`, `projects_remaining`
- Checks monthly generation limits
- Checks total project limits

**`increment_user_usage(user_id, tokens, is_new_project)`**
- Increments generation count
- Adds token usage
- Increments project count if new

**`handle_new_user()`**
- Automatically creates user profile
- Assigns free tier
- Creates initial usage record

## 🔧 Troubleshooting

### Issue: User profile not created automatically
**Solution**: Check if trigger `on_auth_user_created` exists:
```sql
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

### Issue: RLS blocking queries
**Solution**: Verify you're using `supabaseAdmin` for server-side operations (bypasses RLS)

### Issue: Usage not incrementing
**Solution**: Check if current month's usage record exists:
```sql
SELECT * FROM user_usage 
WHERE user_id = 'your-user-id' 
AND period_start = DATE_TRUNC('month', NOW());
```

## 🎨 Customizing Pricing Tiers

To modify pricing tiers:

```sql
-- Update Pro tier limits
UPDATE pricing_tiers 
SET max_generations_per_month = 300,
    max_tokens_per_generation = 10000
WHERE name = 'pro';

-- Add a new feature to Starter tier
UPDATE pricing_tiers 
SET features = features || '["New Feature"]'::jsonb
WHERE name = 'starter';
```

## 📊 Useful Queries

### Get all users by tier:
```sql
SELECT 
  u.email,
  pt.display_name as tier,
  u.created_at
FROM users u
JOIN pricing_tiers pt ON u.tier_id = pt.id
ORDER BY u.created_at DESC;
```

### Get usage statistics:
```sql
SELECT 
  u.email,
  uu.generations_used,
  uu.tokens_used,
  uu.projects_created,
  pt.max_generations_per_month
FROM user_usage uu
JOIN users u ON uu.user_id = u.id
JOIN pricing_tiers pt ON u.tier_id = pt.id
WHERE uu.period_start = DATE_TRUNC('month', NOW())
ORDER BY uu.generations_used DESC;
```

### Get revenue projection:
```sql
SELECT 
  pt.display_name,
  COUNT(*) as users,
  pt.price_monthly * COUNT(*) / 100 as monthly_revenue
FROM users u
JOIN pricing_tiers pt ON u.tier_id = pt.id
WHERE u.subscription_status = 'active'
GROUP BY pt.display_name, pt.price_monthly
ORDER BY monthly_revenue DESC;
```

## ✅ Setup Complete!

Your Supabase database is now ready. Next steps:

1. ✅ Update `.env.local` with credentials
2. ✅ Run the migration SQL
3. ✅ Enable authentication providers
4. ✅ Test with a user signup
5. ✅ Integrate Stripe (optional, for payments)

## 🔗 Related Files

- `lib/supabase.ts` - Supabase client configuration
- `lib/db.ts` - Database helper functions
- `lib/auth-context.tsx` - Authentication React context
- `app/api/generate/route.ts` - Generation endpoint (integrated)
- `supabase/migrations/001_initial_schema.sql` - Database schema

## 🎯 Next: Add Payment Integration

Once Supabase is set up, you can integrate Stripe for payments. See `STRIPE_SETUP.md` (coming soon).

