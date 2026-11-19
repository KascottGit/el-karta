# 0004 Supabase access, RLS and saving

Status: accepted (M2)

## Decision

- **Everything runs as the user.** `SupabaseRepository` takes a supabase-js client signed in as the user; the web app, MCP server and Edge Functions all use it that way, so row level security is the only access check. The service role key is never used for user data, including in tests: integration and e2e tests sign up real users on the local stack.
- **One RLS rule.** `project_role(project_id)` (security definer, so policies on `project_members` don't recurse) backs `can_read_project` (any member) and `can_write_project` (owner or editor). Every project-scoped table and the `project-files` storage bucket (paths `<project_id>/…`) use these two functions.
- **Membership is never written directly.** A trigger adds the owner when a project is inserted; `share_project(project_id, email, role)` (owner only, security definer to look up `auth.users` by email) adds editors and viewers. The person must have signed in once.
- **Creating a project is one RPC.** `create_project(project, floors)` runs as the caller (security invoker) and inserts the project and its floors in one transaction.
- **Saving is a conditional update.** `saveFloor` / `saveProject` update `where id = … and version = expected` and set `version = expected + 1`; no matching row means someone else saved first, and the repository returns their version. `saveWithReplay` (core) then replays the queued changes onto it. The web store keeps the last saved version of every document as the base for replays and merges others' changes into the open model.
- **Magic link with PKCE.** The link returns to `origin + base path`; supabase-js exchanges the `?code=` on load. A PKCE link only works in the browser that asked for it, which the sign-in page tells the user.

## Consequences

- `share_project` reveals to a project owner whether an email has an account. Acceptable for the prototype; revisit with organisations.
- RLS is proven by `supabase/tests/database/rls.test.sql`; the repository and sign-in flow by integration and Playwright tests, all run in CI against a local stack.
