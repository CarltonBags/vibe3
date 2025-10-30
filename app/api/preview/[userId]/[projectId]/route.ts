import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const BUCKET_NAME = 'project-builds';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string; projectId: string }> }
) {
  try {
    const { userId, projectId } = await params;
    const { searchParams } = new URL(req.url);
    const path = searchParams.get('path') || 'index.html';
    // Ignore cache-busting parameters like 't'
    // We'll handle this inline in the URL rewriting

    // Construct the storage path
    const storagePath = `${userId}/${projectId}/${path}`;

    // Download the file from Supabase storage
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error || !data) {
      console.error('Error downloading file:', error);
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Convert blob to buffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine content type
    const ext = path.split('.').pop()?.toLowerCase();
    const contentType = getContentType(ext);

    // For HTML files, rewrite asset URLs to use our preview endpoint
    if (contentType === 'text/html') {
      let html = buffer.toString('utf-8');

      // Get cache-busting parameter from original request
      const cacheBustParam = searchParams.get('t') ? `&t=${searchParams.get('t')}` : '';

      // Rewrite asset URLs to use our preview endpoint with path parameter
      const previewBase = `/api/preview/${userId}/${projectId}?path=`;
      html = html.replace(/(href|src)="([^"]+)"/g, (match, attr, url) => {
        if (url.startsWith('./') || url.startsWith('/')) {
          const assetPath = url.startsWith('./') ? url.substring(2) : url.substring(1);
          return `${attr}="${previewBase}${encodeURIComponent(assetPath)}${cacheBustParam}"`;
        }
        return match;
      });

      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'public, max-age=60', // Reduced to 1 minute for amendments
        },
      });
    }

    // For other assets, serve them directly
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': contentType.includes('image') || contentType.includes('font')
          ? 'public, max-age=31536000'
          : 'public, max-age=3600',
      },
    });

  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: 'Failed to serve preview' },
      { status: 500 }
    );
  }
}

function getContentType(ext?: string): string {
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject'
  };
  return types[ext || ''] || 'application/octet-stream';
}
