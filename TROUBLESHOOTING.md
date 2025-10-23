# Troubleshooting Guide

Common issues and how to fix them.

## 🔴 Authentication Errors

### Error: "Failed to fetch" when signing up/in

**What you see:**
- Yellow warning in auth modal: "⚠️ Authentication Not Configured"
- Buttons say "Auth Not Configured"
- Console shows "Failed to fetch"

**Why it happens:**
Supabase environment variables are missing from `.env.local`

**How to fix:**
1. Create or edit `.env.local` in project root
2. Add these three variables:
```env
NEXT_PUBLIC_SUPABASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=your-anon-key
SUPABASE_SERVICE_ROLE=your-service-role-key
```
3. Get keys from Supabase dashboard: **Settings** → **API**
4. **Restart dev server**: Stop (Ctrl+C) and run `npm run dev`
5. Try signing up again ✅

**Note:** The `NEXT_PUBLIC_` prefix is required for client-side variables!

---

### Error: "Authentication is not configured"

**What you see:**
- Red error message in auth modal
- Clear message pointing to `.env.local`

**How to fix:**
Same as above - add Supabase credentials to `.env.local`

---

### Error: "Invalid login credentials"

**What you see:**
- Can't sign in with correct email/password
- Error appears in auth modal

**Possible causes:**
1. Wrong email or password (Supabase is case-sensitive)
2. Account doesn't exist yet (need to sign up first)
3. Email not confirmed (if email confirmation is enabled)

**How to fix:**
- Double-check email and password
- Try "Sign up" if you haven't created account
- Check spam folder for confirmation email
- Check Supabase dashboard: **Authentication** → **Users** to see if account exists

---

## 🔴 Generation Errors

### Error: "Unauthorized - Please sign in"

**What you see:**
- Can't generate websites
- Error message after submitting prompt

**Why it happens:**
Generation requires authentication (after Supabase is configured)

**How to fix:**
1. Click "Sign In" button (top right)
2. Create account or log in
3. Try generating again ✅

---

### Error: "Generation limit exceeded"

**What you see:**
- Message: "Generation limit exceeded for this month"
- Shows remaining generations: 0
- Suggests upgrade

**Why it happens:**
You've used all your monthly generations for your tier:
- Free: 3 per month
- Starter: 40 per month
- Pro: 200 per month

**How to fix:**
- Wait until next month (usage resets)
- Upgrade to higher tier
- Or continue testing without auth (see Development Mode below)

---

### Error: "Failed to create sandbox"

**What you see:**
- Generation starts but fails
- Error in progress indicators

**Possible causes:**
1. Invalid Daytona credentials
2. Daytona quota exceeded
3. Network issues
4. Daytona service down

**How to fix:**
1. Check `.env.local` has correct `DAYTONA_KEY` and `DAYTONA_URL`
2. Check Daytona dashboard for quota/limits
3. Check console for specific error
4. Try again in a few minutes
5. Contact Daytona support if persistent

---

### Error: "OpenAI API error"

**What you see:**
- Generation fails during "Generating code" step
- Error mentions OpenAI

**Possible causes:**
1. Invalid OpenAI API key
2. No credits in OpenAI account
3. Rate limit exceeded
4. API key expired

**How to fix:**
1. Check `OPENAI_KEY` in `.env.local`
2. Go to [platform.openai.com/account/billing](https://platform.openai.com/account/billing)
3. Add payment method and credits
4. Check [platform.openai.com/account/limits](https://platform.openai.com/account/limits) for rate limits
5. Generate a new API key if needed

---

## 🔴 Display Issues

### Preview shows blank/white screen

**Possible causes:**
1. Sandbox not ready yet (still installing)
2. Build errors in generated code
3. WebSocket connection failed

**How to fix:**
1. Wait 60-90 seconds for full setup
2. Click "Refresh" button in preview
3. Check "Code" tab for errors
4. Try generating again with different prompt

---

### Preview shows "Warning" page

**Why it happens:**
Daytona preview URL redirects or shows warning

**How to fix:**
- Use the preview in our app (it handles warnings)
- Or click "Open in New Tab" for direct access
- Our proxy automatically bypasses warnings

---

### Code tab shows "File not found"

**Why it happens:**
File wasn't generated or didn't save

**How to fix:**
1. Check if other files appear in file tree
2. Try selecting different file
3. Generate again if all files missing
4. Check console for save errors

---

## 🔴 Development Issues

### Error: "Module not found"

**What you see:**
- Import errors in console
- App won't start

**How to fix:**
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### Error: "Port 3000 already in use"

**What you see:**
- Can't start dev server
- Error about port in use

**How to fix:**
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use different port
npm run dev -- -p 3001
```

---

### Changes not appearing

**What you see:**
- Edit code but no changes show
- Old version still running

**How to fix:**
```bash
# Clear Next.js cache
rm -rf .next

# Restart dev server
npm run dev
```

---

## 🟡 Development Mode (No Auth)

Want to test without setting up Supabase?

### How to run without auth:

1. **Don't add** Supabase variables to `.env.local`
2. Only add OpenAI and Daytona keys
3. Start app: `npm run dev`
4. You'll see console warning (that's OK!)
5. Generate without signing in

**What works:**
- ✅ UI and styling
- ✅ Text input
- ✅ Generation (bypasses auth check)
- ✅ Preview and code viewer

**What doesn't work:**
- ❌ Sign up/login (buttons disabled)
- ❌ User menu
- ❌ Usage tracking
- ❌ Project saving
- ❌ Limit enforcement

**When to use:**
- Testing UI changes
- Demoing the app
- Developing without database
- Before Supabase setup complete

---

## 🔴 Database Issues

### Error: "User not found" after signup

**Why it happens:**
Database trigger not working or migration not run

**How to fix:**
1. Go to Supabase dashboard
2. Open SQL Editor
3. Re-run `supabase/migrations/001_initial_schema.sql`
4. Check **Authentication** → **Users** to see if user exists
5. Manually create user profile if needed

---

### Error: "Permission denied" on database query

**Why it happens:**
Row Level Security blocking query

**How to fix:**
- Make sure you're signed in
- Check RLS policies in Supabase
- Use `supabaseAdmin` for server-side queries (not `supabase`)
- Check user has correct permissions

---

## 🟢 Verification Checklist

### Basic Setup:
- [ ] `npm install` completed without errors
- [ ] `.env.local` exists with required keys
- [ ] `npm run dev` starts successfully
- [ ] Can access http://localhost:3000
- [ ] No red errors in console

### With Supabase:
- [ ] Supabase project created
- [ ] Migration SQL run successfully
- [ ] Email auth enabled
- [ ] All 3 Supabase keys in `.env.local`
- [ ] Keys have `NEXT_PUBLIC_` prefix (first two)
- [ ] Dev server restarted after adding keys

### Authentication:
- [ ] "Sign In" button appears (not auth modal warning)
- [ ] Can click "Sign up" toggle
- [ ] Can enter email/password
- [ ] Submit button enabled (not "Auth Not Configured")
- [ ] Can create account successfully
- [ ] Avatar appears after signup
- [ ] Can sign out

### Generation:
- [ ] Can enter prompt
- [ ] Generate button works
- [ ] Progress indicators show
- [ ] Preview loads (60-90s)
- [ ] Can switch to Code tab
- [ ] Files appear in file tree
- [ ] Can view file contents

---

## 🆘 Still Having Issues?

### Check These Files:
1. `.env.local` - Are all keys present and correct?
2. `package.json` - Run `npm install` again
3. Console - Any red error messages?
4. Network tab - Any failed requests?

### Get More Info:
```bash
# Check Node version (need 18+)
node --version

# Check npm version
npm --version

# Check for TypeScript errors
npx tsc --noEmit

# Check Next.js version
npm list next
```

### Useful Resources:
- `ENV_SETUP.md` - Environment variables guide
- `QUICK_START.md` - Setup guide
- `SUPABASE_SETUP.md` - Database setup
- `AUTH_SETUP.md` - Authentication guide
- Supabase Docs: [supabase.com/docs](https://supabase.com/docs)
- Next.js Docs: [nextjs.org/docs](https://nextjs.org/docs)

---

## 💡 Pro Tips

1. **Always restart dev server** after changing `.env.local`
2. **Check console first** - errors usually explain the issue
3. **Clear cache** if things seem stuck: `rm -rf .next`
4. **Test incrementally** - set up one thing at a time
5. **Use development mode** to test without auth
6. **Read error messages** - they're usually helpful!

---

Need more help? Check the documentation files or create an issue on GitHub!

