# El-karta – Prototype Plan

> Working name (repo: `el-karta`, Supabase project: `el-karta-dev`). Browser-based tool that creates a simple 3D model of a home, office or warehouse from a floor-plan image, documents its electrical installation (distribution boards, breakers, outlets, switches, lights) and wires it up, so anyone can click an outlet and see its breaker. It must scale from one villa with 15 breakers to a multi-floor office or a large warehouse with several sub-panels and thousands of devices. Built modular so the same core can later map network cabling and devices (racks, patch panels, switches, access points, printers), and so AI agents can read and reason about the data. Everything AI produces is a **suggestion** the user can accept, edit or reject.

Terminology: "panel" in code = distribution board (elcentral); "sub-panel" = undercentral.

## Design principles

1. **Tried and tested over clever.** Use established, widely used libraries and patterns whenever one fits. Write custom code only when nothing proven exists, and record why in a short ADR.
2. **Built to be extended.** New domains (network, furniture, fire alarm, HVAC), new views, new AI passes and new agent tools are added as plugins or registrations, not by editing the core.
3. **Generalize on the second use.** When a new feature resembles an existing one, refactor the existing feature into a generic, shared version and use it for both. Never copy-paste a feature and tweak it. (Examples: the rack view reuses the panel view's generic slot-container; every AI pass uses the same pipeline.)
4. **Maintainable.** Strict types, small modules, one way of doing each thing, consistent naming. The schema is the single source of truth: types are derived from Zod schemas, DB types are generated.
5. **Agents first.** This codebase is developed mainly by AI agents:
   - Keep code comments to a minimum. Only comment a non-obvious *why*; never restate what the code does.
   - Put conventions in `AGENTS.md` (with `CLAUDE.md` pointing to it) and decisions in short ADRs in `docs/decisions/`, not in comments.
   - Enforce rules with tooling (lint rules, import boundaries, type checks, CI), not with prose.
   - Prefer self-explanatory names and types over explanations.
6. **AI suggests, people confirm.** AI never writes to the model. Every AI result is validated, shown as a suggestion (ghosted), and only becomes data when a person accepts it. Every item records where it came from.
7. **The LLM handles meaning; deterministic code handles geometry.** LLMs read labels, room types, dimension text and connectivity, and count visible things. Code computes and validates positions, lengths, scale and topology.
8. **Detect first, suggest second.** El-karta documents what exists. Things seen in photos or on plans beat rule-based guesses, and guesses are never shown as facts.
9. **Honest data.** An unknown cable route must never look like a known one.

## How to work on this (instructions for Claude Code)

- Work **one milestone at a time**, in the order given under Milestones (not by number). When a milestone is done: run typecheck, lint and tests, commit, then stop and summarize what was built, what's left and any decisions you made.
- Follow the design principles above. When you generalize an existing feature, say so in the summary.
- **Import boundaries:** `packages/core` never imports from plugins, apps or data adapters. Plugins depend on core only. This is enforced by lint (M0). Milestone 14 (network plugin) is the test: it must not require changes to `packages/core`.
- Write unit tests for all model, geometry, graph, validator and agent-tool logic. UI tests only where cheap.
- **Respect the performance budget** (below) from M6 onward. Test against the large synthetic projects, not just the small house.
- Ask before adding a large dependency or changing the data model in a breaking way.
- All database changes go through migrations in `supabase/migrations/`. Never change the schema by hand in the dashboard.
- Never put the service role key or AI provider keys in client code or in git. Use `.env.local` (git-ignored) and Supabase secrets.
- UI text in Swedish via i18n keys, so it can be translated later. Code and identifiers in English.

## Goals

1. Very simple to use for a homeowner, an electrician or a facility manager, on a phone or laptop.
2. Go from a floor-plan image to a usable, editable 2D/3D model in minutes.
3. Click any outlet, light or breaker and immediately see everything on that circuit, in the floor plan, the 3D view, the panel view and the circuit list, including which sub-panel and main panel feed it, and which switch controls a light.
4. Map circuits quickly on site with a "turn off a breaker, tap what went dead" mode, which also works in large areas.
5. Use photos of rooms, the distribution board and its breaker list to speed up documentation, always with user review.
6. Scale from one house to large commercial buildings without changing the model.
7. Modular: electrical is the first domain plugin; network is the second.
8. Several people can sign in and work on the same building, ideally on different floors at the same time.
9. AI agents (an in-app assistant and external agents via MCP) can query the data and help troubleshoot, within strict safety limits.

## Non-goals (for now)

- Exact 3D cable routing, AR, live multi-user editing, payments, customer organizations.
- Reconstructing 3D geometry from ordinary photos. The space comes from the floor plan; photos refine features, openings and ceiling heights.
- CAD/BIM import (DWG, DXF, IFC). Planned for later; the prototype takes images and PDFs.
- Replacing safety checks, electrical design or a licensed electrician. The app is documentation and decision support, and says so in the UI.

## Tech stack

| Area | Choice | Why |
| --- | --- | --- |
| Repo | pnpm workspaces monorepo | Shares model, plugin logic, validators and agent tools between web app, MCP server and Edge Functions |
| Language | TypeScript (strict) everywhere | One language across browser, Node and Deno |
| Web app | Vite + React | Standard, fast, well known to agents |
| Routing | React Router | Proven, simple |
| UI components | Tailwind CSS + shadcn/ui (Radix) | Accessible, consistent, components live in our repo |
| Forms | react-hook-form + Zod resolver | Same schemas for forms and data |
| i18n | i18next + react-i18next | Standard; Swedish first |
| App state | Zustand + Immer (with patches for undo/redo and sync) | Proven pattern for editors |
| Server state | TanStack Query | Caching, retries, loading states for Supabase calls |
| Schemas | Zod; TS types via `z.infer`; JSON Schema generated from Zod for AI structured output | Single source of truth for data, forms, DB documents and AI output |
| Graph | graphology | Proven graph library; tracing and traversal not hand-rolled |
| 2D editor | Konva (react-konva) | Canvas-based, built for interactive editors with thousands of shapes, hit testing and touch |
| PDF floor plans | pdf.js | Renders a chosen PDF page to an image |
| 3D view | react-three-fiber + drei | Standard Three.js for React; instanced meshes for devices |
| Offline cache | Dexie (IndexedDB) | Proven IndexedDB wrapper, good for sync queues |
| PWA | vite-plugin-pwa (Workbox) | Installable, works offline |
| Backend | Supabase: Postgres, Auth (magic link, PKCE), Storage, Edge Functions, RLS | One service for everything, EU region |
| AI | Provider-agnostic adapter in Edge Functions (Gemini, Claude, OpenAI); model chosen per AI pass in config | Swap providers or models without touching the passes; keys stay server-side |
| MCP | Official MCP TypeScript SDK | Standard protocol for external agents |
| Testing | Vitest, Playwright (smoke), pgTAP via `supabase test db` (RLS), AI eval harness (see AI pipeline) | Covers logic, UI flows, security and AI quality |
| Code quality | ESLint (incl. import boundary rules) + Prettier, `tsc --noEmit` | Rules enforced by tools |
| CI | GitHub Actions: typecheck, lint, test, build on every push | Guards agent-written code |
| Hosting | GitHub Pages for the static web app, deployed by GitHub Actions; Supabase for everything else | Free, no extra service; easy to move to Vercel/Cloudflare Pages later (see Hosting) |
| Dependency updates | Dependabot | Keeps dependencies current with small, reviewable PRs |
| Error tracking (later) | Sentry | Standard |

Shared packages are plain ESM TypeScript with no Node- or browser-only APIs, so they run in the browser, in Node (MCP server) and in Deno (Edge Functions, via the import map in `supabase/functions/deno.json`, which maps npm dependencies such as `zod` and `graphology` to the same versions as the rest of the repo).

### Environment variables

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...        # anon/publishable key only, never the service role key
VITE_BASE_PATH=/                  # /el-karta/ on GitHub Pages
# Supabase secrets (never in the client): GEMINI_API_KEY, ANTHROPIC_API_KEY (as needed)
```

### Hosting (GitHub Pages)

The web app is fully static, so GitHub Pages works. The setup:

- **Deploy:** a GitHub Actions workflow builds `apps/web` on every push to `main` and publishes it with `actions/deploy-pages`. CI must pass first.
- **Base path:** the site lives at `https://<user>.github.io/el-karta/`, so Vite's `base` and React Router's `basename` come from `VITE_BASE_PATH`. Moving to a custom domain or another host later means changing only this value.
- **Deep links:** GitHub Pages has no rewrites, so the build copies `index.html` to `404.html`. Any URL then loads the app, and React Router takes over.
- **Auth:** use the Supabase PKCE flow (`flowType: 'pkce'`) and add both `http://localhost:5173` and the Pages URL as redirect URLs in Supabase Auth.
- **PWA:** the manifest's `start_url` and `scope` and the service worker follow the base path.
- **Build-time config:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_BASE_PATH` are GitHub Actions variables. The anon key is designed to be public; RLS protects the data.
- **Limits to know:** there is one site, so no preview deploy per branch. Test branches locally, and on a phone with `pnpm dev --host` over the same Wi-Fi. A private repo needs a paid GitHub plan (Pro or Team) to use Pages; on a free plan the repo must be public. The published site itself is always public, which is fine because all data is behind sign-in.
- **Move later** to Vercel or Cloudflare Pages when preview deploys or a custom domain with headers are needed; nothing else in the stack changes.

## Performance budget

Measured on a mid-range laptop and a recent phone, using the synthetic projects from M1:

| Project | Size | Open | Select + highlight circuit | 2D pan/zoom |
| --- | --- | --- | --- | --- |
| Small (villa) | 2 floors, 150 devices | < 1 s | < 100 ms | smooth |
| Medium (office) | 5 floors, 2,000 devices, 4 sub-panels | < 2 s | < 150 ms | smooth |
| Large (warehouse/office block) | 10 floors or 20,000 m², 8,000 devices, 15 sub-panels | < 4 s | < 250 ms | smooth on laptop, usable on phone |

## Architecture

```
apps/
  web/
    src/
      app/              # routing, providers, layout
      features/
        auth/
        projects/       # project list, create, share
        floorplan/      # 2D editor (walls, openings, rooms, zones, grid, scale)
        containers/     # generic slot-container view (panels now, racks later)
        list/           # circuit list, search, CSV/PDF export
        bulk/           # multi-select, array placement, naming templates, CSV import
        mapping/        # phone mapping mode
        view3d/
        suggestions/    # generic review UI for AI suggestions (ghosted items, accept/edit/reject)
        ai-import/      # floor plan, photo and board import flows
        assistant/      # in-app assistant chat (M16)
      plugins/
        power/          # UI parts of the power plugin
        furnishing/     # UI parts of the furniture plugin (M9)
        network/        # M14
      ui/               # shadcn components, shared UI
      i18n/
  mcp/                  # MCP server (M15)
packages/
  core/                 # schemas, geometry (placement resolution), graph, plugin interface,
                        # repository interface, validators, migrations, generator
  plugin-power/         # device types, connection kinds, validation, label templates, suggestion rules
  plugin-furnishing/    # M9
  plugin-network/       # M14
  data-supabase/        # SupabaseRepository, usable from web, MCP and Edge Functions
  ai-passes/            # pass definitions: input selection, prompt, output schema, validator, merge (M4+)
  agent-tools/          # agent tool definitions shared by MCP server and in-app assistant (M15)
supabase/
  migrations/
  functions/
    _shared/            # AI provider adapter, auth helpers, rate limiting, usage logging
    ai-pass/            # one function that runs any registered pass from packages/ai-passes
    assistant/          # M16
  tests/                # pgTAP RLS tests
  seed.sql
evals/                  # AI eval sets: input images + hand-traced ground truth + scoring
docs/
  decisions/            # short ADRs
AGENTS.md
CLAUDE.md               # points to AGENTS.md
```

A plugin is split in two: domain logic in `packages/plugin-*` (usable by agents and server code) and UI in `apps/web/src/plugins/*`.

### Hierarchy

`Project (site) → Building → Floor → Room or Zone → Wall / Opening / Device`

- A project can contain several buildings (e.g. office + warehouse on one site).
- Rooms have a name and a **type** (kitchen, bathroom, hallway, bedroom, living room, laundry, office, warehouse, technical room, other); room type drives suggestion rules and label matching.
- **Zones** (named areas, e.g. "Rack aisle 3", "Loading bay") suit open warehouses. Both rooms and zones are polygons; a zone may overlap rooms.
- **Openings** (doors, windows, open passages) sit in a wall, with hinge side and swing for doors.
- Optional **grid lines** per floor (A–Z / 1–n), as used in commercial drawings, so devices can be located as "C4".

### Database (prototype)

Keep JSON documents for speed of development, but **one document per floor** so large buildings save quickly and several people can work on different floors without conflicts. Building-wide data (buildings, panel feeds between floors, risers) lives on the project.

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users default auth.uid(),
  name text not null,
  kind text not null check (kind in ('home', 'office', 'warehouse', 'other')),
  data jsonb not null,             -- ProjectData: buildings + cross-floor connections
  schema_version int not null,
  version int not null default 1,  -- optimistic locking
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table floors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  building_id text not null,
  name text not null,
  sort_order int not null,
  data jsonb not null,             -- FloorData
  schema_version int not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table project_members (
  project_id uuid references projects on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  primary key (project_id, user_id)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  floor_id uuid references floors on delete cascade,
  storage_path text not null,      -- '<project_id>/<attachment_id>.<ext>' in bucket 'project-files'
  kind text not null check (kind in ('floorplan', 'photo', 'panel_photo', 'breaker_list')),
  region jsonb,                    -- what the image shows: { roomId?, wallIds?, deviceIds?, note? }
  created_at timestamptz not null default now()
);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  user_id uuid not null references auth.users default auth.uid(),
  pass text not null,              -- 'floorplan' | 'photo' | 'panel' | 'wiring' | ...
  provider text not null, model text not null,
  input_tokens int, output_tokens int, images int,
  validation_retries int not null default 0,
  status text not null,            -- 'ok' | 'invalid' | 'error' | 'rate_limited'
  created_at timestamptz not null default now()
);
```

- **RLS:** a user can read a project and its floors if they are a member; write if owner or editor. The same rule applies to `attachments`, `ai_runs`, storage objects under `project-files/<project_id>/`, and every table added later. Creating a project also creates the owner's membership row (trigger or RPC).
- **Agents run as the user:** AI passes, the assistant and the MCP server always query with the signed-in user's JWT, so RLS applies to them too. The service role key is never used for user data.
- **Loading:** opening a project loads the project document and all floor documents (a few MB is fine), then builds one in-memory graph so circuits can be traced across floors.
- **Saving and sync (one mechanism for online and offline):** every edit is an Immer patch. Unsaved patches are kept in a Dexie queue per floor. A save writes the floor with `where id = $1 and version = $2`, then increments `version`. If no row matched, someone else saved first: load the latest version, **replay the queued patches on top of it**, and save again. Patches that no longer apply (e.g. the device was deleted by someone else) are shown to the user to resolve, never silently dropped. Offline work in the mapping mode uses exactly the same queue.
- **Schema evolution:** every document has a `schemaVersion`; `packages/core` has a migration function per version step, applied on load and covered by tests.

### Data model

Defined as Zod schemas in `packages/core`; the types below are what `z.infer` produces. Lengths in metres.

```ts
type Pt = { x: number; y: number };
type Vec3 = { x: number; y: number; z: number };

type ProjectData = {                                   // projects.data
  schemaVersion: number;
  buildings: { id: string; name: string }[];
  crossFloorConnections: Connection[];                 // e.g. main panel (floor 1) -> sub-panel (floor 3)
};

type FloorData = {                                     // floors.data
  schemaVersion: number;
  elevation: number;
  height: number;                                      // default ceiling height: 2.4 home, 3.0 office, 8-12 warehouse
  scale?: { source: "dimension_text" | "user" | "ai_estimate"; metresPerPixel: number };
  background?: { attachmentId: string; pdfPage?: number; offset: Pt; rotation: number };
  grid?: { xLines: { label: string; pos: number }[]; yLines: { label: string; pos: number }[] };
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  zones: { id: string; name: string; polygon: Pt[]; provenance: Provenance }[];
  devices: Device[];
  connections: Connection[];
};

type Provenance = {
  status: "manual" | "detected" | "suggested" | "confirmed";
  source?: string;          // "floorplan:<attachmentId>", "photo:<attachmentId>", "rule:<ruleId>", "user"
  confidence?: number;      // 0-1, from AI or rule; shown in review, not used as fact
};

type Wall = { id: string; a: Pt; b: Pt; thickness: number; height?: number; provenance: Provenance };
type Opening = {
  id: string; wallId: string; kind: "door" | "window" | "passage";
  offset: number;           // metres from wall point a to the opening's near edge
  width: number; height: number; sill?: number;
  hinge?: "left" | "right"; swing?: "in" | "out";
  provenance: Provenance;
};
type Room = { id: string; name: string; type: RoomType; polygon: Pt[]; ceilingHeight?: number; provenance: Provenance };

type Placement =                                       // relative placement; absolute position is derived
  | { kind: "wall"; wallId: string; offset: number; height: number; side: "left" | "right" } // offset in metres from wall point a
  | { kind: "ceiling"; roomId: string; at: Pt }
  | { kind: "floor"; at: Pt; rotation?: number; size?: Vec3 }
  | { kind: "container"; parentId: string; slot: number };                                  // breaker in panel, switch in rack

type Device = {
  id: string;
  domain: string;           // plugin id: "power" | "furnishing" | "network" | ...
  type: string;             // plugin-defined: "outlet", "switch", "light", "breaker", "desk", ...
  label: string;            // e.g. "UC2-F14" or "Kök uttag 3"
  roomId?: string; zoneId?: string;
  placement: Placement;
  count?: number;           // e.g. 2 for a double outlet
  props: Record<string, unknown>; // validated by the plugin's schema
  ports: Port[];
  provenance: Provenance;
  attachmentIds?: string[];
};
type Port = { id: string; domain: string; kind: string; label?: string };

type RouteCertainty = "verified" | "traced" | "inferred" | "unknown";
type Connection = {
  id: string; domain: string;
  kind: string;             // "circuit" (breaker -> devices), "feeder" (panel -> sub-panel), "control" (switch -> light), "ethernet", ...
  fromPortId: string; toPortId: string;
  provenance: Provenance;   // who created the link and whether a person confirmed it
  route?: { floorId: string; points: Vec3[]; certainty: RouteCertainty }[]; // physical path; absent = unknown
  attachmentIds?: string[];
};
```

- `packages/core/geometry.ts` resolves a `Placement` to an absolute position. Placement relative to walls survives wall edits, and is the format AI passes return, which is easier for an LLM than raw coordinates.
- Openings and wall-placed devices store `offset` in metres from the wall's start. If a wall is shortened, items beyond the new end are flagged for review instead of moving silently.
- A circuit is not a separate entity: **a breaker is the circuit**, and its circuit label is a breaker prop. The circuit list is derived from breakers and their `circuit` connections.
- `control` connections (switch → light) are not followed when tracing power, but are shown when a light or switch is selected.
- Ids are globally unique (UUIDs), so a connection can point at a port on any floor.

### Plugin interface

```ts
interface DomainPlugin {
  id: string;
  name: string;
  deviceTypes: DeviceTypeDef[];        // label key, icon id, allowed placements, default height, default ports, props schema
  connectionKinds: ConnectionKindDef[];
  traceKinds: string[];                // connection kinds followed when tracing
  validate(model: Model): Issue[];
  labelTemplates?: LabelTemplate[];
  containerTypes?: ContainerTypeDef[]; // device types shown in the generic slot-container view (panel, rack)
  suggestionRules?: SuggestionRule[];  // deterministic rules, M13
  aiHints?: AiHints;                   // vocabulary and examples for AI passes (e.g. what outlets look like, Swedish breaker labels)
  agentKnowledge?: AgentKnowledge;     // domain facts and safe troubleshooting steps for the assistant (M16)
}
```

Tracing uses graphology over all floors: upstream (outlet → breaker → sub-panel → main panel) and downstream (panel → everything it feeds). All views highlight from the same selection state.

## AI pipeline

Every AI feature is a **pass** defined in `packages/ai-passes` and run by one Edge Function (`ai-pass`). Adding a pass means registering a definition, not writing a new function.

```ts
interface AiPass<In, Out> {
  id: string;                                   // "floorplan", "photo", "panel", "wiring"
  model: ModelChoice;                           // provider + model, from config
  selectContext(project: Model, input: In): Context; // only the relevant subset of the model and images
  prompt(context: Context): Prompt;
  outputSchema: ZodType<Out>;                   // also sent as JSON Schema for structured output
  validate(out: Out, project: Model): Issue[];  // deterministic checks
  toSuggestions(out: Out, project: Model): Suggestion[]; // relative placements resolved by geometry code
}
```

Every run: select context → call the model with structured output → parse with Zod → run the validator → if there are errors, send them back to the model **once** → return suggestions (still with any remaining issues flagged) → user review in the generic suggestions UI. Every run is logged to `ai_runs`.

| Pass | Input | Output | Milestone |
| --- | --- | --- | --- |
| Floor plan | Plan image or PDF page | Walls, openings, rooms with names and types, dimension text, scale | M4 |
| Photo detection | Photo + the room/wall it shows + that room's walls, openings and features + 1–3 earlier photos of the same room | Detected features with wall-relative placement; opening and ceiling-height corrections | M11 |
| Panel | Panel photo(s) + photo of the breaker list | Breakers with number, rating, poles, type and label | M12 |
| Wiring | Breakers + named, typed rooms + features | Suggested breaker → device and switch → light links, with reasons | M12 |

**Validators (deterministic):** room polygons close and don't self-intersect; openings fit inside their wall; references point at existing ids; placements resolve inside the room; heights are plausible for the device type; scale is consistent across several dimension texts, and door widths fall in a normal range (about 0.7–1.0 m) as a sanity check.

**Context, not everything:** a pass gets the subset that matters (the selected room and its neighbours, existing features there, the most relevant earlier photos), not the whole building. This keeps cost, latency and confusion down in large buildings.

**Provider adapter:** `packages/ai-providers` exposes one interface (`generateStructured({ model, system, messages, images, schema })`, ADR 0007). Anthropic (Claude Haiku 5.5, the default) and Gemini (the fallback for outages) are implemented (ADR 0010); other candidates are in `docs/research/2026-11-ai-providers.md`. Each pass picks its model in config: a fast, cheap vision model for photo detection; a stronger model for panel and wiring reasoning if evals show it's needed. The adapter handles retries with backoff on rate limits (429), per-user rate limiting and usage logging.

**Data and provider terms:**
- During testing, use only test data (our own homes, made-up or public floor plans). Free tiers of some providers (e.g. the Gemini API free tier) may use prompts and images to improve their products.
- Before any customer data is uploaded: switch to a paid tier whose terms exclude training on our data, set a budget cap with the provider, and check the provider's current terms for EEA users and GDPR.

**Evals (`evals/`):** for each pass, a set of inputs with hand-made ground truth and a scoring script, run on demand (not on every push, because it costs money). The floor-plan set starts with about 20 real plans, scored on room count, room names and types, wall-length error, opening count and scale error. Track results per provider and model so model choices are based on numbers.

## UX principles

- **Place in 2D, adjust in either.** New items are drawn and placed on the floor plan. Walls, doors, windows and passages can also be moved and resized in 3D with gizmos (M9b); both views edit the same data through the same edit operations. Choosing "what this photo shows" can be done by tapping a room or wall in either view, via the shared selection.
- One selection state shared by every view: select something anywhere and it's highlighted everywhere, and the view jumps to the right floor.
- **Suggestions look different:** suggested and detected items are ghosted with their source and confidence, and have accept / edit / reject actions, individually or in bulk. Confirmed and manual items look normal.
- Touch first: large targets, a maximum of 3 taps to place a single device, works one-handed.
- **Bulk is normal in commercial buildings:** placing 40 lights in a row or numbering 48 breakers must take seconds, not minutes.
- Search is always one tap away: find a device by label, room, zone or grid position ("C4").
- Route certainty is visible: verified = solid, traced = solid with a tolerance band, inferred = dashed, unknown = no route drawn at all.
- A short, permanent note in the app: El-karta is for documentation and planning; work on the fixed installation must be done by an authorised electrician.

## Milestones

Done: M0–M4, M9, M9b, provider review. **Order from here:** M11 → M5 → M6 → M7 → M8 → M10 → M12 → M13 → M14 → M15 → M16. M9 and M11 come first, so each says what it pulls forward from the milestones it skips.

### M0 – Scaffold
pnpm monorepo with the structure above; Node and pnpm versions pinned (`.nvmrc`, `packageManager`). Vite + React + TS strict, Tailwind + shadcn/ui, React Router, i18next, ESLint with import-boundary rules + Prettier, Vitest, PWA. `AGENTS.md` (conventions, commands, boundaries, "minimal comments" rule), `CLAUDE.md` pointing to it, `docs/decisions/` with ADR 0001 recording this stack. GitHub Actions: CI (typecheck, lint, test, build) on every push, and deploy to GitHub Pages from `main` as described under Hosting. Dependabot configured. Supabase CLI initialised, local stack runs, `.env.example` committed, `.env.local` git-ignored.
**Done when:** `pnpm dev`, `pnpm test`, `pnpm build`, `pnpm lint` and `supabase start` work, CI is green, a lint error appears if `core` imports from a plugin, and the empty app shell loads on a phone from the GitHub Pages URL, including a deep link and after reload.

### M1 – Core model, geometry, graph and generator
In `packages/core`: Zod schemas (hierarchy, walls, openings, rooms, zones, grid, placements, provenance), placement resolution, model validators, schema-version migrations, plugin interface and registry, graphology-based tracing (upstream/downstream, across floors), `Repository` interface with an in-memory implementation, patch-based edit operations, synthetic project generator (small/medium/large). Zustand + Immer store with undo/redo in the web app.
**Done when:** unit tests cover placement resolution (including walls being moved and shortened), the validators, adding/removing devices and connections, tracing across floors and through sub-panels, schema validation and migration, undo/redo, replaying patches on a changed document (including a patch that no longer applies), and tracing in the large synthetic project runs within budget.

### M2 – Supabase: auth, projects, floors, storage
Migrations for `projects`, `floors`, `project_members`, `attachments`, `ai_runs`, storage bucket `project-files`, RLS policies and the owner-membership trigger. pgTAP tests for RLS. Magic-link sign-in with PKCE, working both locally and on GitHub Pages. `packages/data-supabase` with `SupabaseRepository` (load project + all floors, save per floor with version check and patch replay, list, create), used through TanStack Query. Project list with kind (home/office/warehouse). Share a project by adding a user as editor (by email, via an RPC). Generated DB types.
**Done when:** two users can sign in, see the same project, edit different floors at the same time without conflicts, and the pgTAP tests prove a non-member gets nothing back.

### M3 – 2D editor: space
Konva-based editor. Upload a floor plan image or PDF (pick the page; stored in Supabase Storage) as a floor's background. Scale: enter one known measurement by clicking two points. Draw and edit walls (polyline with snapping, thickness, optional height), openings (door/window/passage on a wall, width, height, sill, hinge side, swing), rooms (polygon, name, type, optional ceiling height) and zones. Optional grid lines. Add/switch/reorder floors and buildings. Pan/zoom with mouse and touch, viewport culling. Autosave per floor with debounce.
**Done when:** an estate-agent villa plan and a PDF office plan can be traced by hand in minutes, including doors and windows, and the editor stays smooth with the large synthetic project.

### M4 – AI pipeline and floor plan import
Provider adapter (start with one provider; Gemini free tier with test data only is fine), `packages/ai-passes` with the pass interface, the `ai-pass` Edge Function, validate-and-retry-once loop, `ai_runs` logging. Floor plan pass: walls, openings, rooms with names and types, dimension text → scale (fallback: user measurement). Generic suggestions UI (ghosted overlay; accept/edit/reject, per item and in bulk). Large drawings are split into tiles and merged by code. Eval harness in `evals/` with the first 20 plans and hand-traced ground truth.
**Done when:** the eval scores are recorded per model, a typical Swedish estate-agent plan gives a usable model that needs only minor fixes, and a bad AI result can always be rejected and drawn by hand instead.

### M5 – Power plugin: devices, panels, switches
`packages/plugin-power` + UI. Device types: main panel, sub-panel, breaker (rating, e.g. 10/16/25 A; 1- or 3-pole; phase L1/L2/L3; type MCB/RCD/RCBO; circuit label), outlet (single/double/triple, earthed or not, outdoor), 3-phase outlet, switch (single, double, dimmer), ceiling light, wall light, emergency light, junction box, fixed equipment (machine, charger, HVAC unit). Toolbar to place devices on walls, ceilings or floor using wall-relative placement. Connection kinds: `circuit`, `feeder`, `control`. Panel view built on a **generic slot-container component** (`features/containers`). Panel hierarchy tree. Connect devices to a breaker (one or many); connect a switch to the lights it controls. Validation: unassigned devices, lights with no switch, panels with no feeder, simple phase imbalance warning.
**Done when:** a villa and the medium office project can be fully modelled, including a sub-panel on another floor fed from the main panel and switches controlling lights.

### M6 – Linked highlighting, search and lists
Selecting a device, breaker, panel or list row highlights the full circuit in the plan, the 3D view (M9), panel view, tree and list, and jumps to the right floor. Upstream path shown. Selecting a light shows its switch and vice versa. Global search by label, room, zone and grid position. Circuit list (gruppförteckning) per panel with filters; export as CSV and a print-styled page for PDF.
**Done when:** clicking an outlet in the large synthetic project shows its full upstream path and every device on that circuit, in 2D and 3D, within the performance budget.

### M7 – Bulk tools
Multi-select (box select, shift/long-press). Copy/paste. Array placement (row or grid with spacing). Naming templates with auto-increment (e.g. `UC2-F{n}`). Bulk assign to a breaker. CSV import of an existing circuit list (panel, breaker, rating, description) to create the panel view. Build these as generic operations on devices, not power-specific code.
**Done when:** 40 lights in a row can be placed, named and assigned in under a minute, and an existing circuit list in CSV becomes a panel view.

### M8 – Phone mapping mode (offline)
Flow: choose a breaker → "I've switched it off" → tap every device that went dead → confirm. Tap on the plan, or in a **list filtered by room/zone** (faster in big open areas). Create a device on the spot by tapping its position. Works offline, using the same patch queue and replay as normal saving. Build the flow generically ("choose a source, mark what's affected") so it can later map network ports too.
**Done when:** one circuit can be mapped on a phone in about a minute in a basement with no signal, and shows up on the laptop afterwards.

### M9 – 3D view and furniture
Walls extruded from the 2D plan using wall, room and floor heights; doors and windows cut out as openings; floors stacked; devices as instanced icons at their resolved positions (generic markers per device type until M5 adds the power icons); orbit/zoom on touch and mouse. Show one floor, a few floors, or all (exploded view). Clicking in 3D uses the same selection state as the 2D editor, so selecting a wall, room or device in one view selects it in the other; tapping a room or wall in 3D is also how M11 picks what a photo shows. Small `plugin-furnishing` (desk, table, shelf, rack shelving, cabinet, bed, sofa as simple boxes) to make rooms recognisable; it must need no core changes. Comes before M5 and M6, so circuit highlighting in 3D is part of M6.
**Done when:** an item selected in 2D is selected in 3D and the other way round, the large synthetic project stays usable in 3D on a laptop, and the furniture plugin was added without touching `packages/core`.

### M9b – Direct editing: overlay panel, gizmos, wall moves
Comes before every other remaining milestone. Four changes to the editor:
- **Overlay side panel.** On desktop the side panel (tool and selection panels) floats over the right edge of the viewport instead of taking a column beside it, so opening a tool or selecting something never shrinks or re-fits the 2D canvas or the 3D view. Phones keep the bottom sheet.
- **Screen-relative node snapping.** The reach for snapping to wall ends, midpoints and polyline points is a fixed number of screen pixels at every zoom level; it no longer grows with wall thickness when zoomed in.
- **Move a wall along its normal.** A new interaction: drag a selected wall (or use the move-wall tool on any wall) and it slides perpendicular to itself; the walls joined to it keep their direction and stretch or shrink to stay connected. One undoable edit.
- **Gizmos in 3D, openings selectable in 3D.** Doors, windows and passages are drawn in their cut-outs (door leaf, glass pane, invisible pick volume for passages) and can be selected in 3D. A selected wall gets gizmos to move it along its normal, drag its ends and set its height; a selected opening gets gizmos to slide it along the wall and to move each edge (width), the top (height) and, for windows, the sill. 2D gets the matching handles for opening width. Changes preview live and commit as one edit on release.

**Done when:** opening a tool panel on a laptop leaves the canvas size and view untouched; node snapping covers the same screen distance at any zoom; moving a wall keeps every joined wall connected and is undone in one step; a window can be selected, moved and resized in 3D on a phone and a laptop, and the change shows in 2D.

### M10 – Provenance, route certainty and evidence
Provenance shown on everything (manual, detected, suggested, confirmed; source; confidence) with filters such as "show unconfirmed items". Optional drawn cable route on the plan (may continue on another floor) with route certainty and styling. Photo attachments on devices, connections, rooms and walls, with `region` recording what each photo shows (uploaded to Supabase Storage, compressed on the client first).
**Done when:** a route without evidence can't be shown as verified, any item shows where it came from, and each room can carry photos linked to the walls they show.

### Provider review (before M11)
Add `AiProvider` implementations for the shortlist in `docs/research/2026-11-ai-providers.md` (Gemini 3.1 Flash-Lite, Claude Haiku 5.5, Mistral Small 4, and DeepSeek V4.1-Flash on an EU host, never DeepSeek's own API with real data), with a provider switch in config and in `pnpm eval`. Run the floor-plan evals on each and record score, cost per call (from `ai_runs`), latency and failure rate. Check each provider's terms against "Data and provider terms" above.
**Done when:** the floor-plan eval results are recorded per provider and model, and an ADR names the default provider and model per pass and a fallback provider for outages.
**Outcome:** the person chose Claude Haiku 5.5; only the Anthropic provider was added. Haiku is the default for every pass and Gemini 3 Flash the fallback for outages (ADR 0010, results in `evals/results/floorplan-summary.md`).

### M11 – AI: photo detection
**Pulled forward** (because M11 now comes before M5 and M10): from M5, `packages/plugin-power` with the device types photos can detect (outlet, switch, ceiling light, wall light) and placing, moving and deleting devices on walls and ceilings in the 2D editor; from M10, photo attachments with `region` (upload, client-side compression, linked to a room and wall). M5 and M10 then build on these instead of starting over. The eval runs on every provider kept after the provider review.

Photo pass on the M4 pipeline. User takes or uploads a photo and taps the room or wall it shows (2D or 3D). The pass gets that room's walls, openings, features and 1–3 earlier photos of the room, and returns detected features with wall-relative placement, plus suggested corrections to openings and ceiling height. Results appear in the generic suggestions UI.
**Done when:** a photo of a kitchen wall gives correctly typed outlets and switches on the right wall, roughly in the right place, that need only minor moves; eval set of 30+ photos scored for type and count accuracy.

### M12 – AI: distribution board and wiring suggestions
Panel pass: one or more photos of the panel plus a photo of the breaker list (gruppförteckning) → breakers with number, rating, poles, type and label, into the panel view as suggestions. Wiring pass: matches breaker labels (e.g. "Kök uttag", "Sovrum 2", "Belysning hall") to named, typed rooms and their devices → suggested `circuit` links, plus `control` link suggestions (switch → nearest lights in the same room), each with a short reason. Suggested links are dashed until confirmed, ideally with the mapping mode (M8).
**Done when:** for our own house, a photo of a labelled panel and breaker list creates a correct draft panel view, and label-based wiring suggestions are right for most clearly labelled circuits.

### M13 – Rule-based suggestions (checklist)
Deterministic rules in `plugin-power` (`suggestionRules`), run in code, not by an LLM: likely switch beside each door on the handle side at the height of switches already in the model; ceiling light at the room centre, or a grid in large rooms, offices and warehouses; likely outlets from wall length (verify the numbers against SS 437 01 02 before relying on them) with heights copied from existing outlets; room profiles for kitchen, bathroom, hallway, laundry, office and warehouse. Shown as a **checklist of things to verify on site** ("Is there a switch here?"), never as features in the model until confirmed.
**Done when:** for our own house, the checklist catches items that photos missed, and nothing from a rule appears as fact without confirmation.

### M14 – Network plugin (architecture test)
`packages/plugin-network` + UI. Device types: rack, patch panel (24/48 ports), switch (numbered ports, PoE flag), router/firewall, wall data outlet, access point, printer, camera, generic device. Connection kinds: `ethernet` and `patch`. Devices can have both a power port and a network port (a printer is on a circuit and a switch port; a PoE access point is powered by its switch port). Rack view reuses the generic slot-container. Import devices from CSV (name, IP, MAC, type, switch, port). Trace a network path from wall outlet → patch panel → switch port → uplink. Optional `aiHints` so photo detection can find data outlets and access points.
**Done when:** everything works **without changes to `packages/core`**, the database schema or the AI pipeline. If changes were needed, list them and why.

### M15 – Agent tool layer and MCP server
`packages/agent-tools`: one set of typed tools (Zod input/output schemas) used by both the MCP server and the in-app assistant. Read tools first:
- `list_projects`, `get_project_summary`
- `search_devices` (label, room, zone, grid position, type)
- `get_device` (with ports, photos, provenance)
- `trace_upstream`, `trace_downstream`, `get_controls` (switch ↔ lights)
- `get_panel` (breakers, ratings, phases, what each feeds)
- `get_circuit_list`, `get_validation_issues`, `get_unconfirmed_items`

Write tools return a **proposed change** that appears in the generic suggestions UI; agents never write directly.

`apps/mcp`: MCP server using the official TypeScript SDK. Start with stdio for local use (e.g. Claude Code or Claude Desktop). A `login` command signs the user in through the browser (PKCE) and stores the session locally; supabase-js refreshes it, and every query runs as that user so RLS applies. Plugins can register extra tools; the network plugin adds e.g. `trace_network_path`.
**Done when:** from Claude Desktop or Claude Code, an agent can answer "which breaker feeds the printer on floor 3, and what else is on that circuit?" for the medium synthetic project, and cannot see projects the user isn't a member of.

### M16 – In-app assistant and troubleshooting
Edge Function `assistant`: tool use over `packages/agent-tools` through the shared provider adapter, running as the signed-in user, streaming responses. Cap the number of tool calls per answer so a request stays within Edge Function time limits. Chat panel in the app that knows the current selection ("this breaker", "this machine"). New table `events` (project, device, kind, note, created_by, created_at) to log incidents such as "F7 tripped", so the assistant can see history and patterns; RLS like the rest.

Troubleshooting flows:
- **A breaker has tripped:** list everything downstream, separate RCD trips (often an earth fault in one device) from overcurrent trips (overload or short circuit), check recent events on the circuit, and suggest a safe order: unplug everything, reset once, reconnect one device at a time, log what happened.
- **A machine or device has stopped:** trace upstream to its breaker, sub-panel and main panel, check whether other devices on the same circuit or panel are also dead (narrows it to the device, the circuit or the panel), and check three-phase equipment for a single phase that's gone.
- Always end with a **handover summary** for an electrician: what's affected, what was tried, the relevant panel and breaker, and photos, so the electrician arrives prepared.

**Safety rules (non-negotiable), built into the system prompt and checked in evals:**
- Only suggest steps a non-electrician may safely do: identify, unplug, reset a breaker once, observe, log.
- Never guide opening panels, touching the fixed installation, measuring, or repeated resets. Those go straight to "contact an electrician", with the handover summary.
- Burning smell, heat, smoke, visible damage or repeated trips → stop and contact an electrician or emergency services.
- Every answer states which data it relied on, and never presents a suggested, unconfirmed or inferred item as fact.

Evaluation set: 20+ scenarios on the synthetic projects (correct tracing, correct handover summary, safe refusals), run on demand against the model, with the tool logic tested in CI.
**Done when:** the assistant handles the scenario set correctly, never suggests a step outside the safety rules, and produces a usable handover summary for a tripped breaker in the medium office project.

## Later (not in the prototype)

- Exports: glTF/GLB (3D), SVG/PDF (plans), possibly IFC.
- CAD/BIM import: DXF (and DWG converted to DXF), IFC.
- Normalize floor documents into tables when we need cross-project queries (e.g. all panels for a property manager).
- Organizations (electrical firms, facility managers) with many users and roles, and read-only sharing links (QR sticker on each panel).
- Remote MCP server (Streamable HTTP with OAuth).
- Live collaboration via Supabase Realtime.
- More domains: fire alarm, access control, HVAC, lighting control.
- Sensor data (energy meters, smart breakers) feeding `events` automatically.
- GDPR groundwork before real customers: data processing agreement, retention rules for photos, export and deletion of a customer's data, provider terms for EEA users.
- Move hosting to Vercel or Cloudflare Pages for preview deploys and a custom domain.

## Test cases

1. **Our own house:** floor plan → AI model → fixes; photos of each room; panel and breaker list photo; map at least one full circuit with the phone mode; then have someone else answer "which breaker feeds this outlet?" using only the app.
2. **A real office or warehouse we can get access to:** import a PDF floor plan, model the main panel and at least one sub-panel, bulk-place one area's lights, and map one circuit on site.
3. **Assistant:** simulate a tripped breaker and a stopped machine in both, and check the suggested steps and handover summary with an electrician.

Track the time each step takes, and the number of AI requests and tokens per building (from `ai_runs`) to estimate production cost.

## Setup we do by hand before starting

1. Create the GitHub repo `el-karta`. Private needs GitHub Pro or Team for Pages; otherwise make it public.
2. In the repo settings, set Pages → Source to "GitHub Actions", and add the Actions variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_BASE_PATH=/el-karta/`.
3. Create the Supabase project `el-karta-dev` in an EU region; invite each other to the Supabase organization.
4. In Supabase Auth, add `http://localhost:5173` and `https://<user>.github.io/el-karta/` as redirect URLs.
5. Copy the project URL and anon/publishable key into `.env.local`.
6. Before M4: create an AI provider key (e.g. Gemini in AI Studio for testing) and add it as a Supabase secret. Collect about 20 floor plans for the eval set (own homes, public listings used only for internal testing).
7. Install Node (LTS), pnpm, Docker and the Supabase CLI.

## First prompt to give Claude Code

> Read PLAN.md. Implement M0 and M1 only. Then stop, show me the folder structure, test results and how tracing performs on the large synthetic project, and list any decisions or open questions before we continue.
