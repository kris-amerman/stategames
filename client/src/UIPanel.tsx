import React from 'react';
import { MapSize } from './mesh';
import {
  loadOrGetMesh,
  generateTerrain,
  elevationConfig,
  biomeConfig,
  setCurrentMapSize,
  currentCellCount,
  currentCellBiomes,
  currentMapSize,
} from './terrain';
import { SERVER_BASE_URL } from './config';

interface Props {
  ctx: CanvasRenderingContext2D;
}

export default function UIPanel({ ctx }: Props) {
  const handleMapSizeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const size = e.target.value as MapSize;
    setCurrentMapSize(size);
    await loadOrGetMesh(size, ctx);
  };

  const handleRandomSeed = () => {
    elevationConfig.seed = Math.random();
    generateTerrain(ctx);
  };

  const handleSeedInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
      elevationConfig.seed = Math.max(0, Math.min(1, value));
      generateTerrain(ctx);
    }
  };

  const handleRange = (param: keyof typeof elevationConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    (elevationConfig as any)[param] = param === 'octaves' ? Math.floor(value) : value;
    generateTerrain(ctx);
  };

  const handleBiomeRange = (param: keyof typeof biomeConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    (biomeConfig as any)[param] = ['moistureOctaves', 'temperatureOctaves'].includes(param as string)
      ? Math.floor(value)
      : value;
    generateTerrain(ctx);
  };

  const handleUseIslands = (e: React.ChangeEvent<HTMLInputElement>) => {
    elevationConfig.useIslands = e.target.checked;
    generateTerrain(ctx);
  };

  const handleSmoothColors = (e: React.ChangeEvent<HTMLInputElement>) => {
    biomeConfig.smoothColors = e.target.checked;
    generateTerrain(ctx);
  };

  const handleRedistribution = (e: React.ChangeEvent<HTMLSelectElement>) => {
    elevationConfig.redistribution = e.target.value as any;
    generateTerrain(ctx);
  };

  const handleAmpChange = (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    elevationConfig.amplitudes[i] = value;
    generateTerrain(ctx);
  };

  const handleFreqChange = (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    elevationConfig.frequencies[i] = value;
    generateTerrain(ctx);
  };

  const handleCreateGame = async () => {
    try {
      const response = await fetch(`${SERVER_BASE_URL}/api/games/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Cell-Count': currentCellCount.toString(),
          'X-Map-Size': currentMapSize,
        },
        body: currentCellBiomes,
      });
      const gameData = await response.json();
      console.log('Game created', gameData);
    } catch (err) {
      console.error('Game creation failed', err);
    }
  };

  const handleJoinGame = () => {
    const code = prompt('Enter join code');
    if (code) {
      console.log('Join game', code);
    }
  };

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: 10,
    right: 10,
    width: 300,
    background: 'rgba(0, 0, 0, 0.8)',
    color: 'white',
    padding: 15,
    borderRadius: 8,
    fontFamily: 'Arial, sans-serif',
    fontSize: 12,
    maxHeight: '90vh',
    overflowY: 'auto',
    zIndex: 1000,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    marginTop: 5,
    background: '#333',
    color: 'white',
    border: '1px solid #555',
    padding: 4,
  };

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 15px 0', color: '#4CAF50' }}>Biome Terrain Controls</h3>

      <div style={{ marginBottom: 15 }}>
        <label>
          <input type="checkbox" checked={elevationConfig.useIslands} onChange={handleUseIslands} /> Island Mode
        </label>
      </div>

      <div style={{ marginBottom: 15 }}>
        <label>
          <input type="checkbox" checked={biomeConfig.smoothColors} onChange={handleSmoothColors} /> Smooth Colors
        </label>
      </div>

      <div style={{ marginBottom: 15 }}>
        <label>Map Size:</label>
        <select value={currentMapSize} onChange={handleMapSizeChange} style={inputStyle}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
          <option value="xl">XL</option>
        </select>
      </div>

      <div style={{ marginBottom: 15 }}>
        <button onClick={handleRandomSeed} style={{ marginRight: 8 }}>Random Seed</button>
        <input
          type="number"
          step="0.001"
          defaultValue={elevationConfig.seed.toFixed(3)}
          onChange={handleSeedInput}
          style={{ ...inputStyle, width: '40%' }}
        />
      </div>

      <details style={{ marginBottom: 15 }}>
        <summary style={{ cursor: 'pointer', marginBottom: 10 }}>Biome Settings</summary>

        <div style={{ marginBottom: 10 }}>
          <label>Water Level: <span>{biomeConfig.waterLevel.toFixed(2)}</span></label>
          <input
            type="range"
            min="0.2"
            max="0.8"
            step="0.05"
            defaultValue={biomeConfig.waterLevel}
            onChange={handleBiomeRange('waterLevel')}
            style={{ width: '100%', marginTop: 5 }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label>Moisture Frequency: <span>{biomeConfig.moistureFrequency.toFixed(3)}</span></label>
          <input
            type="range"
            min="0.005"
            max="0.05"
            step="0.005"
            defaultValue={biomeConfig.moistureFrequency}
            onChange={handleBiomeRange('moistureFrequency')}
            style={{ width: '100%', marginTop: 5 }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label>Temperature Frequency: <span>{biomeConfig.temperatureFrequency.toFixed(3)}</span></label>
          <input
            type="range"
            min="0.005"
            max="0.05"
            step="0.005"
            defaultValue={biomeConfig.temperatureFrequency}
            onChange={handleBiomeRange('temperatureFrequency')}
            style={{ width: '100%', marginTop: 5 }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label>Moisture Octaves: <span>{biomeConfig.moistureOctaves}</span></label>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            defaultValue={biomeConfig.moistureOctaves}
            onChange={handleBiomeRange('moistureOctaves')}
            style={{ width: '100%', marginTop: 5 }}
          />
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Temperature Octaves: <span>{biomeConfig.temperatureOctaves}</span></label>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            defaultValue={biomeConfig.temperatureOctaves}
            onChange={handleBiomeRange('temperatureOctaves')}
            style={{ width: '100%', marginTop: 5 }}
          />
        </div>
        <hr />
      </details>

      <div style={{ marginBottom: 10 }}>
        <label>Elevation Shift: <span>{elevationConfig.elevationShift.toFixed(2)}</span></label>
        <input
          type="range"
          min="-0.4"
          max="0.4"
          step="0.01"
          defaultValue={elevationConfig.elevationShift}
          onChange={handleRange('elevationShift')}
          style={{ width: '100%', marginTop: 5 }}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label>Octaves: <span>{elevationConfig.octaves}</span></label>
        <input
          type="range"
          min="1"
          max="6"
          step="1"
          defaultValue={elevationConfig.octaves}
          onChange={handleRange('octaves')}
          style={{ width: '100%', marginTop: 5 }}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label>Exponential Power: <span>{elevationConfig.exponentialPower.toFixed(1)}</span></label>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          defaultValue={elevationConfig.exponentialPower}
          onChange={handleRange('exponentialPower')}
          style={{ width: '100%', marginTop: 5 }}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label>Redistribution:</label>
        <select value={elevationConfig.redistribution} onChange={handleRedistribution} style={inputStyle}>
          <option value="none">None</option>
          <option value="exponential">Exponential</option>
        </select>
      </div>

      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <label>Amplitude {i}: <span>{elevationConfig.amplitudes[i].toFixed(2)}</span></label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            defaultValue={elevationConfig.amplitudes[i]}
            onChange={handleAmpChange(i)}
            style={{ width: '100%', marginTop: 5 }}
          />
          <label>Frequency {i}: <span>{elevationConfig.frequencies[i].toFixed(2)}</span></label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            defaultValue={elevationConfig.frequencies[i]}
            onChange={handleFreqChange(i)}
            style={{ width: '100%', marginTop: 5 }}
          />
        </div>
      ))}

      <div style={{ marginTop: 15, paddingTop: 10, borderTop: '1px solid #555', fontSize: 11, color: '#aaa' }}>
        <div id="stats"></div>
        <div id="biomeStats" style={{ marginTop: 10 }}></div>
      </div>

      <div style={{ marginTop: 15, paddingTop: 10, borderTop: '1px solid #555', fontSize: 11, color: '#aaa' }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <button
            id="createGame"
            style={{ flex: 1, background: '#4CAF50', color: 'white', border: 'none', padding: 10, borderRadius: 4, cursor: 'pointer' }}
            onClick={handleCreateGame}
          >
            Create Game
          </button>
          <button
            id="joinGame"
            style={{ flex: 1, background: '#2196F3', color: 'white', border: 'none', padding: 10, borderRadius: 4, cursor: 'pointer' }}
            onClick={handleJoinGame}
          >
            Join Game
          </button>
        </div>
      </div>
    </div>
  );
}
