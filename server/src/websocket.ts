import type { ServerWebSocket } from "bun";
import { gameRooms, socketToGame, nextSeq } from "./index";
import { handleGameAction } from "./game-actions/handler";
import { GameService } from "./game-state";
import { encode } from "./serialization";

interface WebSocketMessage {
  event: string;
  data: any;
}

export function setupWebSocketHandler(ws: ServerWebSocket<any>, message: string | Buffer) {
  try {
    const messageStr = typeof message === 'string' ? message : message.toString();
    const parsed: WebSocketMessage = JSON.parse(messageStr);
    
    switch (parsed.event) {
      case 'add_to_room':
        handleAddToRoom(ws, parsed.data);
        break;
        
      case 'remove_from_room':
        handleRemoveFromRoom(ws, parsed.data);
        break;
        
      case 'game_action':
        handleGameAction(ws, parsed.data);
        break;
        
      default:
        console.log(`Unknown WebSocket event: ${parsed.event}`);
    }
  } catch (error) {
    console.error('Error handling WebSocket message:', error);
  }
}

function handleAddToRoom(ws: ServerWebSocket<any>, data: { gameId: string, playerName: string, isCreator: boolean }) {
  const { gameId, playerName, isCreator } = data;
  
  console.log(`Adding ${playerName} to room for game ${gameId} (creator: ${isCreator})`);
  
  // Add to room
  if (!gameRooms.has(gameId)) {
    gameRooms.set(gameId, new Set());
  }
  gameRooms.get(gameId)!.add(ws);

  // Track socket to game mapping
  socketToGame.set(ws, { gameId, playerName });

  console.log(`Room for game ${gameId} now has ${gameRooms.get(gameId)!.size} connected players`);

  // Send current game state to the newly joined socket so it can sync after reconnects
  // First send the full game data so clients can render the map and nations
  GameService.getGame(gameId).then(game => {
    if (game) {
      try {
        ws.send(encode({ event: 'full_game', data: { game, gameId, seq: nextSeq(gameId) } }));
      } catch (err) {
        console.error('Failed to send full game to joined socket', err);
      }
    }
  });

  // Also send the current game state to align with ongoing updates
  GameService.getGameState(gameId).then(state => {
    if (state) {
      try {
        ws.send(encode({ event: 'game_update', data: { gameId, state } }));
      } catch (err) {
        console.error('Failed to send initial game state', err);
      }
    }
  });
}

function handleRemoveFromRoom(ws: ServerWebSocket<any>, data: { gameId: string, playerName: string }) {
  const { gameId, playerName } = data;
  
  console.log(`Removing ${playerName} from room for game ${gameId}`);
  
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