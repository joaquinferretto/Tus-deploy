# TUS domain, DNS, TLS, and CORS contract

This document defines the checked-in public-domain contract. It is not proof that
DNS, certificates, or cloud services are currently configured.

## Canonical names

- Customer web origin: `https://tusservicios.com`.
- Optional redirect origin: `https://www.tusservicios.com`.
- API origin: an owner-approved HTTPS host configured through
  `NEXT_PUBLIC_API_URL`/`API_BASE_URL`; the values must agree exactly.
- Mobile API origin: `EXPO_PUBLIC_API_URL` and HTTPS is required outside local
  development.

The canonical web and API values are public configuration, never credentials.
They must not contain a username, password, query string, or fragment.

## DNS and TLS checklist

1. Register the apex and `www` records with the domain owner and point them only
   at the approved Vercel project; do not add an untracked provider or fallback.
2. Point the API hostname only at the approved Render API service.
3. Verify authoritative DNS resolution for A/AAAA/CNAME records and document the
   observation time, owner, and TTL without copying provider secrets.
4. Require a valid certificate chain, automatic renewal, HTTPS-only redirects,
   and HSTS after the production domain is proven. Local HTTP is limited to the
   explicit development profile.
5. Record certificate expiry and renewal alerts. An expired, mismatched, or
   owner-unauthorized certificate blocks the affected surface.

## CORS contract

The API allowlist is the explicit `CORS_ORIGINS` list. It must contain the exact
HTTPS web origins that are authorized for the selected profile; wildcard origins
are not a production contract. Requests from another origin are denied, while
correlation, authorization, tenant, session, request, and idempotency headers
remain explicitly listed. CORS evidence is deterministic until an authorized
browser/cloud smoke proves the live configuration.

## Rollback

If DNS or TLS points at the wrong service, stop intake for the affected surface,
restore the last owner-approved DNS/certificate configuration, and rerun health,
readiness, CORS, and browser checks. Do not silently redirect traffic to Compose
or another domain. Preserve audit, ledger, outbox, and DLQ records.
