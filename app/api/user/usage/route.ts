import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserWithTier } from '@/lib/db'

export async function GET(request: Request) {
  try {
    // Create a Supabase client for server-side with cookies
    const cookieStore = await cookies()
    
    // Debug: Check what cookies we have
    const allCookies = cookieStore.getAll()
    console.log('Usage API: Available cookies:', allCookies.map(c => c.name).join(', '))
    const authCookies = allCookies.filter(c => c.name.startsWith('sb-'))
    console.log('Usage API: Auth cookies found:', authCookies.length)
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID 
        ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
        : 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC || 'placeholder-key',
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

    // Get authenticated user from cookies
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    console.log('Usage API: Session check:', session ? 'Authenticated' : 'Not authenticated')
    if (sessionError) {
      console.error('Usage API: Session error:', sessionError)
    }
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    console.log('Usage API: Fetching for user:', userId)

    // Get user with tier info (uses supabaseAdmin internally)
    const userWithTier = await getUserWithTier(userId)
    
    if (!userWithTier) {
      console.error('Usage API: User not found in database')
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    console.log('Usage API: User tier:', userWithTier.tier.name)

    // Get current period usage
    const currentPeriodStart = new Date()
    currentPeriodStart.setDate(1)
    currentPeriodStart.setHours(0, 0, 0, 0)

    const { data: usageData, error: usageError } = await supabaseAdmin
      .from('user_usage')
      .select('*')
      .eq('user_id', userId)
      .gte('period_start', currentPeriodStart.toISOString())
      .single()

    if (usageError) {
      console.error('Usage API: Error fetching user_usage:', usageError)
    }

    // Get project count
    const { count: projectCount, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (projectError) {
      console.error('Usage API: Error fetching project count:', projectError)
    }

    const generationsUsed = usageData?.generations_used || 0
    const tokensUsed = usageData?.tokens_used || 0
    const generationsLimit = userWithTier.tier.max_generations_per_month
    const projectsLimit = userWithTier.tier.max_projects

    return NextResponse.json({
      generationsUsed,
      generationsLimit,
      generationsRemaining: Math.max(0, generationsLimit - generationsUsed),
      tokensUsed,
      projectsCreated: projectCount || 0,
      projectsLimit,
      projectsRemaining: Math.max(0, projectsLimit - (projectCount || 0)),
      tierName: userWithTier.tier.name,
      tierDisplayName: userWithTier.tier.display_name,
      periodStart: usageData?.period_start,
      periodEnd: usageData?.period_end,
    })
  } catch (error) {
    console.error('Error fetching usage:', error)
    return NextResponse.json(
      { error: 'Failed to fetch usage' },
      { status: 500 }
    )
  }
}

