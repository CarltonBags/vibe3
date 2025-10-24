import { Daytona } from '@daytonaio/sdk';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { sandboxId } = await req.json();

    if (!sandboxId) {
      return NextResponse.json(
        { error: 'Sandbox ID required' },
        { status: 400 }
      );
    }

    // Get authenticated user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID 
        ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
        : 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC || 'placeholder-key',
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    );

    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Verify this sandbox belongs to user's project
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id, sandbox_id')
      .eq('user_id', userId)
      .eq('sandbox_id', sandboxId)
      .single();

    if (!project) {
      return NextResponse.json(
        { error: 'Sandbox not found or unauthorized' },
        { status: 404 }
      );
    }

    // Initialize Daytona and remove sandbox
    const daytona = new Daytona({
      apiKey: process.env.DAYTONA_KEY || '',
      apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io',
    });

    try {
      await daytona.remove(sandboxId);
      console.log(`Sandbox ${sandboxId} cleaned up successfully`);
    } catch (err) {
      console.warn(`Sandbox ${sandboxId} might already be deleted:`, err);
      // Continue anyway - sandbox is gone either way
    }

    // Update project to clear sandbox_id (optional, for tracking)
    await supabaseAdmin
      .from('projects')
      .update({ 
        sandbox_id: null,
        sandbox_url: null 
      })
      .eq('id', project.id);

    return NextResponse.json({ 
      success: true,
      message: 'Sandbox cleaned up successfully' 
    });

  } catch (error) {
    console.error('Error cleaning up sandbox:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup sandbox' },
      { status: 500 }
    );
  }
}

