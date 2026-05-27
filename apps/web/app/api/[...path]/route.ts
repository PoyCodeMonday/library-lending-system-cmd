import { getExpressApp } from "@library-lending/api";
import serverlessExpress from "@vendia/serverless-express";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

let handler: ReturnType<typeof serverlessExpress> | null = null;

async function getHandler() {
  if (handler) {
    return handler;
  }

  const app = await getExpressApp();
  handler = serverlessExpress({
    app,
    binarySettings: {
      contentTypes: ["application/pdf", "application/octet-stream"]
    }
  });
  return handler;
}

async function toNodeRequest(request: Request): Promise<{
  body: Buffer | null;
  headers: Record<string, string>;
  method: string;
  url: string;
}> {
  const url = new URL(request.url);
  const trimmedPath = url.pathname.replace(/^\/api/, "") || "/";
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body: Buffer | null = null;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = Buffer.from(await request.arrayBuffer());
    headers["content-length"] = String(body.length);
  }

  return {
    body,
    headers,
    method: request.method,
    url: `${trimmedPath}${url.search}`
  };
}

async function forward(request: Request): Promise<Response> {
  const currentHandler = await getHandler();
  const { body, headers, method, url } = await toNodeRequest(request);
  const rawPath = url.split("?")[0] ?? "/";
  const rawQueryString = url.includes("?") ? url.split("?")[1] ?? "" : "";

  const result = (await currentHandler(
    {
      version: "2.0",
      routeKey: "$default",
      rawPath,
      rawQueryString,
      cookies: [],
      headers,
      requestContext: {
        accountId: "anonymous",
        apiId: "local",
        domainName: headers.host ?? "localhost",
        domainPrefix: "local",
        http: {
          method,
          path: rawPath,
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: headers["user-agent"] ?? ""
        },
        requestId: Math.random().toString(36).slice(2),
        routeKey: "$default",
        stage: "$default",
        time: new Date().toISOString(),
        timeEpoch: Date.now()
      },
      body: body ? body.toString("base64") : undefined,
      isBase64Encoded: Boolean(body)
    },
    {}
  )) as {
    body?: string;
    cookies?: string[];
    headers?: Record<string, string>;
    isBase64Encoded?: boolean;
    multiValueHeaders?: Record<string, string[]>;
    statusCode?: number;
  };

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    responseHeaders.set(key, value);
  }
  for (const [key, values] of Object.entries(result.multiValueHeaders ?? {})) {
    values.forEach((value) => responseHeaders.append(key, value));
  }
  result.cookies?.forEach((cookie) => responseHeaders.append("set-cookie", cookie));

  const contentType = responseHeaders.get("content-type")?.toLowerCase() ?? "";
  const binaryResponse = /^(application\/(pdf|octet-stream)|image\/)/.test(contentType);
  const responseBody =
    result.isBase64Encoded || binaryResponse
      ? Buffer.from(result.body ?? "", result.isBase64Encoded ? "base64" : "latin1")
      : result.body;

  return new Response(responseBody, {
    headers: responseHeaders,
    status: result.statusCode ?? 200
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
export const OPTIONS = forward;
