import { meshService } from './mesh-service';
import type { MapSize } from './mesh/types';

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Add CORS headers for easier testing
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Root endpoint - show available routes
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        message: 'Mesh API Server',
        endpoints: [
          'GET /api/mesh/small',
          'GET /api/mesh/medium', 
          'GET /api/mesh/large',
          'GET /api/mesh/xl',
          'GET /health',
          'GET /api/mesh/info'
        ]
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Mesh info endpoint - shows available sizes and stats
    if (url.pathname === '/api/mesh/info') {
      const sizes: MapSize[] = ['small', 'medium', 'large', 'xl'];
      const info = await Promise.all(
        sizes.map(async (size) => {
          try {
            const meshData = await meshService.getMeshData(size);
            return {
              size,
              cellCount: meshData.cellOffsets.length - 1,
              vertexCount: meshData.allVertices.length / 2,
              available: true
            };
          } catch (error: any) {
            return {
              size,
              available: false,
              error: error.message
            };
          }
        })
      );

      return new Response(JSON.stringify({ meshes: info }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Individual mesh endpoints
    if (url.pathname.startsWith('/api/mesh/')) {
      const sizeParam = url.pathname.split('/').pop();
      const validSizes: MapSize[] = ['small', 'medium', 'large', 'xl'];
      
      if (!sizeParam || !validSizes.includes(sizeParam as MapSize)) {
        return new Response(JSON.stringify({ 
          error: 'Invalid map size',
          validSizes,
          received: sizeParam
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const size = sizeParam as MapSize;

      try {
        console.log(`📡 Serving ${size} mesh data...`);
        const startTime = Date.now();
        
        const meshData = await meshService.getSerializedMeshData(size);
        
        const duration = Date.now() - startTime;
        console.log(`✅ Served ${size} mesh in ${duration}ms`);
        
        return new Response(JSON.stringify({
          size,
          meshData,
          meta: {
            cellCount: meshData.cellOffsets.length - 1,
            vertexCount: meshData.allVertices.length / 2,
            generatedAt: new Date().toISOString(),
            responseTimeMs: duration
          }
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (error: any) {
        console.error(`❌ Failed to serve ${size} mesh:`, error);
        return new Response(JSON.stringify({ 
          error: 'Failed to generate mesh data',
          details: error.message
        }), { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'healthy', 
        timestamp: new Date().toISOString() 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders
    });
  },
});

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log('\n📋 Available endpoints:');
console.log('  GET  http://localhost:3000/');
console.log('  GET  http://localhost:3000/health');
console.log('  GET  http://localhost:3000/api/mesh/info');
console.log('  GET  http://localhost:3000/api/mesh/small');
console.log('  GET  http://localhost:3000/api/mesh/medium');
console.log('  GET  http://localhost:3000/api/mesh/large');
console.log('  GET  http://localhost:3000/api/mesh/xl');

// Optional: Preload one mesh for faster first request
meshService.getMeshData('small').then(() => {
  console.log('✅ Preloaded small mesh for faster testing');
}).catch(console.error);