// src/websocket.ts - WebSocket event handlers updated for Bun server
import { Server as SocketIOServer } from 'socket.io';

// In-memory store for active game rooms (replace with Redis later)
const gameRooms = new Map<string, Set<string>>(); // gameId -> Set of socketIds
const socketToGame = new Map<string, { gameId: string, playerName: string }>(); // socketId -> game info

export function setupWebSocket(server: any): SocketIOServer {
  // For Bun, we attach Socket.IO to the existing HTTP server
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*", // Match your CORS_HEADERS
      methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    path: '/socket.io/'
  });

  io.on('connection', (socket) => {
    console.log(`WebSocket client connected: ${socket.id}`);

    // Handle joining a game room
    socket.on('join_game_room', (data: { gameId: string, playerName: string, isCreator: boolean }) => {
      const { gameId, playerName, isCreator } = data;
      
      console.log(`${playerName} joining room ${gameId} (creator: ${isCreator})`);
      
      // Join the socket.io room
      socket.join(gameId);
      
      // Track the room membership
      if (!gameRooms.has(gameId)) {
        gameRooms.set(gameId, new Set());
      }
      gameRooms.get(gameId)!.add(socket.id);
      
      // Track socket to game mapping
      socketToGame.set(socket.id, { gameId, playerName });
      
      console.log(`Room ${gameId} now has ${gameRooms.get(gameId)!.size} connected players`);
    });

    // Handle leaving a game room
    socket.on('leave_game_room', (data: { gameId: string, playerName: string }) => {
      const { gameId, playerName } = data;
      
      console.log(`${playerName} leaving room ${gameId}`);
      
      // Leave the socket.io room
      socket.leave(gameId);
      
      // Remove from tracking
      if (gameRooms.has(gameId)) {
        gameRooms.get(gameId)!.delete(socket.id);
        if (gameRooms.get(gameId)!.size === 0) {
          gameRooms.delete(gameId);
        }
      }
      socketToGame.delete(socket.id);
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`WebSocket client disconnected: ${socket.id} (${reason})`);
      
      // Clean up tracking
      const socketInfo = socketToGame.get(socket.id);
      if (socketInfo) {
        const { gameId } = socketInfo;
        if (gameRooms.has(gameId)) {
          gameRooms.get(gameId)!.delete(socket.id);
          if (gameRooms.get(gameId)!.size === 0) {
            gameRooms.delete(gameId);
          }
        }
        socketToGame.delete(socket.id);
      }
    });
  });

  return io;
}

// Helper function to broadcast player join events
export function broadcastPlayerJoined(io: SocketIOServer, gameId: string, players: string[], newPlayer: string) {
  console.log(`Broadcasting player_joined for ${newPlayer} in game ${gameId}`);
  io.to(gameId).emit('player_joined', {
    gameId,
    players,
    newPlayer
  });
}

// Helper function to broadcast game state updates
export function broadcastGameStateUpdate(io: SocketIOServer, gameId: string, status: string, players: string[]) {
  console.log(`Broadcasting game_state_update for game ${gameId}: ${status}`);
  io.to(gameId).emit('game_state_update', {
    gameId,
    status,
    players
  });
}

// Helper function to broadcast errors
export function broadcastGameError(io: SocketIOServer, gameId: string, error: string) {
  console.log(`Broadcasting game_error for game ${gameId}: ${error}`);
  io.to(gameId).emit('game_error', {
    gameId,
    error
  });
}