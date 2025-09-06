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
    currentPlayer: { type: ['string', 'null'] },
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

export const EconomySchema = {
  type: 'object',
  properties: {
    resources: { type: 'object' },
    cantons: { type: 'object' },
    energy: { type: 'object' },
    infrastructure: { type: 'object' },
    projects: { type: 'object' },
    finance: { type: 'object' },
    welfare: { type: 'object' },
    trade: { type: 'object' },
  },
  required: ['resources', 'cantons', 'energy', 'infrastructure', 'projects', 'finance', 'welfare', 'trade'],
  additionalProperties: true,
} as const;

export const BudgetSchema = {
  type: 'object',
  properties: {
    military: { type: 'number' },
    welfare: { type: 'number' },
    sectorOM: { type: 'object' },
  },
  required: ['military', 'welfare', 'sectorOM'],
  additionalProperties: true,
} as const;

export const LaborSchema = {
  type: 'object',
  properties: {
    national: { type: 'number' },
    cantons: { type: 'object' },
  },
  required: ['national', 'cantons'],
  additionalProperties: true,
} as const;

export const LogisticsSchema = {
  type: 'object',
  properties: {
    lp: { type: 'object' },
    operatingAllocations: { type: 'object' },
    domesticAllocations: { type: 'object' },
    internationalAllocations: { type: 'object' },
  },
  required: ['lp', 'operatingAllocations', 'domesticAllocations', 'internationalAllocations'],
  additionalProperties: true,
} as const;

export const EnergySchema = {
  type: 'object',
  properties: {
    plants: { type: 'array' },
    state: { type: 'object' },
    demandBySector: { type: 'object' },
    brownouts: { type: 'array' },
    essentialsFirst: { type: 'boolean' },
    fuelUsed: { type: 'object' },
    oAndMSpent: { type: 'number' },
  },
  required: ['plants', 'state', 'demandBySector', 'brownouts', 'essentialsFirst', 'fuelUsed', 'oAndMSpent'],
  additionalProperties: true,
} as const;

export const SuitabilitySchema = {
  type: 'object',
  properties: {
    cantons: { type: 'object' },
  },
  required: ['cantons'],
  additionalProperties: true,
} as const;

export const DevelopmentSchema = {
  type: 'object',
  properties: {
    cantons: { type: 'object' },
  },
  required: ['cantons'],
  additionalProperties: true,
} as const;

export const InfrastructureSchema = {
  type: 'object',
  properties: {
    infrastructure: { type: 'object' },
    projects: { type: 'object' },
  },
  required: ['infrastructure', 'projects'],
  additionalProperties: true,
} as const;

export const FinanceSchema = {
  type: 'object',
  properties: {
    debt: { type: 'number' },
    creditLimit: { type: 'number' },
    interestRate: { type: 'number' },
    defaulted: { type: 'boolean' },
    debtStress: { type: 'array' },
    summary: { type: 'object' },
  },
  required: ['debt', 'creditLimit', 'interestRate', 'defaulted', 'debtStress', 'summary'],
  additionalProperties: true,
} as const;

export const TradeSchema = {
  type: 'object',
  properties: {
    pendingImports: { type: 'object' },
    pendingExports: { type: 'object' },
  },
  required: ['pendingImports', 'pendingExports'],
  additionalProperties: true,
} as const;

export const WelfareSchema = {
  type: 'object',
  properties: {
    current: { type: 'object' },
    next: { type: 'object' },
  },
  required: ['current', 'next'],
  additionalProperties: true,
} as const;
