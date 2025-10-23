# Authentication Setup Guide

Your authentication system is now complete! Here's how to set it up.

## ✅ What's Already Done

- ✅ Email/password authentication
- ✅ Google OAuth support (needs configuration)
- ✅ Beautiful auth modal with gradient styling
- ✅ User menu with dropdown
- ✅ Auth checks before generation
- ✅ Limit error handling
- ✅ Auto-redirect to login if not authenticated

## 🚀 Quick Setup (5 minutes)

### Step 1: Enable Email Authentication

1. Go to your Supabase dashboard
2. Navigate to **Authentication** → **Providers**
3. Make sure **Email** is **enabled** ✅
4. (Optional) Customize email templates

**That's it!** Email auth is ready to use.

### Step 2: Enable Google OAuth (Optional)

1. In Supabase, go to **Authentication** → **Providers**
2. Find **Google** and click **Enable**
3. You'll need:
   - **Client ID** from Google Cloud Console
   - **Client Secret** from Google Cloud Console

#### Get Google OAuth Credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure consent screen if prompted
6. Application type: **Web application**
7. Add **Authorized redirect URIs**:
   ```
   Development:
   http://localhost:3000/auth/callback
   
   Production:
   https://yourdomain.com/auth/callback
   ```
8. Copy **Client ID** and **Client Secret**
9. Paste them into Supabase Google provider settings
10. Click **Save**

## 🎨 UI Components

### AuthModal
Located at `app/components/AuthModal.tsx`

Features:
- Toggle between login/signup
- Email/password forms
- Google sign-in button
- Beautiful gradient styling
- Error handling
- Loading states

Usage:
```tsx
<AuthModal 
  isOpen={showModal} 
  onClose={() => setShowModal(false)}
  initialMode="login" // or "signup"
/>
```

### UserMenu
Located at `app/components/UserMenu.tsx`

Features:
- User avatar with initials
- Dropdown menu
- Dashboard link
- Projects link
- Settings link
- Sign out button

Automatically shows when user is logged in!

## 🔄 User Flow

### New User:
1. User clicks "Sign In" button (top right)
2. Modal opens showing login form
3. User clicks "Sign up" toggle
4. Enters name, email, password
5. OR clicks "Continue with Google"
6. Account created automatically
7. Profile created in database (free tier)
8. Usage record initialized
9. Can immediately start generating!

### Returning User:
1. User clicks "Sign In" button
2. Enters email/password
3. OR clicks "Continue with Google"
4. Signed in!
5. Avatar appears in top right
6. Can click avatar to access menu

### When Generating Without Auth:
1. User enters prompt
2. Clicks generate
3. Modal automatically opens: "Please sign in to continue"
4. After login, can try again

### When Hitting Limits:
1. User tries to generate
2. Sees error: "Generation limit exceeded - Upgrade to continue"
3. Shows remaining generations
4. Can click to view pricing/upgrade

## 🧪 Testing Your Auth

### Test Email/Password:
1. Click "Sign In" button
2. Click "Sign up" toggle
3. Enter:
   - Name: Test User
   - Email: test@example.com
   - Password: test123
4. Click "Create Account"
5. Should auto-login and see avatar

### Test Google OAuth (if enabled):
1. Click "Sign In" button
2. Click "Continue with Google"
3. Select Google account
4. Redirects back to site
5. Should be logged in!

### Test Generation Flow:
1. Sign out (click avatar → Sign Out)
2. Try to generate without signing in
3. Should see auth modal
4. Sign in
5. Try generate again - should work!

### Test Limits:
1. Sign in with free tier account
2. Generate 3 times (free tier limit)
3. Try 4th generation
4. Should see limit error with upgrade prompt

## 🎨 Customization

### Change Auth Modal Styling:
Edit `app/components/AuthModal.tsx`

### Change User Menu Items:
Edit `app/components/UserMenu.tsx`

### Change Redirect URLs:
Update the onClick handlers in UserMenu:
```tsx
window.location.href = '/dashboard' // Change to your route
```

## 🔐 Security Notes

### What's Secure:
- ✅ Passwords hashed by Supabase (bcrypt)
- ✅ JWT tokens for sessions
- ✅ Row Level Security on database
- ✅ HTTPS required in production
- ✅ OAuth handled by Supabase

### Best Practices:
- ✅ Never store passwords in plaintext
- ✅ Use HTTPS in production
- ✅ Set up email verification (optional but recommended)
- ✅ Enable 2FA for admin accounts
- ✅ Rotate service role keys regularly

## 📊 Monitoring Auth

### Check Active Users:
```sql
-- In Supabase SQL Editor
SELECT COUNT(*) FROM auth.users 
WHERE last_sign_in_at > NOW() - INTERVAL '7 days';
```

### Check Signups by Provider:
```sql
SELECT 
  raw_app_meta_data->>'provider' as provider,
  COUNT(*) as signups
FROM auth.users
GROUP BY provider;
```

### Check Failed Logins:
Go to **Authentication** → **Logs** in Supabase dashboard

## 🐛 Troubleshooting

### Issue: "Invalid login credentials"
**Fix**: Check email/password are correct. Supabase is case-sensitive for emails.

### Issue: Google button does nothing
**Fix**: 
1. Check Google OAuth is enabled in Supabase
2. Verify redirect URIs are correct
3. Check browser console for errors
4. Make sure you're on localhost:3000 or your production domain

### Issue: "User not found" after signup
**Fix**: 
1. Check if trigger `on_auth_user_created` exists in Supabase
2. Run the migration SQL again if needed
3. Manually create user profile in `users` table

### Issue: Auth modal doesn't open
**Fix**: Check browser console for errors. Make sure `AuthProvider` wraps your app in `layout.tsx`

### Issue: Redirects to wrong URL after Google login
**Fix**: Update redirect URL in Google Cloud Console and Supabase settings

## 🎉 You're All Set!

Your authentication system is production-ready with:
- ✅ Email/password auth
- ✅ Google OAuth (when configured)
- ✅ Beautiful UI
- ✅ Secure by default
- ✅ Integrated with your generation flow

**Next Steps:**
1. Test signup and login
2. Enable Google OAuth (optional)
3. Build dashboard page (`/dashboard`)
4. Build projects page (`/projects`)
5. Add Stripe for paid tiers

---

**Need help?** Check the Supabase docs: https://supabase.com/docs/guides/auth

