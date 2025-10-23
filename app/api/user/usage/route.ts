import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserWithTier } from '@/lib/db'

export async function GET() {
  try {
    // Get authenticated user
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Get user with tier info
    const userWithTier = await getUserWithTier(userId)
    
    if (!userWithTier) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Get current period usage
    const currentPeriodStart = new Date()
    currentPeriodStart.setDate(1)
    currentPeriodStart.setHours(0, 0, 0, 0)

    const { data: usageData } = await supabase
      .from('user_usage')
      .select('*')
      .eq('user_id', userId)
      .gte('period_start', currentPeriodStart.toISOString())
      .single()

    // Get project count
    const { count: projectCount } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    const generationsUsed = usageData?.generations_count || 0
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

