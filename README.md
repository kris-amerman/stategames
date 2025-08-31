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
