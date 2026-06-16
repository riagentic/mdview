# aio framework notes (from mdview compat pass)

Project verified against **aio 1.0.0-alpha13** (vendored `dep/aio`). Status: ✅ fully compatible.
Checks: `deno check` ✓ · `aio doctor` 11/11 ✓ · graph validator valid, 0 warnings ✓ · `deno lint` 0 ✓ · 50/50 tests ✓ · boots empty→viewing, errors=0 ✓.

## Possible aio improvement — graph validator flags type-only `Deno.*` references

- **Symptom**: `validateGraph` (server-dev-checks → graph-validator) reported `server-only-api` warnings for `Deno.FsEvent` used purely as a **type annotation** in a dual-bundle file (`src/cell/mdview.ts`).
- **Why it's a false positive**: type annotations are erased by esbuild, so `Deno.FsEvent` never reaches the browser bundle at runtime. Only **value-position** `Deno.*` access is a real leak.
- **Suggestion**: make the validator type-aware — skip `Deno.*` references in type positions (type annotations, `type`/`interface` decls, `as`/`satisfies` casts, type-only imports). Today any textual `Deno.X` in a client-reachable module warns.
- **Severity**: low (warning only, non-blocking, debug-level). Worked around on the mdview side by dropping the unused `(_e: Deno.FsEvent)` param annotation, which was the cleaner fix regardless.
</content>
</invoke>
