import { createUI, hideTerrainControls } from './ui';
import {
  loadOrGetMesh,
  preloadMeshes,
  currentMapSize,
  currentCellBiomes,
  currentCellCount,
  showError,
} from './terrain';
import { WIDTH, HEIGHT, SERVER_BASE_URL } from './config';
import { initializeWebSocket, closeWebSocket } from './network';
import { showGameNotification } from './notifications';
import {
  initGame,
  joinGameRoom,
  leaveGameRoom,
  processGameData,
  handleActionResult,
  handleGameUpdate,
  handleGameError,
  currentGameId,
  currentPlayerName,
  requiredPlayers,
  isMyTurn,
} from './game';
import { initializePlannerUI, setPlannerVisibility } from './planner';

const canvas = document.createElement('canvas');
const container = document.getElementById('canvas-container')!;
container.appendChild(canvas);
canvas.width = WIDTH;
canvas.height = HEIGHT;

const ctx = canvas.getContext('2d')!;

// Initialize the application
async function initializeApp() {
  console.log('Initializing app...');

  // Create UI first
  createUI(ctx);
  const controlsContainer = document.getElementById('gameControls');
  if (controlsContainer) {
    initializePlannerUI(controlsContainer, () => ({
      gameId: currentGameId,
      playerId: currentPlayerName,
      isMyTurn,
    }));
  }

  // Initialize gameplay handlers
  initGame(canvas, ctx);

  // Start preloading all meshes in background (non-blocking)
  preloadMeshes();

  // Load the default mesh (xl)
  await loadOrGetMesh(currentMapSize, ctx);

  console.log('✅ Application initialized');
}

// Utility function to manage game button states
function setGameButtonsState(enabled: boolean, createText: string = "Create Game", joinText: string = "Join Game") {
  const createButton = document.getElementById("createGame") as HTMLButtonElement;
  const joinButton = document.getElementById("joinGame") as HTMLButtonElement;
  
  createButton.disabled = !enabled;
  createButton.textContent = createText;
  joinButton.disabled = !enabled;
  joinButton.textContent = joinText;
}

// Utility function to hide/show game buttons
function toggleGameButtons(visible: boolean) {
  const createButton = document.getElementById("createGame") as HTMLButtonElement;
  const joinButton = document.getElementById("joinGame") as HTMLButtonElement;
  
  createButton.style.display = visible ? "block" : "none";
  joinButton.style.display = visible ? "block" : "none";
}

// Creator's game state UI (world generated immediately)
function showCreatorGameUI(gameData: any) {
  hideAllGameUI();
  hideTerrainControls();

  const gameStateDiv = createGameStateContainer();
  
  gameStateDiv.innerHTML = `
    <h4 style="margin: 0 0 10px 0; color: #4CAF50;">Game Created!</h4>
    
    <div style="margin-bottom: 10px;">
      <strong>Join Code:</strong> 
      <span style="
        font-family: monospace; 
        font-size: 16px; 
        background: rgba(255,255,255,0.1); 
        padding: 4px 8px; 
        border-radius: 4px;
        letter-spacing: 2px;
      ">${gameData.joinCode}</span>
      <button id="copyJoinCode" style="
        margin-left: 8px;
        background: #666; 
        color: white; 
        border: none; 
        padding: 4px 8px; 
        border-radius: 4px; 
        cursor: pointer;
        font-size: 11px;
      ">Copy</button>
    </div>
    
    <div style="margin-bottom: 10px;">
      <strong>Game ID:</strong> 
      <span style="font-family: monospace; font-size: 12px; color: #aaa;">${gameData.gameId}</span>
    </div>
    
    <div style="margin-bottom: 15px;">
      <strong>Status:</strong>
      <span id="gameStatus" style="color: #FFA500;">Waiting for players...</span>
    </div>

    <div style="margin-bottom: 15px;">
      <strong>Players:</strong>
      <ul id="playersList" style="
        margin: 5px 0 0 0;
        padding-left: 20px;
        color: #ccc;
      ">
        ${gameData.players
          .map((p: string, i: number) => `<li>${p}${i === 0 ? ' (you)' : ''}</li>`)
          .join('')}
      </ul>
    </div>

    <button id="startGame" style="
      width: 100%;
      background: #666;
      color: white;
      border: none;
      padding: 10px;
      border-radius: 4px;
      cursor: pointer;
      margin-top: 5px;
    " disabled>Start Game (Need more players)</button>
  `;

  // Add event listeners
  setupCopyJoinCodeButton(gameData.joinCode);

  // Add WebSocket to room as creator
  joinGameRoom(gameData.gameId, 'player1', true);

  // Setup start game button handler
  setupStartGameButton();

  toggleGameButtons(false);
}

// Joiner's game state UI (no Start Game button)
function showJoinerGameUI(gameData: any) {
  hideAllGameUI();
  hideTerrainControls();

  const gameStateDiv = createGameStateContainer();
  
  gameStateDiv.innerHTML = `
    <h4 style="margin: 0 0 10px 0; color: #4CAF50;">Joined Game!</h4>
    
    <div style="margin-bottom: 10px;">
      <strong>Game ID:</strong> 
      <span style="font-family: monospace; font-size: 12px; color: #aaa;">${gameData.gameId}</span>
    </div>
    
    <div style="margin-bottom: 10px;">
      <strong>Your Player:</strong> 
      <span style="color: #4CAF50;">${gameData.playerName}</span>
    </div>
    
    <div style="margin-bottom: 15px;">
      <strong>Status:</strong> 
      <span id="gameStatus" style="color: #FFA500;">Waiting for game to start...</span>
    </div>
    
    <div style="margin-bottom: 15px;">
      <strong>Players:</strong>
      <ul id="playersList" style="
        margin: 5px 0 0 0; 
        padding-left: 20px; 
        color: #ccc;
      ">
        ${gameData.players.map((player: string) => 
          `<li>${player}${player === gameData.playerName ? ' (you)' : ''}</li>`
        ).join('')}
      </ul>
    </div>
    
    <div style="
      padding: 10px;
      background: rgba(255, 193, 7, 0.2);
      border: 1px solid #FFC107;
      border-radius: 4px;
      text-align: center;
      color: #FFC107;
      font-size: 14px;
    "
    id="waitingForStart">
      Waiting for the host to start the game...
    </div>
  `;
  
  // Connect WebSocket to room as joiner
  joinGameRoom(gameData.gameId, gameData.playerName, false);
  
  toggleGameButtons(false);
}

function showJoinGameForm() {
  hideAllGameUI();
  toggleGameButtons(false);
  
  let joinFormDiv = document.getElementById("joinGameForm");
  
  if (!joinFormDiv) {
    joinFormDiv = document.createElement("div");
    joinFormDiv.id = "joinGameForm";
    joinFormDiv.style.cssText = `
      margin-top: 15px;
      padding: 15px;
      background: rgba(0, 0, 100, 0.2);
      border: 1px solid #2196F3;
      border-radius: 8px;
    `;
    
    // Insert after the buttons
    const buttonsDiv = document.querySelector('#createGame')!.parentElement;
    buttonsDiv!.parentNode!.insertBefore(joinFormDiv, buttonsDiv!.nextSibling);
  }
  
  joinFormDiv.style.display = "block";
  joinFormDiv.innerHTML = `
    <h4 style="margin: 0 0 15px 0; color: #2196F3;">Join Game</h4>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px;">Enter Join Code:</label>
      <input type="text" id="joinCodeInput" placeholder="ABC123" style="
        width: 100%;
        padding: 10px;
        background: #333;
        color: white;
        border: 1px solid #555;
        border-radius: 4px;
        font-family: monospace;
        font-size: 16px;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-align: center;
        box-sizing: border-box;
      " maxlength="6">
    </div>
    
    <div style="display: flex; gap: 10px;">
      <button id="submitJoinCode" style="
        flex: 1;
        background: #2196F3;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 4px;
        cursor: pointer;
      ">Join</button>
      
      <button id="cancelJoinForm" style="
        flex: 1;
        background: #666;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 4px;
        cursor: pointer;
      ">Cancel</button>
    </div>
    
    <div id="joinError" style="
      margin-top: 10px;
      color: #f44336;
      font-size: 12px;
      display: none;
    "></div>
  `;
  
  // Auto-format join code input
  const joinCodeInput = document.getElementById("joinCodeInput") as HTMLInputElement;
  joinCodeInput.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  
  // Handle Enter key
  joinCodeInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleJoinGameSubmit();
    }
  });
  
  // Focus the input
  setTimeout(() => joinCodeInput.focus(), 100);
  
  // Add event listeners
  document.getElementById("submitJoinCode")!.addEventListener("click", handleJoinGameSubmit);
  document.getElementById("cancelJoinForm")!.addEventListener("click", cancelJoinForm);
}

function cancelJoinForm() {
  hideAllGameUI();
  setGameButtonsState(true);
  toggleGameButtons(true);
}

async function handleJoinGameSubmit() {
  const joinCodeInput = document.getElementById("joinCodeInput") as HTMLInputElement;
  const submitButton = document.getElementById("submitJoinCode") as HTMLButtonElement;
  const errorDiv = document.getElementById("joinError")!;
  
  const joinCode = joinCodeInput.value.trim();
  
  if (!joinCode || joinCode.length < 3) {
    showJoinError("Please enter a valid join code");
    return;
  }
  
  // Disable button during request
  submitButton.disabled = true;
  submitButton.textContent = "Joining...";
  errorDiv.style.display = "none";
  
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/games/${joinCode}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const gameData = await response.json();
    console.log('Successfully joined game:', gameData);
    
    // Add playerName to gameData for consistency
    gameData.playerName = `player${gameData.players.length}`;
    
    showJoinerGameUI(gameData);
    
  } catch (error: any) {
    console.error('Failed to join game:', error);
    showJoinError(error.message || 'Failed to join game');
    
    // Re-enable button
    submitButton.disabled = false;
    submitButton.textContent = "Join";
  }
}

// Utility functions
function hideAllGameUI() {
  const gameStateDiv = document.getElementById("gameState");
  const joinFormDiv = document.getElementById("joinGameForm");
  
  if (gameStateDiv) gameStateDiv.style.display = "none";
  if (joinFormDiv) joinFormDiv.style.display = "none";
}

function createGameStateContainer() {
  const gameStateDiv = document.getElementById("gameState")!;
  gameStateDiv.style.cssText = `
      margin-top: 15px;
      padding: 15px;
      background: rgba(0, 100, 0, 0.2);
      border: 1px solid #4CAF50;
      border-radius: 8px;
    `;
  gameStateDiv.style.display = "block";
  return gameStateDiv;
}

function setupCopyJoinCodeButton(joinCode: string) {
  document.getElementById("copyJoinCode")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(joinCode);
      const button = document.getElementById("copyJoinCode") as HTMLButtonElement;
      const originalText = button.textContent;
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy join code:', err);
    }
  });
}

function setupStartGameButton() {
  document.getElementById("startGame")!.addEventListener("click", async () => {
    if (!currentGameId) {
      console.error('No current game ID');
      return;
    }

    const startButton = document.getElementById("startGame") as HTMLButtonElement;
    startButton.disabled = true;
    startButton.textContent = "Starting...";

    try {
      const response = await fetch(`${SERVER_BASE_URL}/api/games/${currentGameId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const gameData = await response.json();
      console.log('Game started successfully:', gameData);
      
      // The WebSocket will handle the UI update via 'full_game' event
      
    } catch (error: any) {
      console.error('Failed to start game:', error);
      showGameNotification(error.message || 'Failed to start game', 'error');
      
      // Re-enable button on error
      startButton.disabled = false;
      startButton.textContent = "Start Game";
    }
  });
}

function showJoinError(message: string) {
  const errorDiv = document.getElementById("joinError")!;
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

function updatePlayersList(players: string[], currentPlayerName?: string) {
  const playersList = document.getElementById("playersList");
  if (playersList) {
    playersList.innerHTML = players.map((player) => 
      `<li>${player}${player === currentPlayerName || (currentPlayerName === undefined && player === 'player1') ? ' (you)' : ''}</li>`
    ).join('');
    
    // Only update start game button if it exists (creator only)
    const startButton = document.getElementById("startGame") as HTMLButtonElement;
    if (startButton) {
      if (players.length >= requiredPlayers) {
        startButton.disabled = false;
        startButton.textContent = "Start Game";
        startButton.style.background = "#4CAF50";
      } else {
        startButton.disabled = true;
        startButton.textContent = "Start Game (Need more players)";
        startButton.style.background = "#666";
      }
    }
  }
}

// Initialize WebSocket connection
// Handle player joining
function handlePlayerJoined(data: { gameId: string, players: string[], newPlayer: string }) {
  console.log('Player joined:', data);
  
  if (data.gameId === currentGameId) {
    // Update the player list in real-time
    updatePlayersList(data.players, currentPlayerName || undefined);
    
    // Show notification for new player
    showGameNotification(`${data.newPlayer} joined the game!`, 'success');
  }
}

// Handle game state updates
function handleGameStateUpdate(data: { gameId: string, status: string, players: string[] }) {
  console.log('Game state update:', data);

  if (data.gameId === currentGameId) {
    updateGameStatus(data.status);
    updatePlayersList(data.players, currentPlayerName || undefined);
  }
}

// Handle receipt of full game data from the server
export function handleFullGame(gameData: any) {
  console.log('Full game data received:', gameData);

  const fullGame = gameData.game ?? gameData;

  if (fullGame.meta?.gameId === currentGameId) {
    updateGameStatus(fullGame.state.status);

    if (fullGame.state.status === 'in_progress') {
      showGameNotification('Game has started!', 'success');

      const startButton = document.getElementById("startGame") as HTMLButtonElement;
      if (startButton) startButton.remove();

      const waitingForStartDiv = document.getElementById("waitingForStart");
      if (waitingForStartDiv) waitingForStartDiv.style.display = "none";
    }

    // Ensure player list reflects current players
    updatePlayersList(fullGame.meta.players, currentPlayerName || undefined);

    // Process all the game data received in the WebSocket event
    processGameData(fullGame);
  }
}

// Update game status display
function updateGameStatus(status: string) {
  const statusElement = document.getElementById('gameStatus');
  if (!statusElement) return;

  switch (status) {
    case 'waiting':
      statusElement.textContent = 'Waiting for players...';
      statusElement.style.color = '#FFA500';
      break;
    case 'in_progress':
      statusElement.textContent = 'Game in progress';
      statusElement.style.color = '#4CAF50';
      break;
    case 'finished':
      statusElement.textContent = 'Game finished';
      statusElement.style.color = '#666';
      break;
    default:
      statusElement.textContent = status;
      statusElement.style.color = '#FFA500';
  }

  setPlannerVisibility(status === 'in_progress');
}

// Start the application
if (!(import.meta as any).vitest) {
  initializeApp().catch(error => {
    console.error('Failed to initialize application:', error);
    showError('Failed to initialize application. Please check console.');
  });
}

document.getElementById("createGame")!.addEventListener("click", async () => {
  console.log(`SENDING ${currentCellCount} BIOMES TO ${SERVER_BASE_URL}/api/games/create`);
  console.time('createGame');
  
  // Disable buttons during creation
  setGameButtonsState(false, "Creating...", "Join Game");
  
  try {
    const nationCountInput = document.getElementById('nationCount') as HTMLInputElement;
    const nationCount = parseInt(nationCountInput.value) || 1;

    const response = await fetch(`${SERVER_BASE_URL}/api/games/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Cell-Count': currentCellCount.toString(),
        'X-Map-Size': currentMapSize,
        'X-Nation-Count': nationCount.toString(),
      },
      body: currentCellBiomes
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to create game: ${response.status}`);
    }
    
    const gameData = await response.json();
    console.log('Game created:', gameData);

    // Show creator's game state UI and render map
    showCreatorGameUI(gameData);
    processGameData(gameData.game);
    updateGameStatus('waiting');
    updatePlayersList(gameData.players, 'player1');
    
  } catch (error: any) {
    console.error('Game creation failed:', error);
    showGameNotification(error.message || 'Game creation failed', 'error');
    // Reset buttons on error
    setGameButtonsState(true, "Create Game", "Join Game");
  }
  console.timeEnd('createGame');
});

document.getElementById("joinGame")!.addEventListener("click", () => {
  showJoinGameForm();
});

// Initialize WebSocket when the page loads
document.addEventListener('DOMContentLoaded', () => {
  initializeWebSocket({
    playerJoined: handlePlayerJoined,
    gameStateUpdate: handleGameStateUpdate,
    fullGame: handleFullGame,
    gameError: handleGameError,
    actionResult: handleActionResult,
    gameUpdate: handleGameUpdate,
  });
});

// Clean up WebSocket connection when leaving
window.addEventListener('beforeunload', () => {
  leaveGameRoom();
  closeWebSocket();
});