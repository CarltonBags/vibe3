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

    const response = await fetch(fullUrl, { 
      headers,
      redirect: 'follow'
    });
    
    if (!response.ok) {
      console.error('Failed to fetch:', fullUrl, 'Status:', response.status);
      const errorText = await response.text();
      console.error('Error response:', errorText.substring(0, 200));
      return NextResponse.json(
        { error: `Failed to fetch: ${response.status}` },
        { status: response.status }
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
        // Rewrite any hardcoded /_next/ paths (including CSS, fonts, etc.)
        .replace(/["'`]\/_next\//g, (match) => match.replace('/_next/', `${proxyPrefix}_next/`))
        .replace(/(['"])\/\/([^'"]+\.daytona\.works)/g, `$1${proxyPrefix}proxy$2`)
        // Rewrite any absolute paths that might be CSS or other assets
        .replace(/(url\s*\(["']?)(\/[^"')]+)(["']?\s*\))/g, `$1${proxyPrefix}$2${tokenSuffix}$3`);
      
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
      
      // Rewrite @import and url() paths (match any absolute path starting with /)
      css = css
        .replace(/@import\s+url\(["']?(\/[^"')]+)["']?\)/g, `@import url("${proxyPrefix}$1${tokenSuffix}")`)
        .replace(/url\(["']?(\/[^"')]+)["']?\)/g, `url("${proxyPrefix}$1${tokenSuffix}")`);
      
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
