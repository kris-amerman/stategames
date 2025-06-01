import { CORS_HEADERS } from "..";

/**
 * Server health check
 */
export async function health(): Promise<Response> {
  return new Response(
    JSON.stringify({
      status: "healthy",
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
}