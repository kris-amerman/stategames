import { CORS_HEADERS, ENDPOINTS } from "..";

/**
 * Root endpoint - list available endpoints
 */
export async function root(): Promise<Response> {
  return new Response(
    JSON.stringify({
      message: "Mesh API Server",
      endpoints: ENDPOINTS,
    }),
    {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
}