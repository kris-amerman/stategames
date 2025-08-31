import { SERVER_BASE_URL } from './config';

export interface WebSocketHandlers {
  playerJoined?: (data: any) => void;
  gameStateUpdate?: (data: any) => void;
  fullGame?: (data: any) => void;
  gameError?: (data: any) => void;
  actionResult?: (data: any) => void;
  gameUpdate?: (data: any) => void;
}

let socket: WebSocket | null = null;

export function initializeWebSocket(handlers: WebSocketHandlers) {
  if (socket) {
    socket.close();
  }

  const wsUrl = SERVER_BASE_URL
    .replace('http://', 'ws://')
    .replace('https://', 'wss://') + '/ws';

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('Connected to game server');
  };

  socket.onclose = (event) => {
    console.log('Disconnected from game server:', event.code, event.reason);
  };

  socket.onerror = (error) => {
    console.error('WebSocket connection error:', error);
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const { event: eventName, data } = message;
      switch (eventName) {
        case 'player_joined':
          handlers.playerJoined?.(data);
          break;
        case 'game_state_update':
          handlers.gameStateUpdate?.(data);
          break;
        case 'full_game':
          handlers.fullGame?.(data);
          break;
        case 'game_error':
          handlers.gameError?.(data);
          break;
        case 'action_result':
          handlers.actionResult?.(data);
          break;
        case 'game_update':
          handlers.gameUpdate?.(data);
          break;
        default:
          console.log(`Unknown WebSocket event: ${eventName}`);
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  };
}

export function closeWebSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
}

export function sendWebSocketMessage(event: string, data: any) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ event, data }));
  } else {
    console.error('WebSocket not connected');
  }
}

export function sendGameAction(actionType: string, actionData: any) {
  sendWebSocketMessage('game_action', { actionType, ...actionData });
}

export function addToRoom(gameId: string, playerName: string, isCreator: boolean) {
  sendWebSocketMessage('add_to_room', { gameId, playerName, isCreator });
}

export function removeFromRoom(gameId: string | null, playerName: string | null) {
  if (!gameId || !playerName) return;
  sendWebSocketMessage('remove_from_room', { gameId, playerName });
}
