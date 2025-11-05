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

    // Check if this is a client-side route (SPA routing)
    // If the path doesn't have an extension or is a known route, it's likely a client-side route
    const hasExtension = path.includes('.');
    const isAssetPath = /\.(js|css|json|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|map)$/i.test(path);
    
    // Try to download the requested file
    let { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    // For SPA routing: if it's not an asset and doesn't exist, fall back to index.html
    if ((error || !data) && !isAssetPath) {
      console.log(`🔄 SPA route detected: ${path}, serving index.html`);
      const indexPath = `${userId}/${projectId}/index.html`;
      const indexResult = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .download(indexPath);
      
      if (indexResult.error || !indexResult.data) {
        console.error(`Error downloading index.html:`, indexResult.error);
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      
      // Use index.html for SPA routing
      data = indexResult.data;
      error = null;
    } else if (error || !data) {
      // Asset file not found and not a route
      console.error(`Error downloading file from ${storagePath}:`, error);
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Convert blob to buffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine content type
    // For SPA routes that fall back to index.html, treat as HTML
    const ext = (!isAssetPath && path !== 'index.html' && !hasExtension) 
      ? 'html' 
      : path.split('.').pop()?.toLowerCase();
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
          const rewritten = `${attr}="${previewBase}${encodeURIComponent(assetPath)}${cacheBustParam}"`;
          return rewritten;
        }
        return match;
      });

      // Inject image proxy wrapper BEFORE any scripts load
      const proxyWrapper = `
<script>
(function() {
  const base = '${previewBase}';
  const cacheBust = '${cacheBustParam}';
  
  // Patch HTMLImageElement.prototype.src to intercept ALL image src assignments
  const imgProto = HTMLImageElement.prototype;
  const originalDesc = Object.getOwnPropertyDescriptor(imgProto, 'src');
  if (originalDesc && originalDesc.set) {
    Object.defineProperty(imgProto, 'src', {
      get: originalDesc.get,
      set: function(value) {
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/api/')) {
          const proxiedUrl = base + encodeURIComponent(value.substring(1)) + cacheBust;
          return originalDesc.set.call(this, proxiedUrl);
        }
        return originalDesc.set.call(this, value);
      },
      configurable: true,
      enumerable: true
    });
  }
})();
</script>
`;
      
      // Inject before the first script tag
      html = html.replace(/(<script[^>]*>)/i, proxyWrapper + '$1');

      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache, no-store, must-revalidate', // Disable caching to ensure fresh builds
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }

    // For JavaScript files, rewrite asset URLs and disable caching
    if (contentType.includes('javascript')) {
      const cacheBustParam = searchParams.get('t') ? `&t=${searchParams.get('t')}` : '';
      const previewBase = `/api/preview/${userId}/${projectId}?path=`;
      
      let js = buffer.toString('utf-8');
      
      // Rewrite import.meta.env.BASE_URL if it exists
      js = js.replace(/import\.meta\.env\.BASE_URL/g, '"/"');
      
      // Intercept HTMLImageElement.prototype.src to proxy all image requests
      const proxyWrapper = `
(function() {
  const base = '${previewBase}';
  const cacheBust = '${cacheBustParam}';
  
  // Patch HTMLImageElement.prototype.src to intercept ALL image src assignments
  const imgProto = HTMLImageElement.prototype;
  const originalDesc = Object.getOwnPropertyDescriptor(imgProto, 'src');
  if (originalDesc && originalDesc.set) {
    Object.defineProperty(imgProto, 'src', {
      get: originalDesc.get,
      set: function(value) {
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/api/')) {
          const proxiedUrl = base + encodeURIComponent(value.substring(1)) + cacheBust;
          return originalDesc.set.call(this, proxiedUrl);
        }
        return originalDesc.set.call(this, value);
      },
      configurable: true,
      enumerable: true
    });
  }
})();
`;
      js = proxyWrapper + js;
      
      return new NextResponse(js, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate', // Disable caching for JS to ensure fresh builds
          'Pragma': 'no-cache',
          'Expires': '0',
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
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject'
  };
  return types[ext || ''] || 'application/octet-stream';
}
