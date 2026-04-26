# Contributing

Thanks for improving OpenClaw Managed Agents.

## Development

Requirements:

- Node `>=22.14.0`
- pnpm
- Docker

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

Run the local stack:

```bash
cp .env.example .env
docker compose up --build -d
```

## Pull Requests

- Keep changes scoped.
- Add or update tests when behavior changes.
- Keep public API changes reflected in `README.md`, `openapi/openapi.yaml`, and both SDKs.
- Do not add silent fallbacks for provider/runtime/store failures.
- Do not change the license away from MIT.

## Release Checklist

1. Update versions in `package.json`, `sdk/typescript/package.json`, and `sdk/python/pyproject.toml`.
2. Update `CHANGELOG.md`.
3. Run `pnpm lint`, `pnpm test`, `pnpm build`.
4. Run SDK builds/tests.
5. Tag `vX.Y.Z`; release workflows publish GHCR images, SDKs, and the GitHub release.
