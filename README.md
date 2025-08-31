# stategames

## Running Tests

The repository uses [Bun](https://bun.sh) for the server runtime and test suite.

```
cd server
bun test
```

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
