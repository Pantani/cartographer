# CLI Multi-Hop Registry

## Goal

Make the existing V2 hop loop reachable from the CLI without introducing live
network assumptions or a hard-coded chain registry.

## Scope

- Add `cartographer trace --registry <path>` for a static JSON registry.
- Add `cartographer trace --max-depth <count>` to pass the hop-depth guard to
  the orchestrator.
- Keep `--call` and raw `--xcm` request validation unchanged.
- Keep the registry file pure data; no endpoint probing or metadata fetching in
  the CLI.

## Registry JSON Shape

```json
{
  "chains": [
    {
      "name": "Asset Hub",
      "rpc": "wss://asset-hub.example",
      "location": { "parents": 1, "interior": { "X1": { "Parachain": 1000 } } }
    }
  ]
}
```

## Done Criteria

- Unit tests show the CLI passes a static registry and `maxDepth` to
  `trace()`.
- Invalid registry files and invalid `--max-depth` values fail before network
  work starts.
- `pnpm run check` stays green.
