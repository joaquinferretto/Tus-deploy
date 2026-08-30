# TUS Locale, Support, SEO, and Transport Specification

## Purpose

Align public web language, ARS presentation, support handoff, discoverability, and API transport behavior with the existing contracts and route boundaries.

## Requirements

### Requirement: Canonical en-AR presentation

The web document, metadata, manifest, dates, numbers, and English visible copy MUST use one canonical `en-AR` locale. Monetary values identified as ARS MUST use locale-aware ARS formatting; server-provided currency and financial meaning MUST remain authoritative.

#### Scenario: Consistent document and amount language

- GIVEN a public page contains English copy and an ARS amount
- WHEN metadata and values are inspected
- THEN the document declares `en-AR`, the amount uses locale-aware ARS formatting, and no conflicting Spanish language claim is emitted

#### Scenario: Foreign or missing currency fact

- GIVEN a server response supplies another currency or no financial acknowledgement
- WHEN a value renders
- THEN the supplied currency or non-success state is preserved and the UI does not relabel it as ARS payment or settlement

### Requirement: Normalized API URL transport

The web client MUST normalize the configured API base URL so exactly one separator joins it to every route. Normalization MUST preserve HTTP method, tenant/actor/correlation headers, authorization, request bodies, and idempotency keys.

#### Scenario: Base URL with trailing slash

- GIVEN `NEXT_PUBLIC_API_URL` ends with one or more slashes
- WHEN a TUS route is requested
- THEN the request URL contains one separator before the route and all existing contract headers and body fields are unchanged

#### Scenario: Default base URL

- GIVEN no API URL is configured
- WHEN a request is composed
- THEN the documented local default is used with the same route and no malformed double-slash URL

### Requirement: Governed support and public SEO handoff

Support or WhatsApp actions MUST clearly identify consent, authorization, and the existing handoff contract; credentials and sensitive actions MUST remain in authenticated TUS flows. Standard robots and sitemap exposure MUST describe only intended public routes and MUST NOT expose protected tenant surfaces.

#### Scenario: Authorized support handoff

- GIVEN an authorized user chooses a supported handoff with the required confirmation
- WHEN the action is submitted
- THEN the existing server route receives the tenant-scoped contract, the UI reports only the returned handoff state, and no payment or settlement success is inferred

#### Scenario: Public crawler request

- GIVEN a crawler requests robots or sitemap metadata
- WHEN the metadata is generated
- THEN public entry routes are represented, protected routes are excluded, and canonical locale/URL metadata is consistent
