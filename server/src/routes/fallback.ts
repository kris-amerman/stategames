import { CORS_HEADERS } from "..";

/**
 * Fallback for unmatched routes
 */
export async function fallback(req: Request): Promise<Response> {
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  return new Response("Not Found", {
    status: 404,
    headers: CORS_HEADERS,
  });
}