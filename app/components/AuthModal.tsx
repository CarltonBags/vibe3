'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase-browser'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'login' | 'signup'
}

type AuthState = 'idle' | 'loading' | 'success' | 'error' | 'email_confirmation'

export default function AuthModal({ isOpen, onClose, initialMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [authState, setAuthState] = useState<AuthState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const { signIn, signUp, signInWithGoogle } = useAuth()

  // Check if Supabase is configured
  const isSupabaseConfigured = typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC

  // Helper function to categorize errors and provide user-friendly messages
  const categorizeError = (error: any): { type: AuthState; message: string } => {
    const errorMessage = error?.message || error || 'An unexpected error occurred'

    // Email confirmation needed
    if (errorMessage.includes('Email not confirmed') ||
        errorMessage.includes('email_not_confirmed') ||
        errorMessage.includes('confirm your email')) {
      return {
        type: 'email_confirmation',
        message: 'Please check your email and click the confirmation link before signing in.'
      }
    }

    // Invalid credentials
    if (errorMessage.includes('Invalid login credentials') ||
        errorMessage.includes('invalid_credentials') ||
        errorMessage.includes('wrong password')) {
      return {
        type: 'error',
        message: 'Invalid email or password. Please check your credentials and try again.'
      }
    }

    // User already exists (during signup)
    if (errorMessage.includes('User already registered') ||
        errorMessage.includes('already registered') ||
        errorMessage.includes('user_already_exists')) {
      return {
        type: 'error',
        message: 'An account with this email already exists. Try signing in instead.'
      }
    }

    // Password too weak
    if (errorMessage.includes('Password should be') ||
        errorMessage.includes('password_weak')) {
      return {
        type: 'error',
        message: 'Password must be at least 6 characters long.'
      }
    }

    // Network errors
    if (errorMessage.includes('fetch') ||
        errorMessage.includes('network') ||
        errorMessage.includes('Failed to fetch')) {
      return {
        type: 'error',
        message: 'Network error. Please check your connection and try again.'
      }
    }

    // Rate limiting
    if (errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests')) {
      return {
        type: 'error',
        message: 'Too many attempts. Please wait a moment and try again.'
      }
    }

    // Default error
    return {
      type: 'error',
      message: errorMessage
    }
  }

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setAuthState('idle')
      setErrorMessage('')
      setSuccessMessage('')
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthState('loading')
    setErrorMessage('')
    setSuccessMessage('')

    try {
      if (mode === 'signup') {
        if (!fullName.trim()) {
          setAuthState('error')
          setErrorMessage('Please enter your name')
          return
        }

        const result = await signUp(email, password, fullName)

        // Check if user was created and needs email confirmation
        if (result && 'user' in result && result.user) {
          // Create user profile - try multiple approaches
          let profileCreated = false

          // Approach 1: Direct insert (should work with proper RLS)
          try {
            const { supabase } = await import('@/lib/supabase-browser')

            // Get tier ID - try starter first, fallback to free
            const { data: tiers } = await supabase
              .from('pricing_tiers')
              .select('id, name')
              .in('name', ['starter', 'free'])

            let tierId = tiers?.find(t => t.name === 'starter')?.id ||
                        tiers?.find(t => t.name === 'free')?.id

            if (tierId) {
              // Insert user profile
              const { error: insertError } = await supabase
                .from('users')
                .insert({
                  id: result.user.id,
                  email: result.user.email,
                  full_name: fullName.trim(),
                  tier_id: tierId
                })

              if (!insertError) {
                profileCreated = true
                console.log('User profile created successfully')
              } else {
                console.warn('Direct insert failed, trying RPC:', insertError)
              }
            }
          } catch (directError) {
            console.warn('Direct insert failed:', directError)
          }

          // Approach 2: RPC function (if direct insert fails)
          if (!profileCreated) {
            try {
              const { supabase } = await import('@/lib/supabase-browser')
              const { error: rpcError } = await supabase.rpc('create_user_profile', {
                user_id: result.user.id,
                user_email: result.user.email,
                user_name: fullName.trim()
              })

              if (!rpcError) {
                profileCreated = true
                console.log('User profile created via RPC')
              } else {
                console.warn('RPC creation failed:', rpcError)
              }
            } catch (rpcError) {
              console.warn('RPC creation failed:', rpcError)
            }
          }

          // Continue regardless - user was created in auth
          if (!profileCreated) {
            console.warn('All profile creation methods failed, but user exists in auth')
          }

          if (!result.user.email_confirmed_at) {
            // Email confirmation is required
            setAuthState('email_confirmation')
            setSuccessMessage('Account created! Please check your email to confirm your account before signing in.')
          } else {
            // User was auto-confirmed
            setAuthState('success')
            setSuccessMessage('Account created successfully! You are now signed in.')
            setTimeout(() => onClose(), 2000)
          }
        } else {
          // This shouldn't happen, but handle it gracefully
          setAuthState('error')
          setErrorMessage('Account creation failed. Please try again.')
        }
      } else {
        await signIn(email, password)
        setAuthState('success')
        setSuccessMessage('Signed in successfully!')
        setTimeout(() => onClose(), 1500)
      }
    } catch (err: any) {
      console.error('Auth error:', err)
      const { type, message } = categorizeError(err)
      setAuthState(type)
      setErrorMessage(message)
    }
  }

  const handleGoogleSignIn = async () => {
    setAuthState('loading')
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await signInWithGoogle()
      // Redirect will happen automatically - Google handles the flow
      setAuthState('success')
      setSuccessMessage('Redirecting to Google...')
    } catch (err: any) {
      console.error('Google auth error:', err)
      const { type, message } = categorizeError(err)
      setAuthState(type)
      setErrorMessage(message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-zinc-900 rounded-2xl border border-zinc-700 shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {/* Title */}
          <h2 className="text-3xl font-bold mb-2 text-center">
            <span className="text-white">{mode === 'login' ? 'welcome back to the ' : 'join the '}</span>
            <span 
              className="inline-block bg-clip-text text-transparent bg-cover bg-center"
              style={{
                backgroundImage: 'url(/vibe_gradient.png)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text'
              }}
            >
              vibe
            </span>
          </h2>
          <p className="text-gray-400 text-sm text-center mb-6">
            {mode === 'login' ? 'Sign in to continue creating' : 'Create your account to get started'}
          </p>

          {/* Configuration warning */}
          {!isSupabaseConfigured && (
            <div className="mb-4 p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
              <p className="text-yellow-400 text-sm font-medium mb-1">⚠️ Authentication Not Configured</p>
              <p className="text-yellow-300 text-xs">
                Add Supabase credentials to <code className="bg-black/30 px-1 py-0.5 rounded">.env.local</code> to enable auth.
                <br />
                See <code className="bg-black/30 px-1 py-0.5 rounded">ENV_SETUP.md</code> for instructions.
              </p>
            </div>
          )}

          {/* Status Messages */}
          {authState === 'error' && errorMessage && (
            <div className="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-red-400 text-sm font-medium mb-1">Authentication Failed</p>
                  <p className="text-red-300 text-sm">{errorMessage}</p>
                </div>
              </div>
            </div>
          )}

          {authState === 'email_confirmation' && successMessage && (
            <div className="mb-4 p-4 bg-blue-500/20 border border-blue-500/50 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <div className="flex-1">
                  <p className="text-blue-400 text-sm font-medium mb-1">Check Your Email</p>
                  <p className="text-blue-300 text-sm mb-3">{successMessage}</p>
                  <button
                    onClick={async () => {
                      setAuthState('loading')
                      try {
                        // Try to resend the confirmation email
                        const { error } = await supabase.auth.resend({
                          type: 'signup',
                          email: email,
                        })
                        if (error) throw error
                        setAuthState('email_confirmation')
                        setSuccessMessage('Confirmation email sent! Please check your email again.')
                      } catch (err: any) {
                        const { message } = categorizeError(err)
                        setAuthState('error')
                        setErrorMessage(message)
                      }
                    }}
                    disabled={['loading', 'success'].includes(authState)}
                    className="text-xs text-blue-300 hover:text-blue-200 underline disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Didn't receive the email? Click to resend
                  </button>
                </div>
              </div>
            </div>
          )}

          {authState === 'success' && successMessage && (
            <div className="mb-4 p-4 bg-green-500/20 border border-green-500/50 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="text-green-400 text-sm font-medium mb-1">Success!</p>
                  <p className="text-green-300 text-sm">{successMessage}</p>
                </div>
              </div>
            </div>
          )}

          {/* Google Sign In */}
          <button
            onClick={handleGoogleSignIn}
            disabled={authState === 'loading' || authState === 'success' || !isSupabaseConfigured}
            className="w-full mb-4 px-4 py-3 bg-white hover:bg-gray-100 text-black font-medium rounded-lg transition-colors flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {authState === 'loading' ? 'Connecting...' : 'Continue with Google'}
          </button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-700"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-zinc-900 px-2 text-gray-400">Or continue with email</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-gray-300 mb-2">
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                  placeholder="John Doe"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="••••••••"
              />
              {mode === 'signup' && (
                <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters</p>
              )}
            </div>

            <button
              type="submit"
              disabled={authState === 'loading' || authState === 'success' || authState === 'email_confirmation' || !isSupabaseConfigured}
              className="w-full py-3 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundImage: 'url(/vibe_gradient.png)',
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            >
              <span className="text-white drop-shadow-lg">
                {!isSupabaseConfigured ? 'Auth Not Configured' :
                 authState === 'loading' ? 'Processing...' :
                 authState === 'success' ? 'Success!' :
                 mode === 'login' ? 'Sign In' : 'Create Account'}
              </span>
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setAuthState('idle')
                setErrorMessage('')
                setSuccessMessage('')
              }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              {mode === 'login' ? (
                <>
                  Don't have an account? <span className="text-purple-400 font-medium">Sign up</span>
                </>
              ) : (
                <>
                  Already have an account? <span className="text-purple-400 font-medium">Sign in</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

