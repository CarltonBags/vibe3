# Environment Variables Setup

## 🚀 Quick Start

Create a `.env.local` file in the root directory with these variables:

```env
# OpenAI (Required for generation)
OPENAI_KEY=sk-...

# Daytona (Required for sandboxes)
DAYTONA_KEY=your-daytona-key
DAYTONA_URL=https://api.daytona.io

# Supabase (Required for authentication & database)
NEXT_PUBLIC_SUPABASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 📝 Where to Get Each Key

### 1. OpenAI API Key
1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign in or create account
3. Navigate to **API Keys**
4. Click **Create new secret key**
5. Copy and paste into `OPENAI_KEY`

**Cost**: Pay-as-you-go (GPT-4o-mini ~$0.004 per generation)

---

### 2. Daytona Keys
1. Go to [daytona.io](https://daytona.io)
2. Sign up for an account
3. Navigate to **Settings** → **API Keys**
4. Copy:
   - API Key → `DAYTONA_KEY`
   - API URL → `DAYTONA_URL` (usually `https://api.daytona.io`)

**Cost**: Varies by plan, check their pricing

---

### 3. Supabase Keys
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Go to **Settings** → **API**
4. Copy:
   - Project URL's project ID (the part before `.supabase.co`) → `NEXT_PUBLIC_SUPABASE_PROJECT_ID`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_PUBLIC`
   - `service_role` `secret` key → `SUPABASE_SERVICE_ROLE`

**Cost**: Free tier available (50,000+ auth users)

#### Example:
```
Project URL: https://abcdefghijk.supabase.co
             
NEXT_PUBLIC_SUPABASE_PROJECT_ID=abcdefghijk
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=eyJhbG...  (anon key)
SUPABASE_SERVICE_ROLE=eyJhbG...             (service_role key)
```

---

## ⚠️ Important Notes

### NEXT_PUBLIC_ Prefix
Variables with `NEXT_PUBLIC_` prefix are **exposed to the browser**. Only put non-sensitive keys here!

- ✅ `NEXT_PUBLIC_SUPABASE_PROJECT_ID` - Safe (just an ID)
- ✅ `NEXT_PUBLIC_SUPABASE_ANON_PUBLIC` - Safe (public key with RLS)
- ❌ `SUPABASE_SERVICE_ROLE` - **SECRET!** Server-side only

### Never Commit .env.local
The `.env.local` file is already in `.gitignore`. **Never commit it to git!**

### Production Environment
For production (Vercel, etc.), add these as **Environment Variables** in your hosting platform's dashboard.

---

## 🧪 Testing Without Supabase

If you want to test the app without setting up Supabase:

1. **Don't** add Supabase keys
2. The app will show a warning in console
3. You can still test generation (but won't have auth/limits)

The app is designed to work without Supabase for development!

---

## 🔒 Security Best Practices

### Development:
- ✅ Use `.env.local` for local development
- ✅ Add `.env.local` to `.gitignore`
- ✅ Never commit API keys

### Production:
- ✅ Use environment variables in hosting platform
- ✅ Rotate keys regularly
- ✅ Use different keys for dev/staging/prod
- ✅ Enable API key restrictions where possible

---

## 🐛 Troubleshooting

### Error: "supabaseKey is required"
**Fix**: Make sure you have `NEXT_PUBLIC_` prefix on Supabase keys:
```env
NEXT_PUBLIC_SUPABASE_PROJECT_ID=...  ← Note the prefix!
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=... ← Note the prefix!
```

### Error: "Invalid API key"
**Fix**: Double-check you copied the complete key (they're long!)

### Error: "OpenAI API error"
**Fix**: 
1. Check key is correct
2. Make sure you have credits in your OpenAI account
3. Check API key hasn't expired

### Error: "Sandbox creation failed"
**Fix**:
1. Check Daytona key is correct
2. Make sure you're on a paid plan (if needed)
3. Check your Daytona account has quota remaining

### Warning: "Supabase is not configured"
**Fix**: This is just a warning. Add Supabase keys to enable auth.

---

## 📊 Minimum Setup

### To Run at All:
```env
OPENAI_KEY=...
DAYTONA_KEY=...
DAYTONA_URL=...
```

### To Enable Auth:
```env
+ NEXT_PUBLIC_SUPABASE_PROJECT_ID=...
+ NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=...
+ SUPABASE_SERVICE_ROLE=...
```

---

## 🚀 After Adding Variables

1. Save `.env.local`
2. Restart your dev server:
   ```bash
   # Stop server (Ctrl+C)
   npm run dev
   ```
3. Check console for any warnings
4. Test the app!

---

## ✅ Verification Checklist

- [ ] `.env.local` created in root directory
- [ ] OpenAI key added and working
- [ ] Daytona keys added and working
- [ ] Supabase keys added (if using auth)
- [ ] No errors in console
- [ ] Can generate websites
- [ ] Can sign in (if Supabase configured)

---

## 🎯 Example .env.local

```env
# OpenAI
OPENAI_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABCDEFGHIJKLMNOPQRST

# Daytona
DAYTONA_KEY=dt_1234567890abcdefghijklmnopqrstuvwxyz
DAYTONA_URL=https://api.daytona.io

# Supabase
NEXT_PUBLIC_SUPABASE_PROJECT_ID=abcdefghijklmnop
NEXT_PUBLIC_SUPABASE_ANON_PUBLIC=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNjQwMjU2MCwiZXhwIjoxOTMxOTc4NTYwfQ.SIGNATURE_HERE
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjE2NDAyNTYwLCJleHAiOjE5MzE5Nzg1NjB9.DIFFERENT_SIGNATURE_HERE
```

*(These are example keys - use your own!)*

---

Need help? Check the full setup guides:
- `SUPABASE_SETUP.md` for Supabase
- `AUTH_SETUP.md` for authentication

