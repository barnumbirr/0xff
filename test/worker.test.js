import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import worker from "../src/worker.js";

const SECRET_KEY = "test-secret";
const ORIGIN = "https://0xff.tf";

function makeRequest(method, path = "/", headers = {}) {
  return new Request(ORIGIN + path, { method, headers });
}

function authedRequest(method, path = "/", extraHeaders = {}) {
  return makeRequest(method, path, { Authorization: SECRET_KEY, ...extraHeaders });
}

async function callWorker(request) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function createSlug(slug, url = "https://example.com") {
  const path = slug ? `/${slug}` : "/";
  const method = slug ? "PUT" : "POST";
  const request = authedRequest(method, path, { URL: url });
  return callWorker(request);
}

describe("GET /", () => {
  it("returns HTML landing page for unauthenticated requests", async () => {
    const response = await callWorker(makeRequest("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    const body = await response.text();
    expect(body).toContain("0xff.tf");
  });

  it("returns JSON list for authenticated requests", async () => {
    await createSlug("list-test", "https://example.com/list");

    const response = await callWorker(authedRequest("GET"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    const entry = data.find((k) => k.name === "/list-test");
    expect(entry).toBeDefined();
    expect(entry.long).toBe("https://example.com/list");
    expect(entry.short).toBe("https://0xff.tf/list-test");
  });
});

describe("GET /slug", () => {
  it("redirects to stored URL with 302", async () => {
    await createSlug("redirect-test", "https://example.com/redirect");

    const response = await callWorker(makeRequest("GET", "/redirect-test"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/redirect");
  });

  it("returns 404 for nonexistent slug", async () => {
    const response = await callWorker(makeRequest("GET", "/nonexistent"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.code).toBe("404 Not Found");
  });
});

describe("HEAD requests", () => {
  it("returns HTML headers for HEAD /", async () => {
    const response = await callWorker(makeRequest("HEAD"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
  });

  it("returns 302 with Location for HEAD /slug", async () => {
    await createSlug("head-test", "https://example.com/head");

    const response = await callWorker(makeRequest("HEAD", "/head-test"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/head");
  });
});

describe("POST (create random slug)", () => {
  it("creates a random slug with valid auth and URL", async () => {
    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://example.com/post" })
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.message).toBe("URL created successfully.");
    expect(data.slug).toBeDefined();
    expect(data.short).toContain("https://0xff.tf/");
    expect(data.long).toBe("https://example.com/post");
  });

  it("returns 401 without auth", async () => {
    const response = await callWorker(
      makeRequest("POST", "/", { URL: "https://example.com" })
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 without URL header", async () => {
    const response = await callWorker(authedRequest("POST"));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`URL` header is required.");
  });

  it("returns 400 for invalid URL", async () => {
    const response = await callWorker(
      authedRequest("POST", "/", { URL: "not-a-url" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`URL` needs to be a valid HTTP URL.");
  });
});

describe("PUT (create named slug)", () => {
  it("creates a named slug with valid auth and URL", async () => {
    const response = await createSlug("put-test", "https://example.com/put");
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.message).toBe("URL created successfully.");
    expect(data.slug).toBe("put-test");
    expect(data.short).toBe("https://0xff.tf/put-test");
    expect(data.long).toBe("https://example.com/put");
  });

  it("returns 401 without auth", async () => {
    const response = await callWorker(
      makeRequest("PUT", "/test", { URL: "https://example.com" })
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 without URL header", async () => {
    const response = await callWorker(authedRequest("PUT", "/test-no-url"));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`URL` header is required.");
  });

  it("returns 400 for invalid URL", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/test-invalid", { URL: "ftp://bad" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`URL` needs to be a valid HTTP URL.");
  });

  it("returns 409 for existing slug", async () => {
    await createSlug("conflict-test", "https://example.com/first");
    const response = await createSlug("conflict-test", "https://example.com/second");
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.code).toBe("409 Conflict");
  });

  it("returns 400 when putting to root path", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/", { URL: "https://example.com" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`slug` needs to be set.");
  });
});

describe("PATCH (update URL)", () => {
  it("updates an existing slug's target URL", async () => {
    await createSlug("patch-test", "https://example.com/original");

    const response = await callWorker(
      authedRequest("PATCH", "/patch-test", { URL: "https://example.com/updated" })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("URL updated successfully.");
    expect(data.slug).toBe("patch-test");
    expect(data.long).toBe("https://example.com/updated");

    // Verify redirect points to new URL
    const redirect = await callWorker(makeRequest("GET", "/patch-test"));
    expect(redirect.headers.get("Location")).toBe("https://example.com/updated");
  });

  it("returns 401 without auth", async () => {
    const response = await callWorker(
      makeRequest("PATCH", "/test", { URL: "https://example.com" })
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 for nonexistent slug", async () => {
    const response = await callWorker(
      authedRequest("PATCH", "/no-such-patch", { URL: "https://example.com" })
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 without URL header", async () => {
    await createSlug("patch-no-url", "https://example.com");
    const response = await callWorker(authedRequest("PATCH", "/patch-no-url"));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`URL` header is required.");
  });

  it("returns 400 for invalid URL", async () => {
    await createSlug("patch-bad-url", "https://example.com");
    const response = await callWorker(
      authedRequest("PATCH", "/patch-bad-url", { URL: "not-a-url" })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when patching root path", async () => {
    const response = await callWorker(
      authedRequest("PATCH", "/", { URL: "https://example.com" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`slug` needs to be set.");
  });

  it("supports TTL on update", async () => {
    await createSlug("patch-ttl", "https://example.com");
    const response = await callWorker(
      authedRequest("PATCH", "/patch-ttl", { URL: "https://example.com/new", TTL: "3600" })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ttl).toBe(3600);
  });
});

describe("DELETE", () => {
  it("deletes an existing slug with valid auth", async () => {
    await createSlug("delete-test", "https://example.com/delete");

    const response = await callWorker(authedRequest("DELETE", "/delete-test"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("URL deleted successfully.");
    expect(data.slug).toBe("delete-test");
    expect(data.long).toBe("https://example.com/delete");

    // Verify it's actually gone
    const getResponse = await callWorker(makeRequest("GET", "/delete-test"));
    expect(getResponse.status).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const response = await callWorker(makeRequest("DELETE", "/test"));
    expect(response.status).toBe(401);
  });

  it("returns 404 for nonexistent slug", async () => {
    const response = await callWorker(authedRequest("DELETE", "/does-not-exist"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.code).toBe("404 Not Found");
  });

  it("returns 400 for DELETE on root path", async () => {
    const response = await callWorker(authedRequest("DELETE", "/"));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`slug` needs to be set.");
  });
});

describe("405 Method Not Allowed", () => {
  it("returns 405 for OPTIONS", async () => {
    const response = await callWorker(makeRequest("OPTIONS", "/test"));
    expect(response.status).toBe(405);
    const data = await response.json();
    expect(data.code).toBe("405 Method Not Allowed");
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await callWorker(makeRequest("TRACE", "/test"));
    expect(response.status).toBe(405);
  });
});

describe("Security headers", () => {
  it("returns CSP, X-Content-Type-Options, and X-Frame-Options on HTML", async () => {
    const response = await callWorker(makeRequest("GET"));
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("CSP allows inline scripts and self for analytics", async () => {
    const response = await callWorker(makeRequest("GET"));
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
  });
});

describe("Slug format validation", () => {
  it("rejects slug with dots", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/my.slug", { URL: "https://example.com" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`slug` contains invalid characters.");
  });

  it("rejects percent-encoded slug", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/%2e%2e", { URL: "https://example.com" })
    );
    expect(response.status).toBe(400);
  });

  it("rejects slug with spaces", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/has%20space", { URL: "https://example.com" })
    );
    expect(response.status).toBe(400);
  });

  it("rejects slug with unicode", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/%C3%A9", { URL: "https://example.com" })
    );
    expect(response.status).toBe(400);
  });

  it("rejects slug longer than 64 characters", async () => {
    const longSlug = "/" + "a".repeat(65);
    const response = await callWorker(
      authedRequest("PUT", longSlug, { URL: "https://example.com" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`slug` contains invalid characters.");
  });

  it("accepts slug at exactly 64 characters", async () => {
    const slug = "/" + "a".repeat(64);
    const response = await callWorker(
      authedRequest("PUT", slug, { URL: "https://example.com" })
    );
    expect(response.status).toBe(201);
  });

  it("accepts valid slug with hyphens and underscores", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/valid_slug-123", { URL: "https://example.com" })
    );
    expect(response.status).toBe(201);
  });
});

describe("Self-referential URL protection", () => {
  it("rejects URL pointing to own origin via POST", async () => {
    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://0xff.tf/loop" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("URL must not point to this service.");
  });

  it("rejects URL pointing to own origin via PUT", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/self-ref", { URL: "https://0xff.tf/other" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("URL must not point to this service.");
  });
});

describe("URL length validation", () => {
  it("accepts URL at 2048 characters", async () => {
    const url = "https://example.com/" + "a".repeat(2048 - 20);
    expect(url.length).toBe(2048);
    const response = await callWorker(
      authedRequest("POST", "/", { URL: url })
    );
    expect(response.status).toBe(201);
  });

  it("rejects URL at 2049 characters", async () => {
    const url = "https://example.com/" + "a".repeat(2049 - 20);
    expect(url.length).toBe(2049);
    const response = await callWorker(
      authedRequest("POST", "/", { URL: url })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`URL` needs to be a valid HTTP URL.");
  });
});

describe("Slug collision retry", () => {
  it("retries on collision and eventually succeeds", async () => {
    const slug0_5 = (0.5).toString(36).slice(5);
    await env.kv.put("/" + slug0_5, "https://existing.com");

    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.5) // first attempt -> collision
      .mockReturnValueOnce(0.7); // second attempt -> unique

    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://example.com/retry" })
    );
    expect(response.status).toBe(201);
    vi.restoreAllMocks();
  });

  it("returns 500 after exhausting all retry attempts", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const slug0_5 = (0.5).toString(36).slice(5);
    await env.kv.put("/" + slug0_5, "https://existing.com");

    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://example.com/exhaust" })
    );
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.message).toBe("Failed to generate a unique slug.");
    vi.restoreAllMocks();
  });
});

describe("TTL / expiration support", () => {
  it("creates a URL with valid TTL via POST", async () => {
    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://example.com/ttl", TTL: "86400" })
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.ttl).toBe(86400);
  });

  it("creates a URL with valid TTL via PUT", async () => {
    const response = await callWorker(
      authedRequest("PUT", "/ttl-put", { URL: "https://example.com/ttl", TTL: "3600" })
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.ttl).toBe(3600);
  });

  it("rejects TTL below minimum of 60", async () => {
    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://example.com/ttl", TTL: "59" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`TTL` must be an integer >= 60 seconds.");
  });

  it("rejects non-numeric TTL", async () => {
    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://example.com/ttl", TTL: "abc" })
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("`TTL` must be an integer >= 60 seconds.");
  });

  it("omits ttl from response when no TTL header provided", async () => {
    const response = await callWorker(
      authedRequest("POST", "/", { URL: "https://example.com/no-ttl" })
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.ttl).toBeUndefined();
  });
});

describe("URL preview", () => {
  it("returns JSON preview for existing slug", async () => {
    await createSlug("preview-test", "https://example.com/preview");

    const response = await callWorker(makeRequest("GET", "/preview-test?preview"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.slug).toBe("preview-test");
    expect(data.short).toBe("https://0xff.tf/preview-test");
    expect(data.long).toBe("https://example.com/preview");
  });

  it("returns 404 for nonexistent slug preview", async () => {
    const response = await callWorker(makeRequest("GET", "/no-such-slug?preview"));
    expect(response.status).toBe(404);
  });

  it("still redirects without ?preview param", async () => {
    await createSlug("no-preview", "https://example.com/redirect");

    const response = await callWorker(makeRequest("GET", "/no-preview"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/redirect");
  });
});

describe("QR code generation", () => {
  it("returns SVG QR code for existing slug", async () => {
    await createSlug("qr-test", "https://example.com/qr");

    const response = await callWorker(makeRequest("GET", "/qr-test.qr"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const body = await response.text();
    expect(body).toContain("<svg");
    expect(body).toContain("</svg>");
  });

  it("returns 404 for nonexistent slug QR", async () => {
    const response = await callWorker(makeRequest("GET", "/no-such-slug.qr"));
    expect(response.status).toBe(404);
  });

  it("returns 404 for /.qr (bare suffix)", async () => {
    const response = await callWorker(makeRequest("GET", "/.qr"));
    expect(response.status).toBe(404);
  });

  it("returns QR code even with ?preview param (QR takes precedence)", async () => {
    await createSlug("qr-preview", "https://example.com/qr-preview");

    const response = await callWorker(makeRequest("GET", "/qr-preview.qr?preview"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
  });
});

describe("Custom 404 page", () => {
  it("returns HTML 404 for browser requests", async () => {
    const response = await callWorker(
      makeRequest("GET", "/nonexistent-page", { Accept: "text/html,application/xhtml+xml" })
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/html");
    const body = await response.text();
    expect(body).toContain("This short URL does not exist");
  });

  it("returns JSON 404 for API requests", async () => {
    const response = await callWorker(
      makeRequest("GET", "/nonexistent-api", { Accept: "application/json" })
    );
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.code).toBe("404 Not Found");
  });

  it("returns JSON 404 when no Accept header", async () => {
    const response = await callWorker(makeRequest("GET", "/nonexistent-none"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.code).toBe("404 Not Found");
  });
});

describe("Top-level error handling", () => {
  it("returns 500 on unexpected KV error", async () => {
    const brokenEnv = {
      ...env,
      kv: {
        get: () => { throw new Error("KV is down"); },
        put: () => { throw new Error("KV is down"); },
        delete: () => { throw new Error("KV is down"); },
        list: () => { throw new Error("KV is down"); },
      },
      SECRET_KEY: env.SECRET_KEY,
    };
    const ctx = createExecutionContext();
    const request = authedRequest("POST", "/", { URL: "https://example.com/fail" });
    const response = await worker.fetch(request, brokenEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.message).toBe("Internal server error.");
  });
});
