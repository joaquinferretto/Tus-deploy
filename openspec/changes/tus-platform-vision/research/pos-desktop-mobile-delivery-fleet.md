# Research: POS web/desktop/mobile and TUS-managed delivery fleet

**Change:** `tus-platform-vision`  
**Retrieved:** 2026-08-25  
**Scope:** POS parity across web/PWA, optional native desktop packaging, and Expo/React Native mobile operations; bounded delivery operations owned and managed by TUS.

## Executive findings

1. **Make the web/PWA the desktop parity baseline.** A responsive merchant/POS surface should remain fully usable in a browser and installable as a PWA. A native desktop shell can later package the same web surface for hardware access, but it must not become the only place where POS capabilities exist.
2. **Use mobile for staff-first and fulfillment-first operations.** Expo/React Native is the appropriate surface for handheld POS/manual capture, shifts, appointments, inventory, pickup/delivery handoffs, proof capture, and operational alerts. It already has the repository's strongest native/offline building blocks, but complete transaction sync and reconciliation are not implemented yet.
3. **Keep desktop hardware behind capability adapters.** Browser printing is broadly available through the print dialog, while Web Serial, WebHID, and WebUSB are permissioned, browser-dependent APIs. Direct thermal printers, scanners, cash drawers, and payment terminals therefore need an explicit compatibility matrix and a native-bridge fallback rather than hard-coded browser assumptions.
4. **Treat TUS delivery as an internal operations context.** TUS may operate shifts, zones, assignments, courier/staff access, incidents, proof, and support. It must not become an open driver marketplace, bidding system, ride-hailing product, rental product, or Uber-like autonomous dispatch network.
5. **Separate delivery proof from settlement release.** Delivery evidence can establish operational facts and support disputes. It does not release funds by itself. Explicit customer confirmation releases the pending settlement immediately; approved no-feedback baseline policies may release services after 12 hours following completion evidence or online/long shipments after 24 hours following accepted delivery evidence. Simple/local internal delivery uses a more lenient configurable context/risk policy with no fixed duration selected yet. Any dispute, chargeback, fraud/risk signal, missing evidence, or unresolved incident freezes settlement regardless of elapsed time.

## Current repository evidence

The repository is a foundation monorepo rather than a completed TUS POS implementation. The following facts are verified and should shape the design without overstating current capability:

| Area | Observed evidence | Design implication |
|---|---|---|
| Web | `apps/web` uses Next.js 15, React 19, Zustand 5, TanStack Query, and shared Zod schemas. | Keep browser/PWA as a first-class client of typed application contracts. |
| Mobile | `apps/mobile` uses Expo 54, React Native 0.81, Expo Router, NetInfo, TanStack Query persistence, MMKV, SecureStore, and Zod. | Use native mobile for staff and fulfillment workflows, with secure local state and explicit connectivity handling. |
| Mobile runtime | `app.config.ts` already exposes `offlineCache`, `strictTls`, profile-specific API configuration, and secure-store dependencies. | The runtime has useful prerequisites, but flags are not proof of an offline transaction ledger. |
| Offline query setup | CodeGraph identified `OfflineQueryClientSetup` and `OfflineQueryClientOptions` in `apps/mobile/src/core/services/query-client.ts`. | Cached reads and retry behavior exist as a foundation; writes still need an idempotent command queue and reconciliation policy. |
| API persistence | CodeGraph identified `PostgresQueryExecutor` and `PostgresOutboxAdapter`. | Server commands/events can use durable persistence and outbox publication; POS sync must define its own conflict and replay contracts. |
| Application state | The protected mobile home is still an app shell, not a completed POS. | Research must distinguish architectural readiness from delivered business functionality. |

## Surface architecture

### Recommended surface split

| Surface | Primary users | Complete Stage 1 responsibility | Native-only responsibility |
|---|---|---|---|
| Web/PWA | Merchant owners, admins, staff, customers, TUS operations | Merchant setup, catalog, pricing, products, services/appointments, orders/commitments, POS/manual operations, shifts, reports, delivery visibility, support, and customer flows. | None required for the baseline; browser permissions and print dialog are acceptable for the first hardware tier. |
| Optional desktop shell | High-throughput merchant staff and TUS operations | Package the same web/PWA experience, offline assets, update channel, and selected hardware bridges. | Direct device access only where browser capability is insufficient and the device decision gate approves it. |
| Expo/React Native mobile | Staff, TUS fleet operators/couriers, optional customers | Mobile POS/manual capture, shifts, appointments, inventory, pickup/delivery task execution, proof capture, status, alerts, and offline-tolerant workflows. | Camera, native storage, push notifications, device permissions, and approved hardware integrations. |
| Platform operations | TUS support, finance, trust, fleet operations | Reconciliation, disputes, assignments, incidents, proof review, policy controls, and audited support sessions. | No hidden bypass of merchant/customer authorization. |

The web and mobile clients should share identifiers, command/event schemas, validation rules, permissions, and lifecycle vocabulary, but not force identical layouts or platform behavior. The web/PWA must not be a reduced prototype if the product promise includes complete POS; mobile must not be treated as a read-only companion when Stage 1 explicitly includes mobile POS/manual operations.

### Desktop shell decision gate

The current exploration correctly leaves Electron/Tauri unselected. Decide only after measuring the first hardware set and the operational need for a managed shell:

| Option | Strengths | Costs/risks | Fit |
|---|---|---|---|
| Browser/PWA only | Lowest distribution and maintenance burden; direct alignment with web; installable; fast updates. | Device APIs are permissioned and uneven; receipt/cash-drawer/payment-terminal support can be constrained. | Required baseline and acceptable for software-only or browser-print deployments. |
| Electron shell | Mature desktop process model, broad Node/native ecosystem, straightforward access to local devices. | Larger footprint; main/renderer/preload boundaries, IPC validation, auto-update security, and dependency attack surface require strong discipline. | Good only if several hardware devices require stable native integration and the footprint is acceptable. |
| Tauri shell | Smaller native footprint and strong web/native boundary; Rust-based native layer. | Plugin/native integration work is more specialized; device support still needs per-model validation and secure command boundaries. | Worth evaluating when low footprint matters and the team can own Rust/native adapters. |

**Recommendation:** implement the POS as a complete web/PWA capability first, then run a hardware pilot. Select a shell only for verified gaps such as silent thermal printing, cash-drawer control, scanner reliability, payment-terminal integration, or kiosk/device management. The shell must package the same typed application surface rather than create a second POS domain.

## POS capability and hardware matrix

| Capability | Browser/PWA baseline | Desktop shell or native mobile | Required product decision |
|---|---|---|---|
| Product/service search and sale | Fully supported in web/PWA; responsive staff layout. | Mobile optimized for scan/search and quick actions. | Product and service commitments remain separate in MVP. |
| Staff login and permissions | Authenticated web session with scoped roles. | Secure local session/token handling and device logout. | Shift/device scope and re-authentication for sensitive actions. |
| Cash shift open/close | Browser workflow and server ledger. | Optional cash drawer/device bridge. | Define counted cash, variance, approval, void, and close rules. |
| Receipt | `window.print()` and printable receipt HTML. | Silent thermal printing or native print bridge if required. | Choose supported printer models and fallback behavior. |
| Barcode scanner | Keyboard-emulation scanners generally work as input devices. | Native/USB/Bluetooth SDK may be needed for non-keyboard scanners. | Define scan contract, duplicate handling, and offline behavior. |
| Cash drawer | Usually indirect through a receipt printer; browser cannot assume direct control. | Native bridge/driver likely required. | Hardware pilot and explicit compatibility list. |
| Payment terminal | Hosted/provider checkout or approved terminal integration. | Native SDK/bridge may be required. | Never collect card credentials in web/mobile application code; validate provider contract. |
| Inventory adjustment | Online command with audit and idempotency. | Offline queue may be useful for handheld operations. | Conflict policy for stock and serial/asset adjustments. |
| Service appointment/check-in | Web calendar and staff workflow. | Mobile check-in and job execution. | Check-in is evidence of arrival/start, not settlement release. |
| Delivery handoff/proof | Web operations review and merchant visibility. | Mobile camera, timestamp, location/OTP/signature as approved. | Proof supports operations/disputes; customer confirmation controls settlement. |
| Offline sale/manual record | PWA cache can support shell and reads, but browser transaction durability needs explicit design. | React Native has stronger local storage/connectivity primitives. | Define queue, idempotency key, replay, conflicts, refunds, and receipt status before claiming offline POS. |

### Hardware boundary

Browser APIs can be useful for a controlled first tier:

- `window.print()` provides a portable print-dialog fallback.
- Web Serial can communicate with selected serial devices after user permission.
- WebHID can communicate with selected HID devices after user permission.
- WebUSB can communicate with selected USB devices after user permission.

These APIs do not establish universal POS hardware compatibility. Browser/version support, operating-system drivers, permission prompts, device firmware, kiosk policy, and vendor protocols all affect reliability. Each adapter should expose a capability/health result and a safe fallback, not silently assume that a device is present.

## Offline and synchronization model

Offline POS is not equivalent to persisted query cache. The minimum safe design is:

1. **Read model:** cache catalog, prices, staff permissions, tax/display references, active shift, and relevant appointments with version/freshness metadata.
2. **Command envelope:** every local write has a stable device ID, operation ID/idempotency key, actor, tenant, aggregate/context, expected version where applicable, created-at time, and payload schema version.
3. **Local queue:** store pending commands durably and show whether a receipt or operation is local-pending, accepted, rejected, or reconciled.
4. **Server replay:** accept commands idempotently through the API, write authoritative state and outbox events transactionally, and return a durable result.
5. **Conflict policy:** never blindly last-write-wins for money, stock, shift close, appointment capacity, or settlement state. Use context-specific rejection, merge, or operator review.
6. **Recovery:** retry with backoff; expose dead-letter/review states; permit safe retry without duplicate sale, payment, inventory movement, delivery status, or settlement release.
7. **Security:** encrypt or minimize local sensitive data, expire sessions, support remote device disablement, and prevent a stale device from creating unbounded financial exposure.

The first offline release should be explicit about what is allowed offline. A safer progression is cached reads and manual records first, then bounded offline sale capture with configured limits, then payment-terminal/offline-payment support only after provider and legal validation. A local record must never imply that funds were captured or a merchant settlement was released.

## TUS-managed delivery operations

### Bounded operating loop

The recommended Stage 1 loop is an internal TUS operations workflow:

1. A product commitment requests delivery or pickup and records address, service area, time window, contact, and handoff policy.
2. Merchant marks the package/order ready, or TUS operations records a pickup-ready exception.
3. TUS operations validates zone, shift, capacity, and eligibility, then assigns a TUS-managed courier/operator or approved operational resource.
4. The assigned actor accepts or rejects the task; rejection/timeout becomes an operations exception, not an open-market bid.
5. Pickup is recorded with actor/time/evidence; the task moves in transit.
6. Delivery/handoff records the selected proof set and recipient/customer outcome.
7. Success, failure, return, cancellation, or incident is reconciled against the original commitment; support can inspect the timeline.
8. Customer confirmation remains a separate explicit action that releases the pending settlement immediately. No delivery status releases funds by itself; only the approved context-sensitive no-feedback policy may release after the applicable baseline window, and risk/dispute/evidence incidents always freeze settlement.

Suggested delivery task states are `requested`, `ready`, `assigned`, `accepted`, `picked_up`, `in_transit`, `delivered`, `failed`, `returned`, `cancelled`, and `incident_review`. The exact event names remain specification work, but the delivery context must own them rather than reuse product-order or payment states.

### Operational roles and controls

- **TUS fleet operations:** zones, shifts, assignment, capacity, exception handling, incident review, proof review, and operational reporting.
- **Courier/operator:** only assigned task data, status transitions, navigation/contact details required for the task, and approved proof capture.
- **Merchant:** readiness, package/hand-off information, customer communication, and delivery visibility appropriate to the commitment.
- **Customer:** delivery instructions, status, recipient confirmation, issue reporting, and explicit commercial confirmation.
- **TUS support/finance/trust:** audited evidence review, dispute handling, reconciliation, refunds/adjustments, and policy escalation.

The model deliberately excludes open courier registration, driver bidding, dynamic marketplace pricing, ride-hailing, continuous autonomous dispatch, vehicle rental, and unrestricted location surveillance. If TUS later needs route optimization or a public courier marketplace, that is a separate product/compliance change.

### Proof and dispute evidence

Possible evidence types should be configurable by delivery method and risk: timestamped status, actor identity, pickup scan, recipient name/OTP, signature, photo, geolocation where lawful and necessary, and customer message/confirmation. Evidence must record provenance, consent/notice where required, retention policy, and tamper/audit metadata.

Evidence answers “what operational event was recorded?” It does not answer “should funds be released?” The settlement context must consume approved completion evidence plus explicit customer confirmation or the applicable context-sensitive no-feedback policy, preserve pending/disputed states, and create compensating ledger entries for refunds, chargebacks, or adjustments. Reminders, disclosure, dispute opening, and auditable support review remain required controls.

## POS and delivery interaction rules

- POS/manual sales can create a product commitment and a delivery request, but delivery assignment must not mutate the product state machine into courier-specific states.
- A failed delivery can produce return/refund/support actions; it does not silently mark the underlying sale completed or release the merchant settlement.
- A service appointment check-in is not a delivery event and is not sufficient for commission release.
- Mobile proof capture and desktop operations review must use the same evidence contract and audit IDs.
- Web/PWA, desktop shell, and mobile must present consistent commitment/payment/settlement status even when one client is offline.
- Offline-created delivery or POS commands must be replay-safe and visibly pending until server acceptance; local timestamps cannot substitute for authoritative server ordering.

## Argentina launch dependencies

This is product/architecture research, not legal advice. Before production launch, TUS needs country-specific legal and provider validation for:

- personal-data processing, consent, access/deletion requests, retention, location data, photos, and support transcripts;
- consumer information, cancellation/refund/complaint obligations, receipts, delivery commitments, and platform disclosures;
- TUS's role in collecting and settling funds, provider account capabilities, KYC/KYB, sanctions/fraud controls, reconciliation, reserves, chargebacks, payout failures, and tax evidence;
- employment/contractor, occupational safety, accident, insurance, and supervision obligations for TUS-managed fleet operations;
- tax registration, invoicing/receipts, numbering, corrections, and the current ARCA/provider integration path;
- accessibility, security incident response, evidence retention, and cross-border/data-residency requirements as the architecture globalizes.

The relevant official starting points consulted were AAIP personal-data guidance, Argentina consumer guidance, SRT, Trabajo, ARCA, and the text of Ley 20.744. These sources identify dependency areas; they do not establish that the proposed TUS operating model is legally approved.

## Recommendation for proposal/design

Carry forward **capability-composed POS and delivery contexts**:

- Build a complete web/PWA POS and merchant operations surface as the desktop parity contract.
- Build Expo/React Native mobile workflows for staff, handheld POS/manual operations, appointments, inventory, fleet tasks, and proof.
- Add a native desktop shell only after a hardware pilot demonstrates browser gaps; keep Electron/Tauri as an explicit decision gate, not an architectural dependency.
- Define a durable offline command/reconciliation contract before describing offline POS as complete.
- Model TUS-managed delivery as a bounded internal operations context with assignments, shifts, zones, proof, incidents, and support; do not model a public driver marketplace.
- Keep customer confirmation as the preferred release trigger; allow only the approved context-sensitive no-feedback policies, never delivery proof alone or an unbounded timeout, and freeze for risk/dispute/evidence incidents.
- Reuse existing tenancy, authorization, contracts, outbox, audit, persistence, provider, and observability boundaries without adding TUS policy to neutral factory packages.

## Sources and retrieval notes

### PWA, browser device access, and printing

- Web.dev, PWA installation: https://web.dev/learn/pwa/installation
- Web.dev, offline cookbook: https://web.dev/articles/offline-cookbook
- MDN, offline/background operation: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
- MDN, IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN, Web Serial API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- MDN, WebHID API: https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API
- MDN, WebUSB API: https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API
- MDN, `window.print()`: https://developer.mozilla.org/en-US/docs/Web/API/Window/print

### Desktop shells

- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron updates: https://www.electronjs.org/docs/latest/tutorial/updates
- Tauri architecture: https://v2.tauri.app/concept/architecture/
- Tauri updater: https://v2.tauri.app/plugin/updater/
- Tauri security: https://v2.tauri.app/security/

### POS patterns

- Shopify POS staff management: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/staff-management
- Shopify POS staff roles: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/staff-management/understanding-pos-staff-management
- Shopify POS offline selling: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline
- Shopify cash register management: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management
- Shopify POS hardware: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/hardware
- Square offline payments: https://squareup.com/help/us/en/article/5095-offline-payments-with-square
- Odoo POS: https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html
- Odoo employee login: https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/employee_login.html
- Odoo receipts/invoices: https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/receipts_invoices.html
- Odoo POS hardware: https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/pos_hardware.html
- Odoo POS IoT: https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/configuration/pos_iot.html
- Odoo Mercado Pago terminal: https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods/terminals/mercado_pago.html

### Delivery operations and proof

- Uber Direct introduction: https://developer.uber.com/docs/deliveries/introduction
- Uber Direct proof of delivery: https://developer.uber.com/docs/deliveries/guides/proof-of-delivery
- Uber Direct delivery status webhook: https://developer.uber.com/docs/deliveries/guides/delivery-status-webhook
- Onfleet documentation index: https://docs.onfleet.com/llms.txt
- Onfleet create task reference: https://docs.onfleet.com/reference/create-task

### Argentina dependency areas

- AAIP personal data: https://www.argentina.gob.ar/aaip/datospersonales
- Consumer protection: https://www.argentina.gob.ar/produccion/consumidor
- SRT: https://www.argentina.gob.ar/srt
- Trabajo: https://www.argentina.gob.ar/trabajo
- ARCA: https://www.argentina.gob.ar/arca
- Ley 20.744 text: https://www.argentina.gob.ar/normativa/nacional/ley-20744-25552/texto

## Limitations

- Several official vendor pages were blocked or unavailable during retrieval: Shopify receipt/order pages and some hardware pages returned 403; a Square sandbox URL returned 404; DoorDash documentation returned 403. The research uses accessible official pages and does not infer missing vendor behavior.
- The initially guessed Odoo IoT and Onfleet overview URLs were unavailable; corrected official URLs above were used.
- No hardware pilot, payment-provider contract review, browser compatibility matrix, device security test, or Argentina legal opinion was performed.
- The repository evidence confirms foundations and boundaries, not a completed POS, offline financial ledger, delivery dispatch system, or approved settlement operating model.
