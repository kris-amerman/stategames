# Test Suite

This repository includes scaffolded tests for the core systems of the game server.

## Running Tests

```bash
bun test
```

### Coverage

Generate a coverage report (from the `server` directory) with:

```bash
cd server && bun run test:coverage
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

