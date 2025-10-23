# Fix: Database Error Saving New User

## 🔴 What's Happening

The error "Database error saving new user" means:
- ✅ Supabase authentication is working
- ✅ Your credentials are correct
- ❌ Database tables don't exist yet
- ❌ The trigger to create user profiles isn't set up

## ✅ Solution: Run the Database Migration

### Step 1: Go to Supabase Dashboard

1. Open [supabase.com](https://supabase.com)
2. Sign in to your account
3. Select your project: **sgmxtxenksqofsutaura**

### Step 2: Open SQL Editor

1. In left sidebar, click **SQL Editor**
2. Click **New Query** button (top right)

### Step 3: Copy the Migration SQL

1. Open the file: `supabase/migrations/001_initial_schema.sql`
2. Copy **ALL** of its contents (413 lines)
3. Paste into the SQL Editor in Supabase

### Step 4: Run the Migration

1. Click **Run** button (or press Cmd/Ctrl + Enter)
2. Wait for success message ✅
3. Should see: "Success. No rows returned"

### Step 5: Verify Tables Created

1. In Supabase, go to **Table Editor** (left sidebar)
2. You should now see these tables:
   - ✅ pricing_tiers (with 5 rows)
   - ✅ users
   - ✅ projects
   - ✅ project_files
   - ✅ user_usage
   - ✅ generations

### Step 6: Try Signup Again

1. Go back to your app: http://localhost:3000
2. Click "Sign In"
3. Try creating an account again
4. It should work now! 🎉

---

## 🧪 Quick Test in Supabase

To verify the migration worked, run this in SQL Editor:

```sql
-- Check if pricing tiers exist
SELECT * FROM pricing_tiers;

-- Should show 5 tiers: free, starter, pro, team, enterprise
```

If you see the 5 pricing tiers, the migration worked! ✅

---

## 🔍 What the Migration Does

The migration SQL creates:

1. **Tables**:
   - `pricing_tiers` - Your subscription plans
   - `users` - User profiles
   - `projects` - Generated projects
   - `project_files` - Code files
   - `user_usage` - Monthly usage tracking
   - `generations` - Audit log

2. **Triggers**:
   - `on_auth_user_created` - Automatically creates user profile when someone signs up
   - This is what's missing and causing your error!

3. **Functions**:
   - `check_user_limits()` - Validates generation limits
   - `increment_user_usage()` - Tracks usage
   - `handle_new_user()` - Creates user profile

4. **Security**:
   - Row Level Security policies
   - Users can only see their own data

---

## ⚠️ Common Issues

### Issue: "relation 'pricing_tiers' does not exist"

**Why:** Migration wasn't run or failed partway

**Fix:**
1. Go to SQL Editor
2. Run the migration again (it's safe to re-run)
3. Check for any red error messages

### Issue: "permission denied for table users"

**Why:** RLS policies not set up correctly

**Fix:**
1. Make sure you ran the COMPLETE migration SQL
2. Don't skip any parts
3. Run it all as one query

### Issue: Migration runs but still get error

**Why:** Trigger might not have been created

**Fix:** Run this in SQL Editor to check:
```sql
-- Check if trigger exists
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

If it returns nothing, the trigger wasn't created. Re-run the migration.

---

## 📝 Step-by-Step Checklist

- [ ] Opened Supabase dashboard
- [ ] Went to SQL Editor
- [ ] Copied ALL of `supabase/migrations/001_initial_schema.sql`
- [ ] Pasted into SQL Editor
- [ ] Clicked "Run"
- [ ] Saw success message (no errors)
- [ ] Went to Table Editor
- [ ] See 6 tables listed
- [ ] Checked pricing_tiers has 5 rows
- [ ] Tried signup again
- [ ] Account created successfully! ✅

---

## 🎯 After Migration Success

You should be able to:
- ✅ Create account (signup)
- ✅ See user profile auto-created
- ✅ Generate websites (with limits)
- ✅ Track usage
- ✅ Store projects

---

## 💡 Quick Command to Copy Migration

If you're in the project directory:

```bash
# Show the migration file path
ls supabase/migrations/001_initial_schema.sql

# View first few lines to confirm it's the right file
head -20 supabase/migrations/001_initial_schema.sql
```

You should see it starts with:
```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

That's the right file! Copy all 413 lines.

---

**TL;DR: Run the SQL migration in Supabase dashboard to create database tables and triggers!**

