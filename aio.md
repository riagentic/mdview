# aio framework notes (from mdview compat passes)

Project verified against **aio v1.0.2-beta** (`dep/aio` →
`~/.local/lib/aio-versions/v1.0.2-beta`).
Status: ✅ fully compatible. Checks: `deno check` ✓ · `aiol` 0 warnings / 0 hints ✓ ·
89/89 tests ✓ · `am fix --dry-run` clean ✓ · boots (source), errors=0 and zero
renderer warnings ✓.

## alpha75 → v1.0.2-beta — what actually changed for this app

The framework froze its public surface at 1.0.0-beta, so there was no surface
migration. Three things the newer harness/build enforce did need work:

- **`testCell` now refuses framework effects it cannot run.** A `schedule.*` or
  `own.*` effect emitted by a method throws under `testCell` (no clock, no
  resource table) instead of being dropped silently — and an emitted effect the
  test never reads is refused at the end of the test too. `requestOpen` schedules
  a follow-up (`mdview:scan-workspace`) and `setWorkspace`/`requestOpenFolder`
  acquire the `mdview:watcher`, so every test that actually opens a document now
  boots the standalone runtime with `bootCells([mdview])` instead. The tests that
  never reach an effect (guard-line no-ops, theme, fs-error) stay on `testCell`.
- **Fuzz needs an explicit skip list.** `t.fuzz({ n, skip })` replaced the bare
  `randomActions`; the boot-only methods above must be skipped or the fuzzer's
  random dispatch hits one and fails on the effect, not on an invariant. Skip by
  bare method name.
- **Method arity is a runtime warning.** aio counts a parameter unless its
  signature gives a default (a TS `?` is erased). Every command-style method that
  the UI or fuzzer can call with no args now carries a default
  (`setScroll(s, y = 0)`), which silences it and is what the warning asks for.

## aiol post-await read hints — gather, don't pin

`aiol` hints when an async method reads `s.*` after an `await` (a commit point).
All fourteen were resolved by moving the reads to before the first await
(gather-then-write). The one deliberately live read — `searchWorkspace`'s
stale-response guard (`s.searchQuery === query`) — is marked
`// aio-ok: live re-read is the stale-response guard`. The cell is
`transaction: false` on purpose, so a pinned entry snapshot is exactly what that
guard must not use.

## Electron's Content-Security-Policy warning

Every Electron run — dev **and** packaged — prints "Insecure
Content-Security-Policy" unless the CSP restricts scripts. aio's default
(`"basic"`) deliberately says nothing about scripts, so it does not satisfy the
check. `app.ts` opts into `security: { csp: 'strict' }` and widens only `img-src`
(`'self' data: blob: https: http:`) because mdview renders remote documents whose
images load from the web. See `dep/aio/docs/clients/electron.md`.

## Framework bug — aio's server graph + jsdom ≥ 27 (alpha-era; pin retained)

- **Symptom**: the app never boots. No aio frame, no app name, nothing to grep for:

  ```
  warning: module evaluation pending but no stalled top-level await found, retrying event loop iteration (1/10)
  …
  error: Module evaluation is still pending after multiple event loop iterations,
  but no stalled top-level await was found. This is a bug in Deno.
  ```

- **Trigger**: `import 'aio'` (specifically `src/server/server.ts`'s graph) **evaluated
  before** jsdom ≥ 27, in one module graph. Bisected on Deno 2.9.1:

  | graph                                       | result |
  | ------------------------------------------- | ------ |
  | `aio` alone / jsdom alone (any version)      | ✅ ok  |
  | `aio` → `jsdom@26`                           | ✅ ok  |
  | `aio` → `jsdom@27` / `jsdom@28`              | 💥 stall |
  | `jsdom@28` → `aio` (**reversed order**)      | ✅ ok  |
  | `aio` → `dompurify` (no jsdom)               | ✅ ok  |
  | `aio` → *dynamic* `import('jsdom')` at runtime | ✅ ok  |

- **How it reached mdview**: `isomorphic-dompurify@2.36` hard-requires `jsdom ^28`
  and reaches it through a CJS `require()` **during module evaluation**. Fixed on
  the mdview side by dropping it: `lib/md.ts` runs DOMPurify over a throwaway
  JSDOM window itself and pins `jsdom@^26`.

- **Status at v1.0.2-beta**: a `jsdom@^28` build booted cleanly 3/3 times, source
  and tests — so this may be fixed upstream, but three boots is not evidence
  enough to retire a high-severity boot-time workaround (the original bisection
  was deterministic). The `^26` pin stays until upstream says which release
  addressed the module-loader interaction. Bumping jsdom is a **boot-time**
  failure, so `deno check` cannot catch a regression — verify by booting.

- **Severity**: high (app does not start), low reach (needs a CJS-bridged npm dep).
