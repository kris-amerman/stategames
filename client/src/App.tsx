import React, { useEffect, useRef, useState } from 'react';
import UIPanel from './UIPanel';
import { WIDTH, HEIGHT } from './config';
import { initializeWebSocket, closeWebSocket } from './network';
import {
  initGame,
  leaveGameRoom,
  handleActionResult,
  handleGameUpdate,
  handleGameError,
} from './game';
import {
  loadOrGetMesh,
  preloadMeshes,
  currentMapSize,
} from './terrain';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;
    setCtx(context);

    initGame(canvas, context);
    preloadMeshes();
    loadOrGetMesh(currentMapSize, context).catch((err) => {
      console.error('Failed to load default mesh', err);
    });

    initializeWebSocket({
      playerJoined: (data) => console.log('player joined', data),
      gameStateUpdate: (data) => console.log('game state update', data),
      fullGame: (data) => console.log('game started', data),
      gameError: handleGameError,
      actionResult: handleActionResult,
      gameUpdate: handleGameUpdate,
    });

    return () => {
      leaveGameRoom();
      closeWebSocket();
    };
  }, []);

  return (
    <>
      <div id="canvas-container">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      </div>
      {ctx && <UIPanel ctx={ctx} />}
    </>
  );
}
