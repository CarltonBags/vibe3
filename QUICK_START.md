# Quick Start Guide - Vibe AI Website Builder

Get up and running in 5-10 minutes!

## 🚀 Fast Track (Minimal Setup)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Add Environment Variables
Create `.env.local` in the root directory:

```env
# Required for generation
OPENAI_KEY=sk-your-openai-key
DAYTONA_KEY=your-daytona-key
DAYTONA_URL=https://api.daytona.io

# Optional (for auth - can skip for now)
# NEXT_PUBLIC_SUPABASE_PROJECT_ID=...
# NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=...
# SUPABASE_SERVICE_ROLE=...
```

**Where to get keys:**
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Daytona: [daytona.io](https://daytona.io) → Settings → API Keys

### Step 3: Run the App
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**You're done!** 🎉

---

## ✅ What Works Without Supabase

Even without Supabase configured, you can:
- ✅ Test the UI
- ✅ Generate websites (no auth required for testing)
- ✅ See the full generation flow
- ✅ Preview sandboxes
- ✅ View code

**To enable auth:** See the "Full Setup" section below.

---

## 🎯 Full Setup (With Authentication)

### Step 1: Set Up Supabase (10 minutes)

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create new project
   - Wait for setup (~2 minutes)

2. **Run Database Migration**
   - Go to **SQL Editor** in Supabase
   - Open `supabase/migrations/001_initial_schema.sql`
   - Copy entire file
   - Paste and **Run** in SQL Editor
   - Wait for success ✅

3. **Enable Email Auth**
   - Go to **Authentication** → **Providers**
   - Make sure **Email** is enabled

4. **Get API Keys**
   - Go to **Settings** → **API**
   - Copy these to `.env.local`:
     ```env
     NEXT_PUBLIC_SUPABASE_PROJECT_ID=abc...  (from Project URL)
     NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=eyJ...  (anon public key)
     SUPABASE_SERVICE_ROLE=eyJ...             (service_role secret)
     ```

5. **Restart Dev Server**
   ```bash
   # Stop (Ctrl+C) and restart
   npm run dev
   ```

### Step 2: Test Authentication

1. Open [http://localhost:3000](http://localhost:3000)
2. Click **"Sign In"** button (top right)
3. Click **"Sign up"** toggle
4. Create test account:
   - Name: Test User
   - Email: test@example.com
   - Password: test123
5. Should auto-login! ✅

### Step 3: Test Generation

1. Enter prompt: "Build a todo app"
2. Click the gradient arrow button
3. Wait ~60-90 seconds
4. See your generated website! 🎨

---

## 📁 Project Structure

```
vibe/
├── app/
│   ├── api/
│   │   ├── generate/route.ts    ← Main generation endpoint
│   │   └── proxy/route.ts       ← Preview proxy
│   ├── components/
│   │   ├── AuthModal.tsx        ← Login/signup modal
│   │   └── UserMenu.tsx         ← User dropdown
│   ├── layout.tsx               ← Root layout with AuthProvider
│   └── page.tsx                 ← Main landing page
├── lib/
│   ├── supabase.ts              ← Supabase client
│   ├── db.ts                    ← Database helpers
│   └── auth-context.tsx         ← Auth state management
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  ← Database schema
└── sandbox-templates/           ← Next.js templates for sandboxes
```

---

## 🔧 Configuration Files

### package.json
All dependencies installed. No changes needed.

### .env.local
**Create this file!** See `ENV_SETUP.md` for details.

### supabase/migrations/001_initial_schema.sql
Run this in Supabase SQL Editor to create database.

---

## 🧪 Testing Checklist

### Without Auth:
- [ ] App starts without errors
- [ ] Can see landing page
- [ ] Can enter text in input
- [ ] Gradient shows on "vibe" text
- [ ] Arrow button appears

### With Auth:
- [ ] "Sign In" button shows (top right)
- [ ] Can open auth modal
- [ ] Can create account
- [ ] Can login
- [ ] Avatar shows after login
- [ ] Can sign out

### Generation:
- [ ] Can enter prompt
- [ ] Generate button triggers
- [ ] Progress indicators show
- [ ] Preview appears (~60-90s)
- [ ] Can view generated code
- [ ] Can toggle between Preview/Code tabs

---

## 🐛 Common Issues

### Issue: App won't start
**Check:**
```bash
# Node version (need 18+)
node --version

# Install dependencies
npm install

# Clear cache if needed
rm -rf .next
npm run dev
```

### Issue: "supabaseKey is required"
**Fix:** You're seeing this error? Perfect! That's what we just fixed. Just:
1. Restart your dev server
2. Check console for helpful warnings
3. Add Supabase keys when ready (or ignore for now)

### Issue: Generation fails
**Check:**
1. OpenAI key is valid
2. OpenAI account has credits
3. Daytona key is valid
4. Check console for specific error

### Issue: Can't sign in
**Check:**
1. Supabase keys are in `.env.local`
2. Keys have `NEXT_PUBLIC_` prefix (client-side vars)
3. Ran database migration
4. Email auth is enabled in Supabase

---

## 📚 Documentation

- **`README.md`** - Main project overview
- **`ENV_SETUP.md`** - Complete environment variable guide ⭐
- **`SUPABASE_SETUP.md`** - Detailed Supabase setup
- **`AUTH_SETUP.md`** - Authentication guide
- **`PRICING_STRATEGY.md`** - Business model
- **`IMPLEMENTATION_SUMMARY.md`** - Full technical overview

---

## 🎨 Customization

### Change Colors:
Edit `app/globals.css` and `public/vibe_gradient.png`

### Change Text:
Edit `app/page.tsx` - Look for "give in to the vibe"

### Add Features:
- Dashboard: Create `app/dashboard/page.tsx`
- Projects: Create `app/projects/page.tsx`
- Settings: Create `app/settings/page.tsx`

---

## 🚀 Deployment

### Deploy to Vercel (Recommended):

1. Push to GitHub:
   ```bash
   git remote add origin https://github.com/yourusername/vibe.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com)
3. Click **"New Project"**
4. Import your GitHub repo
5. Add environment variables (same as `.env.local`)
6. Click **"Deploy"**

**Done!** Your app is live in ~2 minutes.

### Environment Variables for Production:
```env
OPENAI_KEY=sk-...
DAYTONA_KEY=...
DAYTONA_URL=https://api.daytona.io
NEXT_PUBLIC_SUPABASE_PROJECT_ID=...
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=...
SUPABASE_SERVICE_ROLE=...
```

---

## 💰 Costs

### Free Tier:
- ✅ Vercel hosting: Free
- ✅ Supabase: Free (50K auth users)
- ✅ OpenAI: Pay-as-you-go (~$0.004/generation)
- ✅ Daytona: Varies by plan

### Estimated Monthly:
- **Low usage** (10 gens/day): ~$12-20/month
- **Medium usage** (50 gens/day): ~$60-100/month
- **High usage** (200 gens/day): ~$240-400/month

---

## ✅ You're Ready!

Your Vibe AI Website Builder is ready to:
- 🎨 Generate beautiful websites from prompts
- 👤 Authenticate users (when Supabase configured)
- 📊 Track usage and limits
- 🚀 Deploy to production
- 💰 Start making money!

**Next Steps:**
1. Test generation flow
2. Set up Supabase (if you want auth)
3. Customize the UI
4. Deploy to Vercel
5. Add Stripe for payments
6. Launch! 🚀

---

**Need help?** Check the detailed docs in the root directory or the GitHub repo.

**give in to the vibe** 🎨✨

