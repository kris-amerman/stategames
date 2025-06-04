// src/websocket.ts - Bun native WebSocket handler
import type { ServerWebSocket } from "bun";
import { gameRooms, socketToGame } from "./index";

interface WebSocketMessage {
  event: string;
  data: any;
}

export function setupWebSocketHandler(ws: ServerWebSocket<any>, message: string | Buffer) {
  try {
    const messageStr = typeof message === 'string' ? message : message.toString();
    const parsed: WebSocketMessage = JSON.parse(messageStr);
    
    switch (parsed.event) {
      case 'join_game_room':
        handleJoinGameRoom(ws, parsed.data);
        break;
        
      case 'leave_game_room':
        handleLeaveGameRoom(ws, parsed.data);
        break;
        
      default:
        console.log(`Unknown WebSocket event: ${parsed.event}`);
    }
  } catch (error) {
    console.error('Error handling WebSocket message:', error);
  }
}

function handleJoinGameRoom(ws: ServerWebSocket<any>, data: { gameId: string, playerName: string, isCreator: boolean }) {
  const { gameId, playerName, isCreator } = data;
  
  console.log(`${playerName} joining room ${gameId} (creator: ${isCreator})`);
  
  // Add to room
  if (!gameRooms.has(gameId)) {
    gameRooms.set(gameId, new Set());
  }
  gameRooms.get(gameId)!.add(ws);
  
  // Track socket to game mapping
  socketToGame.set(ws, { gameId, playerName });
  
  console.log(`Room ${gameId} now has ${gameRooms.get(gameId)!.size} connected players`);
}

function handleLeaveGameRoom(ws: ServerWebSocket<any>, data: { gameId: string, playerName: string }) {
  const { gameId, playerName } = data;
  
  console.log(`${playerName} leaving room ${gameId}`);
  
  // Remove from room
  const room = gameRooms.get(gameId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      gameRooms.delete(gameId);
    }
  }
  
  socketToGame.delete(ws);
}