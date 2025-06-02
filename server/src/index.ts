import { fallback, health, mesh, root } from "./routes";

// TODO move constants to a config
export const PORT = process.env.PORT || 3000;
export const ENDPOINTS = [
  "GET /api/mesh/small",
  "GET /api/mesh/medium",
  "GET /api/mesh/large",
  "GET /api/mesh/xl",
  "GET /health",
];
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Server definition
 */
const server = Bun.serve({
  port: PORT,
  routes: {
    "/": () => root(),
    "/health": () => health(),
    "/api/mesh/:sizeParam": req => mesh(req.params.sizeParam),
  },
  async fetch(req) {
    return fallback(req);
  },
});

console.log(`Server running`);
console.log("\nAvailable endpoints:");
ENDPOINTS.forEach((e) => console.log(`    ${e}`));