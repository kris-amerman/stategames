# stategames

Experimental turn-based strategy game simulation with separate server and client packages.

## Repository Layout

- `client/` – browser client built with Vite.
- `server/` – Bun-powered game server and test suite.
- `tests/` – additional documentation for the test harness.

## Running Tests

All automated tests run inside the `server` package and use [Bun](https://bun.sh).

```
cd server
bun test
```

Generate a coverage report with:

```
cd server
bun run test:coverage
```

## Economy System Scaffold

This update lays out the Economy system foundations, defining key resources and sectors and how they are tracked.

- Distinct resource types form the basis of production and consumption.
- Registered sectors: Agriculture, Extraction, Manufacturing, Defense Industry, Luxury, Finance, Research, Logistics, and Energy.
- Slot capacity and utilisation are tracked per canton and sector.
- Logistics Points are generated and treated as non‑stockpiled resources.

The automated tests verify the following pass criteria:

1. Resource types are unique and non-interchangeable.
2. All sectors listed above register correctly.
3. Slot capacity and utilisation are recorded by canton and sector.
4. Logistics Points cannot be stockpiled across turns.

## Budget System Scaffold

This update introduces the Budget system that governs how resources are allocated.

- Budget pools: Military, Welfare, and Sector Operations & Maintenance.
- Under-funded allocation prioritises suitability followed by largest remainder with deterministic tie-breaking.
- Idle slots incur 25% Operations & Maintenance cost.
- Retools cost 8 Gold per slot and require two turns of downtime.
- The Budget stage exposes hooks for Inputs, Labor, and Modifiers/Output processing.

The automated tests verify the following pass criteria:

1. Military, Welfare, and Operations & Maintenance pools exist and track spending.
2. Allocation under shortage honours suitability then largest remainder.
3. Idle slots accrue 25% Operations & Maintenance cost.
4. Retooling costs 8 Gold/slot and enforces a two-turn downtime.
5. Inputs, Labor, and Modifiers/Output hooks run during the Budget stage.

## Labor System Scaffold

This update adds the initial scaffolding for the Labor system including:

- Distinct labor pools for general, skilled, and specialist labor
- Per–turn generation of a labor mix based on canton urbanization level
- Assignment of labor only to funded and input-eligible slots
- Labor Access Index (LAI) limiting deliverable labor
- Consumption tracking for food and luxury goods with shortage flags

The automated tests verify the following pass criteria:

1. Labor pools (General, Skilled, Specialist) exist and are distinct
2. Each canton generates a labor mix each turn
3. Labor is assigned only to funded and eligible slots and cannot transfer between cantons
4. LAI scales labor availability, and assignment follows plan priority then suitability
5. Labor consumption records food and luxury usage and flags shortages
6. Idle or retooled slots do not consume labor

## Logistics System Scaffold

This update introduces the Logistics system scaffolding covering LP generation, operating costs, domestic and international shipping, LP throttling, and an optional Essentials First prioritization hook.

The automated tests verify the following pass criteria:

1. LP is generated at +10 per active Logistics slot and is non-stockpiled
2. Per-slot LP operating costs are recorded by sector and summed into LP demand
3. Domestic mode selection sorts by lowest LP cost with Rail > Sea > Air on ties
4. Mode capacities and same-turn thresholds are enforced per canton & mode
5. Imports are allocated before exports within each mode on a pro-rata basis
6. International gateways respect capacity and record LP and FX freight costs
7. LP Ratio scales all LP-using activities uniformly when supply is short
8. Essentials First allocates LP by priority (Agriculture → Defense → Manufacturing → Research → Luxury → Extraction → Finance)
9. Shipments exceeding same-turn thresholds queue to the next turn
10. LP accounting distinguishes operating, domestic, and international demand components

## Suitability System Scaffold

This update introduces the Suitability system scaffolding that rates how well a canton supports each economic sector.

- Geography and Urbanization modifier tables are injectable and cached per canton.
- Scores are rounded, clamped to the range [-60%, +50%], and converted to final multipliers.
- Suitability runs after the Labor gate as the last multiplier in the Five Gates sequence.

The automated tests verify the following pass criteria:

1. Suitability is produced for every canton–sector pair with both a percent and multiplier.
2. Geography shares are respected and the weighted sum over tile types is used.
3. Urbanization Level modifiers are added once based on the canton’s UL.
4. Rounding to the nearest whole percent occurs before clamping.
5. Clamping enforces the range [-60%, +50%].
6. The multiplier equals `1 + (percent/100)` and matches the clamped percent.
7. Suitability is applied only after the Labor gate and before output tallies.
8. Changing UL or tile shares changes the computed suitability while unchanged inputs yield identical results across turns.
9. Cached suitability invalidates when UL or tile shares change and remains stable otherwise.
