# TUS Product Hardening Runtime Evidence

schema: `gentle-ai.runtime-evidence/v1`
change: `tus-product-hardening`
phase: single bounded local runtime/browser evidence phase
status: `completed-with-external-blocks`
executed_at: `2026-08-31`
evidence_tags: `browser/mobile`, `external-blocked`
liveConformance: `false`

## Executive Summary

The local production API build, production Next web build, browser-visible web
routes, responsive web viewport, and API health route were exercised with finite
requests and browser flows. The web UI rendered fail-closed protected states and
the POS route explicitly presented product/service-oriented local operations and
did not claim provider capture, settlement, or payout.

Authenticated success was not claimed: no safe local credential or fixture was
provided, and the sign-in production bundle attempted `localhost:3001` while the
owned API was intentionally bound to the requested `localhost:3101`. The
existing Expo web export loaded its HTML but failed before rendering with
`Cannot use 'import.meta' outside a module`; this is `external-blocked`, not
mobile success. No native-device, physical-POS, PostgreSQL, provider, Docker,
watcher, migration, seed, write, or deployment evidence was produced.

## Safety and Scope

- Repository: `C:\Users\mmmau\tuscompras-b2b\Goldenrepo-js-py` only.
- Read first: all existing `tus-product-hardening` artifacts, including `postgres-evidence.md`.
- Scope: local API health, web rendering/navigation/interaction, responsive web, mobile web export rendering, and POS presentation.
- No database connection, query, migration, seed, cleanup, write, provider call, Docker, deployment, or review lifecycle was run.
- No credentials, tokens, cookies, database URLs, environment values, or PII were entered or printed.
- Screenshots were captured only from pages with no visible secrets, tokens, or PII.

## Owned Services

Production artifacts existed before the run; no build or watcher was started.

| Service | CWD | Exact argv | Runtime ownership | Result |
|---|---|---|---|---|
| API | `apps/api` | `node.exe dist/index.js` | primary PID `23968`, cluster worker PID `22716` | bound `3101`; health passed |
| Web | `apps/web` | `node.exe node_modules/next/dist/bin/next start -p 3200` | PID `24368`, later PID `12812` after mobile-export swap | bound `3200`; web routes passed |
| Mobile web export | `apps/mobile` | `python.exe -m http.server 3200 --directory dist` | PID `22960` | HTML served, JS render failed |

The detached launchers were temporary `cmd.exe` children used only to detach
owned processes from the command wrapper. They were not retained. Each startup
wait was below 120 seconds for the successful service incarnations. Two earlier
launch-wrapper attempts hit their 120-second command bound or a wrapper
redirection error; both ended with ports clear and no unknown process was
terminated. Browser requests and route probes were bounded at 30 seconds or
less; direct HTTP probes used a 15-second request timeout.

## API Flow

### `browser/mobile` - passed

| Flow | Result |
|---|---|
| `GET http://localhost:3101/health` | HTTP `200`; visible JSON `{"status":"ok","timestamp":"..."}` |
| API console | One `404` for `/favicon.ico`; no application error |
| Database/provider activity | None attempted |

Screenshot: `runtime-api-health.png`

## Web Browser Flows

All routes below were served by the existing production Next build on
`http://localhost:3200`. Desktop viewport was 1280px wide unless noted.

### `browser/mobile` - passed

| Route / flow | Result |
|---|---|
| `/` | HTTP `200`; title `TUS platform`; landing navigation, skip link, five journey cards, evidence boundary, and Argentina copy visible |
| `/sign-in` | HTTP `200`; labelled email/password controls and `Sign in securely` button visible |
| Empty sign-in submit | Inputs became invalid and inline alert `Sign-in could not be confirmed by TUS.` appeared; no credential was entered |
| `/tus` | HTTP `200`; protected state visibly `Disabled` with sign-in action |
| `/tus/operations` | HTTP `200`; protected state visibly `Disabled` with sign-in action |
| `/tus/pos` | HTTP `200`; protected state visibly `Disabled` with sign-in action |
| `/recovery?returnTo=%2Ftus` | HTTP `200` route probe |
| Landing -> Staff POS link | Navigation reached `/tus/pos`; protected state remained disabled |

The empty submit attempted `POST http://localhost:3001/auth/sign-in` and was
refused because no listener existed on 3001. This exposed a production-bundle
port mismatch with the deliberately owned API port 3101. It did not use a
credential and did not reach PostgreSQL or a provider.

Screenshots:

- `runtime-sign-in-empty.png`
- `runtime-tus-unauthenticated.png`
- `runtime-operations-unauthenticated.png`
- `runtime-pos-unauthenticated.png`

### Responsive web checks - `browser/mobile` - passed

At viewport `390x844`:

- Landing route rendered all journey links without horizontal overflow.
- Sign-in route rendered labelled controls without horizontal overflow.
- POS route rendered navigation and the disabled protected state without horizontal overflow.
- Keyboard `Tab` focused the visible skip link.
- The POS route text identified `Local operations only`, server acknowledgement,
  and that provider capture, settlement, and payout remain unclaimed.

Screenshots:

- `runtime-web-mobile-viewport.png`
- `runtime-sign-in-mobile-viewport.png`
- `runtime-pos-mobile-viewport.png`

Accessibility basics observed in the rendered DOM: semantic `main`, heading
hierarchy with an `h1`, labelled form controls, named links/buttons, skip link,
live/status regions on protected states, and zero images missing `alt`. The
rendered sign-in and POS pages had no horizontal overflow.

## Mobile Web Export

### `external-blocked` - deferred

The existing `apps/mobile/dist/index.html` was served on port 3200 after the web
service was stopped. HTML returned successfully, but the browser rendered no
accessible UI and reported:

`Cannot use 'import.meta' outside a module`

The missing favicon generated a separate `404`, but the module error is the
render-blocking result. No export rebuild was attempted. This phase therefore
does not prove Expo web interaction, native mobile behavior, offline radio,
secure storage, or any physical POS hardware behavior.

## POS Product/Service Classification

- Proven: the web POS entry route is framed as bounded business operations, says
  receipts require server acknowledgement, and explicitly withholds provider
  capture, settlement, and payout claims.
- Static-only context: source artifacts define separate product and service
  capture contexts; the unauthenticated browser state does not expose those
  controls for interaction.
- Not proven: authenticated product sale, authenticated service sale, retry,
  conflict, offline replay, receipt persistence, audit/outbox durability, or
  physical POS/payment hardware.

## Route Probe Summary

| Target | Status |
|---|---:|
| `http://localhost:3101/health` | `200` |
| `http://localhost:3200/` | `200` |
| `http://localhost:3200/sign-in` | `200` |
| `http://localhost:3200/tus` | `200` |
| `http://localhost:3200/tus/operations` | `200` |
| `http://localhost:3200/tus/pos` | `200` |
| `http://localhost:3200/recovery?returnTo=%2Ftus` | `200` |

## Cleanup State

Cleanup was performed only after exact command-line verification:

- Stopped owned web PID `12812` (`node.exe node_modules/next/dist/bin/next start -p 3200`).
- Stopped owned mobile-export PID `22960` (`python.exe -m http.server 3200 --directory dist`).
- Stopped owned API primary PID `23968` (`node.exe dist/index.js`) and worker PID `22716` (absolute API dist argv).
- Final port check: 3101 listeners `0`; 3200 listeners `0`.
- Final owned API/web process-pattern check: `0`.
- Unknown processes were not inspected for termination and were not killed.

## Side-Effect Counts

Counts for this phase only:

```json
{
  "connections": 0,
  "migrations": 0,
  "queries": 0,
  "fixtures": 0,
  "seedInvocations": 0,
  "writes": 0,
  "deletes": 0,
  "providerCalls": 0,
  "ownedChildrenStarted": 5,
  "ownedChildrenRemaining": 0
}
```

`connections` means PostgreSQL connections. Local HTTP requests to the API and
web server are recorded above and are not database connections.

## Risks and Blocks

- `external-blocked`: no approved deterministic/local credentials or fixtures were available for authenticated web/API/POS success.
- `external-blocked`: web production bundle targets `localhost:3001`, not the required owned API port `3101`.
- `external-blocked`: Expo web export fails before render with the module error above.
- `external-blocked`: native mobile, physical POS, provider, PostgreSQL, cloud, compliance, and production claims remain outside this evidence.
- Existing Next warning: workspace root inference selected `C:\Users\mmmau\pnpm-lock.yaml` and detected the repository lockfile; no configuration edit was made in this evidence phase.

## Next Recommended

1. Rebuild or configure the web production artifact with the approved local API URL `http://localhost:3101`, then repeat only this bounded runtime phase.
2. Repair/re-export the mobile web artifact before claiming mobile-web interaction.
3. Keep authenticated POS and PostgreSQL durability deferred until approved safe fixtures and disposable target proof are supplied.

## Skill Resolution

- `_shared`: loaded from `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md`.
- `playwright`: loaded from `C:\Users\mmmau\.config\opencode\skills\playwright\SKILL.md`; Playwright MCP browser flow used.
- `nextjs-15`: loaded from `C:\Users\mmmau\.config\opencode\skills\nextjs-15\SKILL.md`.
- `react-19`: loaded from `C:\Users\mmmau\.config\opencode\skills\react-19\SKILL.md`.
- `web-design-guidelines`: loaded from `C:\Users\mmmau\.agents\skills\web-design-guidelines\SKILL.md`; current guideline source fetched and rendered DOM checks applied.
