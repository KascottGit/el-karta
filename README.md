# El-karta

Browser-based tool for documenting a building's electrical installation on a simple 2D/3D model built from a floor plan. See [PLAN.md](PLAN.md) for the plan and [AGENTS.md](AGENTS.md) for how to work in this repo.

## Getting started

```sh
nvm use               # Node 26
pnpm install
cp .env.example .env.local   # then fill in values
pnpm dev              # http://localhost:5173
pnpm supabase start   # local Supabase (Docker)
```

`pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm perf` are described in AGENTS.md.
