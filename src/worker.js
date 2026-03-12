import html from "./index.html";
import notFoundHtml from "./404.html";
import QRCode from "qrcode-svg";

const ERROR_LABELS = {
  400: '400 Bad Request',
  401: '401 Unauthorized',
  404: '404 Not Found',
  405: '405 Method Not Allowed',
  409: '409 Conflict',
  500: '500 Internal Server Error',
};

function jsonError(status, message) {
  return Response.json(
    { code: ERROR_LABELS[status], message },
    { status }
  );
}

function htmlError(status, accept) {
  if (status === 404 && accept && accept.includes('text/html')) {
    return new Response(notFoundHtml, {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });
  }
  return null;
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) {
    // Compare bufB to itself so we still do constant-time work
    crypto.subtle.timingSafeEqual(bufB, bufB);
    return false;
  }
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}

function authorize(request, env) {
  const secret = request.headers.get('Authorization');
  if (!secret || !timingSafeEqual(secret, env.SECRET_KEY))
    return jsonError(401, 'Unauthorized.');
  return null;
}

const MAX_URL_LENGTH = 2048;
const MAX_SLUG_LENGTH = 64;

function isValidURL(str) {
  if (str.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidSlug(pathname) {
  return pathname.length <= MAX_SLUG_LENGTH + 1 && /^\/[a-zA-Z0-9_-]+$/.test(pathname);
}

function isSelfReferential(targetURL, requestURL) {
  try {
    return new URL(targetURL).origin === new URL(requestURL).origin;
  } catch {
    return false;
  }
}

function parseTTL(request) {
  const header = request.headers.get('TTL');
  if (!header) return null;
  const ttl = Number(header);
  if (!Number.isInteger(ttl) || ttl < 60)
    return jsonError(400, '`TTL` must be an integer >= 60 seconds.');
  return ttl;
}

function validateURL(request, env) {
  const url = request.headers.get('URL');
  if (!url)
    return { error: jsonError(400, '`URL` header is required.') };

  if (!isValidURL(url))
    return { error: jsonError(400, '`URL` needs to be a valid HTTP URL.') };

  if (isSelfReferential(url, request.url))
    return { error: jsonError(400, 'URL must not point to this service.') };

  const ttl = parseTTL(request);
  if (ttl instanceof Response) return { error: ttl };

  return { url, ttl };
}

async function writeSlug(env, slug, url, ttl, origin) {
  const kvOptions = url.length <= 1000 ? { metadata: { url } } : {};
  if (ttl) kvOptions.expirationTtl = ttl;

  await env.kv.put(slug, url, kvOptions);
  const body = {
    message: 'URL created successfully.',
    slug: slug.slice(1),
    short: origin + slug,
    long: url,
  };
  if (ttl) body.ttl = ttl;
  return Response.json(body, { status: 201 });
}

async function handlePOST(request, env) {
  const denied = authorize(request, env);
  if (denied) return denied;

  const validated = validateURL(request, env);
  if (validated.error) return validated.error;

  let slug;
  let attempts = 0;
  do {
    slug = '/' + Math.random().toString(36).slice(5);
    attempts++;
    if (attempts > 10)
      return jsonError(500, 'Failed to generate a unique slug.');
  } while (await env.kv.get(slug) !== null);

  return writeSlug(env, slug, validated.url, validated.ttl, new URL(request.url).origin);
}

async function handlePUT(request, env) {
  const denied = authorize(request, env);
  if (denied) return denied;

  const { origin, pathname: slug } = new URL(request.url);

  if (slug === '/')
    return jsonError(400, '`slug` needs to be set.');

  if (!isValidSlug(slug))
    return jsonError(400, '`slug` contains invalid characters.');

  const validated = validateURL(request, env);
  if (validated.error) return validated.error;

  if (await env.kv.get(slug) !== null)
    return jsonError(409, '`slug` already exists.');

  return writeSlug(env, slug, validated.url, validated.ttl, origin);
}

async function handlePATCH(request, env) {
  const denied = authorize(request, env);
  if (denied) return denied;

  const { origin, pathname: slug } = new URL(request.url);

  if (slug === '/')
    return jsonError(400, '`slug` needs to be set.');

  const existing = await env.kv.get(slug);
  if (!existing)
    return jsonError(404, '`slug` does not exist.');

  const validated = validateURL(request, env);
  if (validated.error) return validated.error;

  const kvOptions = validated.url.length <= 1000 ? { metadata: { url: validated.url } } : {};
  if (validated.ttl) kvOptions.expirationTtl = validated.ttl;

  await env.kv.put(slug, validated.url, kvOptions);
  const body = {
    message: 'URL updated successfully.',
    slug: slug.slice(1),
    short: origin + slug,
    long: validated.url,
  };
  if (validated.ttl) body.ttl = validated.ttl;
  return Response.json(body, { status: 200 });
}

async function handleDELETE(request, env) {
  const denied = authorize(request, env);
  if (denied) return denied;

  const { origin, pathname: slug } = new URL(request.url);

  if (slug === '/')
    return jsonError(400, '`slug` needs to be set.');

  const url = await env.kv.get(slug);
  if (!url)
    return jsonError(404, '`slug` does not exist.');

  await env.kv.delete(slug);
  return Response.json(
    {
      message: 'URL deleted successfully.',
      slug: slug.slice(1),
      short: origin + slug,
      long: url,
    },
    { status: 200 }
  );
}

async function handleRoot(request, env) {
  const { origin } = new URL(request.url);
  const secret = request.headers.get('Authorization');
  if (secret && timingSafeEqual(secret, env.SECRET_KEY)) {
    const keys = [];
    let cursor;
    do {
      const list = await env.kv.list({ cursor });
      const page = await Promise.all(
        list.keys.map(async (key) => {
          const targetUrl = key.metadata?.url ?? await env.kv.get(key.name);
          return {
            name: key.name,
            short: origin + key.name,
            long: targetUrl,
            metadata: key.metadata,
            expiration: key.expiration,
          };
        })
      );
      keys.push(...page);
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    return Response.json(keys, { status: 200 });
  }

  return new Response(html, {
    headers: {
      'content-type': 'text/html',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data:; font-src https://cdn.jsdelivr.net",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
}

function trackEvent(request, ctx, slug) {
  const url = new URL(request.url);
  const headers = { 'content-type': 'application/json' };

  const ua = request.headers.get('User-Agent');
  if (ua) headers['User-Agent'] = ua;

  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers['X-Forwarded-For'] = ip;

  const body = {
    name: 'pageview',
    url: url.origin + slug,
    domain: url.hostname,
  };

  const referrer = request.headers.get('Referer');
  if (referrer) body.referrer = referrer;

  ctx.waitUntil(
    fetch('https://plausible.io/api/event', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }).catch(() => {})
  );
}

async function handleGET(request, env, ctx) {
  const url = new URL(request.url);
  const { origin, pathname } = url;

  // Check for .qr suffix
  const isQR = pathname.endsWith('.qr');
  const slug = isQR ? pathname.slice(0, -3) : pathname;

  if (slug === '/')
    return jsonError(404, '`slug` does not exist.');

  const redirectURL = await env.kv.get(slug);
  if (!redirectURL) {
    return htmlError(404, request.headers.get('Accept'))
      ?? jsonError(404, '`slug` does not exist.');
  }

  if (isQR) {
    const shorturl = origin + slug;
    const qr = new QRCode({ content: shorturl, padding: 4, width: 256, height: 256 });
    return new Response(qr.svg(), {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  if (url.searchParams.has('preview')) {
    return Response.json({
      slug: slug.slice(1),
      short: origin + slug,
      long: redirectURL,
    });
  }

  trackEvent(request, ctx, slug);
  return new Response(null, { status: 302, headers: { Location: redirectURL } });
}

export default {
  async fetch(request, env, ctx) {
    try {
      switch (request.method) {
        case 'DELETE':
          return await handleDELETE(request, env);
        case 'POST':
          return await handlePOST(request, env);
        case 'PUT':
          return await handlePUT(request, env);
        case 'PATCH':
          return await handlePATCH(request, env);
        case 'GET':
        case 'HEAD': {
          const { pathname } = new URL(request.url);
          if (pathname === '/')
            return await handleRoot(request, env);
          return await handleGET(request, env, ctx);
        }
        default:
          return jsonError(405, 'Method not allowed.');
      }
    } catch (err) {
      console.error(err);
      return jsonError(500, 'Internal server error.');
    }
  }
};
