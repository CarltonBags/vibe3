# Fixed: 401 Unauthorized Error in Usage API

## 🐛 The Problem

When the `UsageIndicator` component tried to fetch user usage data from `/api/user/usage`, it received a **401 Unauthorized** error.

### Error Message:
```
Failed to load resource: the server responded with a status of 401 (Unauthorized)
:3000/api/user/usage:1
```

---

## 🔍 Root Cause

The `/api/user/usage` API route was trying to get the user session using:

```typescript
const { data: { session } } = await supabase.auth.getSession()
```

**Problem:** This method only works on the **client-side**. In Next.js API routes (server-side), the session data is stored in **cookies**, not in the Supabase client instance.

---

## ✅ The Solution

### 1. Installed `@supabase/ssr` Package

```bash
npm install @supabase/ssr
```

This package provides server-side utilities for working with Supabase in Next.js.

### 2. Updated API Route to Use Cookies

**Before:**
```typescript
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data: { session } } = await supabase.auth.getSession()
  // ❌ Returns null in API routes!
}
```

**After:**
```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const cookieStore = await cookies()
  
  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
  
  const { data: { session } } = await supabase.auth.getSession()
  // ✅ Now reads session from cookies!
}
```

### 3. Added Debugging Logs

```typescript
console.log('Usage API: Session check:', session ? 'Authenticated' : 'Not authenticated')
console.log('Usage API: Fetching for user:', userId)
console.log('Usage API: User tier:', userWithTier.tier.name)
```

### 4. Fixed Frontend Hook

Updated `useUserUsage` to use `useCallback` and added comprehensive logging:

```typescript
const fetchUsage = useCallback(async () => {
  if (!user) {
    console.log('useUserUsage: No user, skipping fetch')
    return
  }
  
  console.log('useUserUsage: Fetching usage for user:', user.id)
  const res = await fetch('/api/user/usage')
  console.log('useUserUsage: Response status:', res.status)
  // ...
}, [user])
```

### 5. Added Loading Skeleton

The `UsageIndicator` now shows a nice loading animation while fetching:

```tsx
if (loading) {
  return (
    <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg px-4 py-2.5 shadow-xl">
      <div className="flex items-center gap-4 animate-pulse">
        <div className="h-10 w-20 bg-zinc-800 rounded"></div>
        <div className="h-12 w-px bg-zinc-700"></div>
        <div className="h-10 w-32 bg-zinc-800 rounded"></div>
        <div className="h-12 w-px bg-zinc-700"></div>
        <div className="h-10 w-24 bg-zinc-800 rounded"></div>
      </div>
    </div>
  )
}
```

---

## 🧪 Testing

1. **Open your browser console** (F12)
2. **Sign in** to your account
3. **Check the console** for these logs:
   ```
   useUserUsage: Fetching usage for user: abc123...
   useUserUsage: Response status: 200
   useUserUsage: Fetched data: { generationsUsed: 0, ... }
   UsageIndicator: Rendering with usage: { ... }
   ```
4. **Verify the indicator appears** in the top-right corner next to your avatar

---

## 📊 What You Should See Now

**Top Right Corner:**
```
┌────────────────────────────────────────────────────────────┐
│ [Plan: Free Vibe] | [⚡ 3/3 ████] | [📄 0 tokens] [👤]    │
└────────────────────────────────────────────────────────────┘
```

The usage indicator should now display:
- ✅ Your tier badge (e.g., "Free Vibe")
- ✅ Generations remaining (e.g., "3 / 3")
- ✅ Progress bar (color-coded)
- ✅ Total tokens used

---

## 🔧 Key Learnings

### Client-Side vs Server-Side Auth

| Context | Method | Works? |
|---------|--------|--------|
| **Browser/Client Components** | `supabase.auth.getSession()` | ✅ Yes |
| **API Routes** | `supabase.auth.getSession()` | ❌ No - returns null |
| **API Routes** | `createServerClient()` with cookies | ✅ Yes |

### Why Cookies?

When you sign in with Supabase:
1. The auth token is stored in a **cookie** (e.g., `sb-access-token`)
2. This cookie is automatically sent with every request
3. API routes need to **read the cookie** to get the session
4. `@supabase/ssr` handles this automatically

---

## 📁 Files Modified

- ✅ `app/api/user/usage/route.ts` - Fixed to use server-side auth
- ✅ `lib/hooks/useUserUsage.ts` - Added logging and useCallback
- ✅ `app/components/UsageIndicator.tsx` - Added loading skeleton
- ✅ `package.json` - Added `@supabase/ssr` dependency

---

## 🚀 Next Steps

If you still don't see the indicator:

1. **Hard refresh** your browser (Cmd+Shift+R / Ctrl+Shift+F5)
2. **Check browser console** for any errors
3. **Check terminal** for API logs
4. **Verify you're signed in** (avatar should show in top right)
5. **Check Supabase** - verify `user_usage` table has data

---

## 💡 Common Issues

### Issue: Still showing 401
**Fix:** Clear browser cookies and sign in again

### Issue: No data showing
**Fix:** Check if `user_usage` table has a record for your user:
```sql
SELECT * FROM user_usage WHERE user_id = 'your-user-id';
```

### Issue: Shows 0/0 generations
**Fix:** Check if pricing_tiers exist and user has correct tier_id:
```sql
SELECT u.email, pt.name, pt.max_generations_per_month 
FROM users u 
JOIN pricing_tiers pt ON u.tier_id = pt.id;
```

---

**Status:** ✅ **FIXED** - Usage indicator should now be visible!

