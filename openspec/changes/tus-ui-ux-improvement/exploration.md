## Exploration: TUS UI/UX improvement

### Current State
The repository contains contract-backed TUS web and mobile surfaces, but the current implementation is not yet a production-complete customer or staff experience.

The web route at `apps/web/src/app/page.tsx` is still a Turborepo boilerplate landing page. The TUS routes provide a visually intentional dashboard, POS, and operations shell, but they depend on a session already being placed in `sessionStorage`; there is no sign-in journey or actionable recovery path when the session is absent. The dashboard loads discovery, commitments, merchant operations, and reporting concurrently and renders explicit loading, empty, disabled, error, and conflict-oriented messages. The operations route reports stale data but offers no refresh action. The surface switcher uses buttons inside navigation with `aria-current`, rather than a clearly modeled tab or route-navigation pattern.

The web POS has labeled product/service and amount controls, server acknowledgement feedback, and an idempotency key for manual operations. Marketplace checkout creates a cart and request hash but the inspected request body has no explicit idempotency key. Checkout/service actions are intentionally bounded and do not claim payment or settlement success. Web locale formatting uses `es-AR`, but `apps/web/src/app/layout.tsx` declares `lang="en"`; the PWA manifest has an empty icon list.

The mobile auth route is explicitly a placeholder (`apps/mobile/app/(auth)/login.tsx:7-10`). The protected home and POS are functional contract/demo surfaces rather than a complete product flow. Mobile POS does include encrypted local queue restoration, product/service separation, offline simulation, pending counts, sync controls, accessibility roles, and truthful feedback. However, `recordManualOperation()` and `syncPending()` do not catch transport failures, so a rejected request can leave submission state stuck or produce an unhandled rejection. The mode controls also lack an enclosing radiogroup label.

The latest Web Interface Guidelines cross-check confirms additional web gaps: no skip link or visible `:focus-visible` treatment is evident in the inspected web layout/styles; stateful dashboard tabs are not reflected in the URL; POS controls lack meaningful `name`/`autocomplete` attributes; loading copy uses periods in places where the guideline requires an ellipsis; no reduced-motion rule or intentional `touch-action` policy is present; and the manifest theme color does not match the light page background. The existing implementation does use semantic links/buttons, clickable wrapping labels, `Intl.NumberFormat('es-AR')`, empty-state handling, and live/alert state messaging in several surfaces.

Prior SDD artifacts require a careful truth-boundary correction. `tus-production-completion` and later apply-progress documents describe completed UI and verification work, while the big-picture exploration correctly describes the broader product as static shells and typed seams. The later implementation supersedes some earlier findings (for example, mobile POS now uses the mobile client and the web client now sends JSON/auth headers), but the completion claims still represent deterministic contract evidence, not browser/device UX proof. No formal `sdd-verify` or review lifecycle was run after those phases, by instruction.

Validation evidence is mixed:

| Check | Result | Evidence boundary |
|---|---|---|
| `pnpm test -- tests/foundation/p9-ui-contract.test.mjs` | 7 passed, 0 failed | Static/UI contract harness; not browser rendering |
| Mobile POS Jest test | 5 passed, 0 failed | Focused unit behavior; not device UX |
| Web and mobile typecheck | Passed | Compile-time only |
| `pnpm contracts:validate` | Passed with Ajv unknown-format warnings | Contract validation only |
| `pnpm run security:scan` | Passed | Tracked-secret scan only |
| `pnpm build` | Passed in the captured run; Turbo reported four successful build tasks | Build evidence; not runtime UX |
| `pnpm --filter @factory/web test` | Exit 0 because the script is a no-op | No web behavior evidence |
| Mobile lint | Failed on `tests/unit/tus-pos.test.ts:62` (`require()` and `import()` type annotation rules) | Concrete lint failure |
| Web lint | Interactive ESLint setup prompt; no pass claimed | Configuration/environment gap |
| Root `pnpm typecheck` | Failed because Turbo has no `typecheck` task | Workspace validation gap |
| Browser smoke | Not completed; dev process was not stable and production start could not find `.next` | No browser evidence |
| PostgreSQL HTTP smoke | Explicitly deferred without authorized `TUS_POSTGRES_URL` | No live database evidence |

### Affected Areas
- `apps/web/src/app/page.tsx` — replace the generic entry surface with a product-oriented landing/auth boundary.
- `apps/web/src/app/layout.tsx` — correct document language and review metadata/accessibility defaults.
- `apps/web/src/app/manifest.ts` — provide real PWA icons and verify install metadata.
- `apps/web/src/app/globals.css` — evolve the existing earthy visual system into a reusable, responsive, accessible design system rather than adding isolated styling.
- `apps/web/src/app/tus/tus-dashboard.tsx` — complete session recovery, navigation semantics, checkout feedback, refresh behavior, responsive layout, and actionable empty/error states.
- `apps/web/src/app/tus/tus-pos.tsx` — harden validation, error recovery, loading semantics, and staff-speed interaction behavior.
- `apps/web/src/app/tus/tus-operations.tsx` — add refresh/recovery actions and make stale/report/support states actionable.
- `apps/web/src/app/tus/tus-ui.tsx` and `apps/web/src/lib/tus-ui-contract.ts` — centralize state announcements, status semantics, and copy without weakening the server-truth boundary.
- `apps/web/src/lib/tus-client.ts` — add or explicitly document marketplace checkout idempotency and preserve request/response error semantics.
- `apps/mobile/app/(auth)/login.tsx` — implement the approved authentication journey or keep the route visibly blocked with a clear product-level handoff; the current placeholder cannot represent a shippable app.
- `apps/mobile/app/(app)/index.tsx` — turn the protected home into a useful staff landing surface with navigation, session recovery, and accessible layout behavior.
- `apps/mobile/app/(app)/pos.tsx` — handle rejected network/storage operations, expose a labeled radiogroup, improve keyboard/screen-reader behavior, and test narrow/large devices.
- `apps/mobile/src/application/tus-client.ts` and `apps/mobile/src/store/app-store.ts` — preserve queue/conflict contracts while supporting UI retry and recovery states.
- `tests/foundation/p9-ui-contract.test.mjs` — retain contract tests but add render/integration coverage that exercises actual web components.
- `apps/mobile/tests/unit/tus-pos.test.ts` — fix the current lint error and expand failure/retry/accessibility coverage.
- `openspec/changes/tus-platform-vision/`, `tus-big-picture-mvp/`, and `tus-production-completion/` — reconcile historical completion language with the verified evidence boundary; do not treat deterministic checks as browser, device, provider, or production proof.

### Approaches
1. **Incremental surface hardening** — keep the existing TUS contracts and visual direction, then implement the missing auth/session boundary, web/mobile state recovery, accessibility semantics, responsive behavior, PWA metadata, and real component-level tests in dependency order.
   - Pros: Preserves working contract-backed logic, keeps scope aligned with the existing SDD, and delivers measurable UX improvements without reopening backend architecture.
   - Cons: The current page and mobile auth placeholder still require substantial product work; visual coherence can remain uneven if the design system is not addressed first.
   - Effort: Medium

2. **Experience reset around a new design system** — replace the current web dashboard/mobile screens with a unified Argentina-first information architecture and component system before reconnecting the existing contracts.
   - Pros: Best opportunity to remove boilerplate/scaffold feel, establish consistent responsive/accessibility primitives, and make customer/staff journeys coherent.
   - Cons: Higher regression and integration risk; easy to lose the existing truthful pending/conflict/disabled boundaries; requires broader design validation before implementation.
   - Effort: High

### Recommendation
Use incremental surface hardening with a short design-system foundation slice. The first slice is **truthful product entry and session recovery**, including the approved web/mobile auth handoff, explicit unauthenticated and expired-session states, shared status/live-region primitives, and tests for those boundaries. Auth/session truthfulness is included because both frontends currently depend on pre-existing credentials and otherwise end in a dead-end placeholder/disabled state. Then harden dashboard discovery/commitment/operations, web POS, mobile home/POS, and finally add browser/device-level evidence. Preserve the existing server-truth contract model and never convert deterministic, deferred, or unavailable states into success claims.

Prioritize work in this order:
1. P0: truthful authentication/session entry and recovery across web and mobile; prevent dead-end disabled screens.
2. P0: mobile POS rejection handling and web checkout idempotency semantics.
3. P1: responsive/accessibility semantics, actionable stale/error/empty/conflict states, and Argentina-first document/PWA metadata.
4. P1: replace boilerplate landing and scaffold copy with real customer/staff navigation.
5. P1: real web component/browser and mobile device coverage; keep contract/unit tests as lower-level evidence.
6. P2: visual polish, motion/reduced-motion behavior, and richer support/WhatsApp handoff once authorization exists.

### Risks
- A UI rewrite could accidentally claim payment, settlement, fulfillment, or support completion where the backend only provides pending/deferred evidence.
- The current web test command is a no-op, so passing package tests must not be reported as web UX verification.
- Browser runtime evidence is still missing because local server startup/build resolution is unstable in the current workspace invocation.
- Mobile POS network failures can leave the interface in a submitting state or surface as unhandled rejections.
- The web checkout request lacks explicit idempotency even though the POS path supplies one; retries could create duplicate commitment attempts unless the API contract guarantees equivalent deduplication.
- Historical SDD artifacts contain stale counts and broad completion wording; future proposals must cite current commands and evidence classes rather than copying prior summaries.
- Accessibility semantics are only partially implemented; adding roles without complete keyboard/focus/announcement behavior may create misleading assistive-technology output.
- The empty manifest icon list and incorrect document language weaken installability, discoverability, and Argentina-first usability.

### Ready for Proposal
Yes. The first proposal slice is selected autonomously: truthful authentication/session entry and recovery plus shared status/accessibility foundations. The proposal must preserve the evidence boundary between deterministic contract tests and real browser/device validation.
