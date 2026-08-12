import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const hopByHopHeaders = new Set(["connection", "content-length", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const origin = process.env.INTERNAL_API_ORIGIN;
  if (!origin) return Response.json({ error: { code: "API_UNAVAILABLE", message: "API upstream is not configured" } }, { status: 503 });

  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, origin);
  target.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "manual",
    cache: "no-store",
  });
  const responseHeaders = new Headers(response.headers);
  for (const header of hopByHopHeaders) responseHeaders.delete(header);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
