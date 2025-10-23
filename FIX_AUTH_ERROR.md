# Fix: "Database error saving new user"

## 🔍 Diagnose the Problem

Run this in **Supabase SQL Editor** to see what's wrong:

### Copy and run: `supabase/diagnostics.sql`

Open the file and run all queries. Look for:

1. **Pricing tiers check** - Should show 5 tiers
2. **Trigger check** - Should show `on_auth_user_created` enabled
3. **Function check** - Should show `handle_new_user`
4. **Orphaned users** - Users in auth but not in public.users

---

## 🔧 Apply the Fix

Run this in **Supabase SQL Editor**:

### Copy and run: `supabase/fix_trigger.sql`

This will:
- ✅ Drop and recreate the trigger with better error handling
- ✅ Add logging to see what's failing
- ✅ Fix any issues with the function
- ✅ Verify everything is set up correctly

---

## 🧪 Test Again

After running the fix:

1. Go to your app: http://localhost:3000
2. Click "Sign In"
3. Try creating a new account
4. Should work now! ✅

---

## 🐛 Still Having Issues?

### Check Supabase Logs

1. Go to **Logs** → **Postgres Logs** in Supabase dashboard
2. Try signing up again
3. Look for error messages in real-time
4. The logs will show exactly what's failing

### Common Issues:

#### Issue 1: "Free tier not found"
**Symptoms:** Error mentions pricing_tiers

**Fix:** Run this in SQL Editor:
```sql
-- Check if pricing_tiers exist
SELECT * FROM pricing_tiers WHERE name = 'free';

-- If empty, re-run the INSERT from the migration
INSERT INTO pricing_tiers (name, display_name, price_monthly, max_projects, max_generations_per_month, max_tokens_per_generation, sandbox_duration_hours, features, can_export_github, can_use_custom_domain, has_priority_queue, has_api_access, team_seats) VALUES
('free', 'Free Vibe', 0, 3, 3, 4000, 1, 
  '["3 generations per month", "1-hour sandboxes", "Community support"]'::jsonb, 
  false, false, false, false, 1);
```

#### Issue 2: "Duplicate key value violates unique constraint"
**Symptoms:** User already exists in auth.users but not in public.users

**Fix:** Manually create the profile:
```sql
-- Replace with your email
WITH auth_user AS (
  SELECT id, email FROM auth.users WHERE email = 'your@email.com'
),
free_tier AS (
  SELECT id FROM pricing_tiers WHERE name = 'free'
)
INSERT INTO public.users (id, email, tier_id, full_name)
SELECT 
  au.id, 
  au.email, 
  ft.id,
  'Your Name'
FROM auth_user au, free_tier ft
ON CONFLICT (id) DO NOTHING;
```

#### Issue 3: "Permission denied for table users"
**Symptoms:** RLS blocking the insert

**Fix:** The function needs `SECURITY DEFINER` (already in fix_trigger.sql)

#### Issue 4: "null value in column 'tier_id' violates not-null constraint"
**Symptoms:** Can't find free tier

**Fix:** Check pricing_tiers:
```sql
SELECT * FROM pricing_tiers;
-- If empty, re-run the pricing_tiers INSERT from migration
```

---

## 📊 Manual Verification

After fix, verify everything:

### 1. Check Tables Exist
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'pricing_tiers', 'projects', 'project_files', 'user_usage', 'generations');
```

Should return 6 rows.

### 2. Check Pricing Tiers
```sql
SELECT name, display_name, price_monthly FROM pricing_tiers ORDER BY price_monthly;
```

Should return:
- free ($0)
- starter ($15)
- pro ($49)
- team ($149)
- enterprise ($999)

### 3. Check Trigger
```sql
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

Should return: `on_auth_user_created | O` (O means enabled)

### 4. Check Function
```sql
SELECT proname FROM pg_proc WHERE proname = 'handle_new_user';
```

Should return: `handle_new_user`

---

## 🎯 Quick Fix Checklist

Run in order:

- [ ] Run `supabase/diagnostics.sql` to find the issue
- [ ] Run `supabase/fix_trigger.sql` to fix the trigger
- [ ] Check Supabase → Logs → Postgres Logs
- [ ] Try signup again in your app
- [ ] Check Supabase → Authentication → Users (should see new user)
- [ ] Check Supabase → Table Editor → users (should see profile)
- [ ] Success! ✅

---

## 💡 Understanding the Error

The error "Database error saving new user" happens when:

1. ✅ Supabase creates the auth user (in `auth.users`)
2. ❌ Trigger tries to create profile (in `public.users`) but fails

**Why it fails:**
- Missing pricing_tiers data
- Trigger not properly created
- RLS blocking the insert
- Function has a bug

**The fix:**
- Recreates trigger with better error handling
- Adds logging to diagnose issues
- Ensures SECURITY DEFINER is set
- Checks pricing_tiers exist before inserting

---

## 🆘 Last Resort: Nuclear Option

If NOTHING works, reset and start over:

```sql
-- WARNING: This deletes everything!

-- 1. Drop all tables
DROP TABLE IF EXISTS generations CASCADE;
DROP TABLE IF EXISTS user_usage CASCADE;
DROP TABLE IF EXISTS project_files CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS pricing_tiers CASCADE;

-- 2. Drop triggers and functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS check_user_limits(UUID) CASCADE;
DROP FUNCTION IF EXISTS increment_user_usage(UUID, INTEGER, BOOLEAN) CASCADE;

-- 3. Re-run the complete migration
-- Copy ALL of: supabase/migrations/001_initial_schema.sql
-- Paste here and run
```

---

## ✅ Success Indicators

You'll know it works when:

1. Signup completes without errors
2. You see success message in app
3. Avatar appears in top right
4. In Supabase:
   - Authentication → Users shows the new user
   - Table Editor → users shows the profile
   - Table Editor → user_usage shows usage record

---

## 📚 Related Files

- `supabase/diagnostics.sql` - Run this to diagnose
- `supabase/fix_trigger.sql` - Run this to fix
- `supabase/migrations/001_initial_schema.sql` - Original migration
- `CHECK_SUPABASE.md` - General Supabase setup
- `TROUBLESHOOTING.md` - Other common errors

---

**TL;DR:** Run `supabase/fix_trigger.sql` in SQL Editor, then try signup again!

