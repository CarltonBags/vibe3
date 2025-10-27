import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');
  const token = searchParams.get('token');
  const path = searchParams.get('path') || '';

  if (!targetUrl) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  // Construct the full URL
  const fullUrl = path ? `${targetUrl}${path}` : targetUrl;

  try {
    // Set headers to bypass Daytona warning
    const headers: HeadersInit = {
      'x-daytona-skip-preview-warning': 'true',
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    };

    if (token) {
      headers['x-daytona-preview-token'] = token;
    }

    console.log('Proxying:', fullUrl);

    // Retry logic for transient failures (especially after amendments)
    let response;
    let lastError;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(fullUrl, { 
          headers,
          redirect: 'follow',
          cache: 'no-cache'
        });
        
        // If we got a successful response, break
        if (response.ok) {
          break;
        }
        
        // If it's a 500 and we have retries left, wait and retry
        if (response.status === 500 && attempt < maxRetries) {
          console.log(`Retry attempt ${attempt}/${maxRetries} for 500 error`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        
        // Break if we should not retry
        break;
      } catch (fetchError) {
        lastError = fetchError;
        console.error(`Fetch error (attempt ${attempt}/${maxRetries}):`, fetchError);
        
        // Retry on network errors
        if (attempt < maxRetries) {
          console.log(`Retrying in 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        } else {
          return NextResponse.json(
            { error: 'Failed to connect to sandbox after multiple attempts.' },
            { status: 503 }
          );
        }
      }
    }
    
    if (!response || !response.ok) {
      // Gracefully handle 404s for CSS/JS files during Next.js rebuilds
      if (response?.status === 404 && path && (path.includes('_next') || path.endsWith('.css') || path.endsWith('.js'))) {
        console.log(`Gracefully handling missing Next.js asset: ${path}`);
        return new NextResponse('', {
          status: 200,
          headers: {
            'Content-Type': path.endsWith('.css') ? 'text/css' : 'application/javascript',
            'Cache-Control': 'no-cache',
          },
        });
      }
      
      console.error('Failed to fetch after retries:', fullUrl, 'Status:', response?.status || 'no response');
      let errorText = '';
      if (response) {
        try {
          errorText = await response.text();
          console.error('Error response:', errorText.substring(0, 200));
        } catch (e) {
          // Ignore text parsing errors
        }
      }
      return NextResponse.json(
        { error: `Sandbox unavailable after multiple attempts. Please wait a moment and refresh.` },
        { status: 503 }
      );
    }
    
    const contentType = response.headers.get('content-type') || '';
    console.log('Content-Type:', contentType, 'for', path || 'root');
    
    // For HTML, we need to rewrite URLs to go through the proxy
    if (contentType.includes('text/html')) {
      let html = await response.text();
      const baseUrl = new URL(targetUrl);
      const proxyPrefix = `/api/proxy?url=${encodeURIComponent(baseUrl.origin)}&path=`;
      const tokenSuffix = token ? `&token=${encodeURIComponent(token)}` : '';
      
      // Rewrite ALL URLs to go through our proxy with the bypass header
      html = html
        // Script and link tags with absolute paths (/_next/..., /grid.svg, etc.)
        .replace(/href="(\/[^"]+)"/g, `href="${proxyPrefix}$1${tokenSuffix}"`)
        .replace(/src="(\/[^"]+)"/g, `src="${proxyPrefix}$1${tokenSuffix}"`)
        // data-href for Next.js preloads
        .replace(/data-href="(\/[^"]+)"/g, `data-href="${proxyPrefix}$1${tokenSuffix}"`)
        // Handle srcSet
        .replace(/srcSet="([^"]+)"/g, (match, srcset) => {
          const rewritten = srcset.replace(/(\/_next\/[^\s,]+)/g, (url: string) => 
            `${proxyPrefix}${url}${tokenSuffix}`
          );
          return `srcSet="${rewritten}"`;
        })
        // CRITICAL: Rewrite webpack's public path inside inline scripts
        .replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (match, attrs, content) => {
          // Rewrite __webpack_require__.p assignments
          const rewrittenContent = content
            .replace(/__webpack_require__\.p\s*=\s*"[^"]*"/g, `__webpack_require__.p="${proxyPrefix}"`)
            .replace(/"assetPrefix"\s*:\s*"[^"]*"/g, `"assetPrefix":"${proxyPrefix.slice(0, -6)}"`)
            .replace(/"basePath"\s*:\s*"[^"]*"/g, `"basePath":""`);
          return `<script${attrs}>${rewrittenContent}</script>`;
        });
      
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache',
        },
      });
    }
    
    // For JavaScript, rewrite chunk paths
    if (contentType.includes('javascript') || contentType.includes('application/javascript')) {
      let js = await response.text();
      const baseUrl = new URL(targetUrl);
      const proxyPrefix = `/api/proxy?url=${encodeURIComponent(baseUrl.origin)}&path=/`;
      const tokenSuffix = token ? `&token=${encodeURIComponent(token)}` : '';
      
      // Rewrite webpack chunk URLs - ensure paths start with /
      js = js
        .replace(/__webpack_require__\.p\s*=\s*"[^"]*"/g, `__webpack_require__.p="${proxyPrefix}"`)
        .replace(/"assetPrefix":"[^"]*"/g, `"assetPrefix":"${proxyPrefix.replace('&path=/', '')}"`)
        // Rewrite any hardcoded /_next/ paths
        .replace(/"\/_next\//g, `"${proxyPrefix}_next/`)
        .replace(/(['"])_next\//g, `$1${proxyPrefix}_next/`);
      
      return new NextResponse(js, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    
    // For CSS, rewrite any @import or url() paths
    if (contentType.includes('text/css') || contentType.includes('css')) {
      let css = await response.text();
      const baseUrl = new URL(targetUrl);
      const proxyPrefix = `/api/proxy?url=${encodeURIComponent(baseUrl.origin)}&path=`;
      const tokenSuffix = token ? `&token=${encodeURIComponent(token)}` : '';
      
      // Rewrite @import and url() paths
      css = css
        .replace(/@import\s+url\(["']?(\/_next\/[^"')]+)["']?\)/g, `@import url("${proxyPrefix}$1${tokenSuffix}")`)
        .replace(/url\(["']?(\/_next\/[^"')]+)["']?\)/g, `url("${proxyPrefix}$1${tokenSuffix}")`);
      
      return new NextResponse(css, {
        status: 200,
        headers: {
          'Content-Type': 'text/css',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    
    // For all other content (images, fonts, etc.), pass through
    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': contentType.includes('image/') || contentType.includes('font/') 
          ? 'public, max-age=31536000' 
          : 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to proxy request', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
