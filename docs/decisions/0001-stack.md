# 0001 Technology stack

Status: accepted (M0)

## Decision

We use the stack in the PLAN.md "Tech stack" table: a pnpm workspace monorepo in strict TypeScript; Vite + React, React Router, Tailwind CSS + shadcn/ui (Radix), i18next, Zustand + Immer, TanStack Query, react-hook-form + Zod, Konva, react-three-fiber + drei, pdf.js, Dexie, vite-plugin-pwa; graphology for the graph; Supabase (Postgres, Auth, Storage, Edge Functions, RLS) as backend; Vitest, Playwright and pgTAP for tests; ESLint + Prettier; GitHub Actions for CI and GitHub Pages hosting; Dependabot.

Libraries are added in the milestone that first needs them, not up front.

## Versions pinned at M0

- Node 26 (current LTS), pnpm 12.
- TypeScript 6.0, not 7.0: typescript-eslint (needed for type-aware lint rules) supports `typescript <6.1`. Revisit when typescript-eslint supports TypeScript 7.
- React 19, React Router 8, Vite 8, Vitest 5, ESLint 10, Tailwind 4, Zod 4, Immer 11, graphology 0.26.
- The Supabase CLI is a workspace dev dependency (`pnpm supabase …`) so everyone runs the same version.

## Why

Established, widely used tools that agents know well, one language across browser, Node and Deno, and a single backend service. See PLAN.md for the reasoning per area.
