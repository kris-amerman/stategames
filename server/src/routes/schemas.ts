// server/src/routes/schemas.ts
// JSON Schemas for API responses
export const GenericOkSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
  additionalProperties: true,
} as const;

export const GameStateSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    currentPlayer: { type: 'string' },
    turnNumber: { type: 'number' },
    phase: { type: 'string', enum: ['planning', 'execution'] },
  },
  required: ['status', 'currentPlayer', 'turnNumber', 'phase'],
  additionalProperties: true,
} as const;

export const TurnSummarySchema = {
  type: 'object',
  properties: {
    log: { type: 'array', items: { type: 'string' } },
  },
  required: ['log'],
  additionalProperties: true,
} as const;
