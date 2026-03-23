import type { Context } from "../context";

interface RenderReactOptions {
  status?: number;
  headers?: HeadersInit;
  streaming?: boolean;
}

interface ReactDOMServer {
  renderToReadableStream(
    element: unknown,
    options?: { onError?: (error: unknown) => void },
  ): Promise<ReadableStream>;
  renderToString(element: unknown): string;
}

let cachedServer: ReactDOMServer | undefined;

async function getReactDOMServer(): Promise<ReactDOMServer> {
  if (cachedServer) return cachedServer;
  try {
    const mod = "react-dom/server";
    cachedServer = (await import(mod)) as unknown as ReactDOMServer;
    return cachedServer;
  } catch {
    throw new Error(
      "[Rain] renderReact() requires 'react' and 'react-dom'. " +
        "Install them: npm install react react-dom " +
        "and their types: npm install -D @types/react @types/react-dom",
    );
  }
}

export async function renderReact(
  _ctx: Context,
  element: unknown,
  options?: RenderReactOptions,
): Promise<Response> {
  const server = await getReactDOMServer();
  const status = options?.status ?? 200;
  const streaming = options?.streaming ?? true;
  const baseHeaders: Record<string, string> = {
    "content-type": "text/html; charset=UTF-8",
  };

  const mergedHeaders = options?.headers
    ? {
        ...baseHeaders,
        ...Object.fromEntries(new Headers(options.headers).entries()),
      }
    : baseHeaders;

  if (streaming && typeof server.renderToReadableStream === "function") {
    const stream = await server.renderToReadableStream(element, {
      onError(error: unknown) {
        console.error("[Rain] React SSR streaming error:", error);
      },
    });
    return new Response(stream, { status, headers: mergedHeaders });
  }

  const html = server.renderToString(element);
  return new Response(html, { status, headers: mergedHeaders });
}
