# server

Bun-based backend for the stategames simulation.

## Prerequisites

- [Bun](https://bun.sh) 1.2.15 or newer

## Development

Start the server:

```
bun run start
```

## Testing

```
bun test
```

Generate a coverage report:

```
bun run test:coverage
```

## Systems

The server currently implements the following core systems:

- **Economy** – defines resources and sectors while tracking capacity and utilisation.
- **Budget** – allocates funds across Military, Welfare, and Operations & Maintenance pools.
- **Labor** – generates distinct labor pools and assigns them to funded, eligible slots.
- **Logistics** – produces Logistics Points, selects shipping modes, and throttles demand when capacity is limited.

## Utilities

Generate terrain meshes:

```
bun run generate-meshes
bun run generate-mesh:small|medium|large|xl
```

