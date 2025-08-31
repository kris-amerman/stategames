# Test Suite

This repository includes scaffolded tests for the core systems of the game server.

## Running Tests

From the `server` directory:

```bash
cd server
bun test
```

### Coverage

Generate a coverage report:

```bash
cd server
bun run test:coverage
```

This prints coverage statistics and writes an `lcov.info` report to the `coverage/` directory.

## Pass Criteria Covered

### Core Framework & Turn Flow
- One-turn lag where actions planned in Turn *N* execute in Turn *N+1*.
- Turn sequence: Carryover → Planning → Execution → Cleanup.
- Five Gates invoked in order: Budget → Inputs → Logistics → Labor → Suitability.
- Planning writes to a next-turn buffer and execution uses the previous plan.
- Cleanup produces a turn summary artifact.

### Economy System
- Distinct resource types are defined.
- Registered sectors: Agriculture, Extraction, Manufacturing, Defense Industry, Luxury, Finance, Research, Logistics, Energy.
- Slot capacity and utilisation tracked per canton and sector.
- Logistics Points treated as non-stockpiled.

### Budget System
- Budget pools: Military, Welfare, Sector Operations & Maintenance.
- Allocation when under-funded prioritises suitability then largest remainder with deterministic tie-breaking.
- Idle slots incur 25% Operations & Maintenance.
- Retools cost 8 Gold/slot and require 2 turns of downtime.
- Budget stage exposes hooks for Inputs, Labor and Modifiers/Output.

### Labor System
- Distinct labor pools for general, skilled, and specialist labor.
- Each canton generates a labor mix each turn.
- Labor is assigned only to funded and input-eligible slots and cannot transfer between cantons.
- Labor Access Index scales deliverable labor and assignment follows plan priority then suitability.
- Labor consumption records food and luxury usage and flags shortages.
- Idle or retooled slots do not consume labor.

### Logistics System
- Logistics Points are generated at +10 per active Logistics slot and cannot be stockpiled.
- Per-slot LP operating costs are recorded by sector and summed into LP demand.
- Domestic mode selection sorts by lowest LP cost with Rail > Sea > Air on ties.
- Mode capacities and same-turn thresholds are enforced per canton and mode.
- Imports are allocated before exports within each mode on a pro-rata basis.
- International gateways respect capacity and record LP and FX freight costs.
- LP Ratio scales all LP-using activities uniformly when supply is short.
- Essentials First allocates LP by priority (Agriculture → Defense → Manufacturing → Research → Luxury → Extraction → Finance).
- Shipments exceeding same-turn thresholds queue to the next turn.
- LP accounting distinguishes operating, domestic, and international demand components.

