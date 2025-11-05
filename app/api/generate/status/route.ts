import { NextResponse } from 'next/server';
import { getStatus, getAllStatus } from '@/lib/status-tracker';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get('requestId');
  const all = searchParams.get('all') === 'true';
  
  if (!requestId) {
    return NextResponse.json(
      { error: 'requestId is required' },
      { status: 400 }
    );
  }
  
  if (all) {
    // Return all status updates for tracking completed items
    const allStatuses = getAllStatus(requestId);
    return NextResponse.json({ statuses: allStatuses });
  }
  
  const status = getStatus(requestId);
  
  if (!status) {
    return NextResponse.json({
      step: 'unknown',
      message: 'Status not found',
      timestamp: Date.now()
    });
  }
  
  return NextResponse.json(status);
}

