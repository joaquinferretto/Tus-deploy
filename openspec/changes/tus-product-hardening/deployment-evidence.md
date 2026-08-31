# TUS Product Hardening Deployment Evidence

schema: `gentle-ai.deployment-evidence/v1`
change: `tus-product-hardening`
phase: bounded static deployment-contract correction
executed_at: `2026-08-31T12:27:39-03:00`
repository: `C:\Users\mmmau\tuscompras-b2b\Goldenrepo-js-py`
status: `completed-static-correction`
evidence_tags: `deterministic`, `deployment`, `external-blocked`
liveConformance: `false`

## Executive Summary

The previously identified Render web start mismatch is corrected: the web
service now starts the generated standalone `server.js` entrypoint and passes
Render's platform `PORT` through the package start contract. The API pre-deploy
migration command, canonical `3101` port, Next standalone output, standalone
Docker contract, and active `MONGODB_URL` name remain present. The Python worker
remains an explicitly documented one-shot placeholder. Vercel environment
ownership, values, logs, health, database access, and live deployment remain
external-blocked.

No service, browser, Docker, Compose runtime, database, migration, seed,
provider, Terraform apply, or deployment was started. Runtime secret values
were not read or printed; environment examples were inspected for key names
only.

## Scope and Artifacts

Inspected the current:

- `render.yaml`
- `vercel.json`
- `apps/web/next.config.js`
- root, API, web, and mobile `package.json` scripts
- `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml`
- root, API, web, and mobile `.env.example` key names
- `docs/runbooks/tus-environment-consumer-inventory.md`
- `docs/runbooks/tus-deployment.md`
- `docs/runbooks/local-profiles.md`
- `docs/evidence/tus-deployment.md`
- `scripts/dev/native-profile.mjs`, API server port resolution, web API URL resolver
- Python worker entrypoint and Prisma datasource/migration contract

Updated artifacts:

- `openspec/changes/tus-product-hardening/deployment-evidence.md`
- `render.yaml`
- `apps/web/package.json`
- `docs/runbooks/tus-deployment.md`
- `docs/deployment/render.md`
- `tests/foundation/p8-tus-deployment.test.mjs`

## Passed Contracts

| Area | Current result |
|---|---|
| JSON | Root, API, web, mobile package files and `vercel.json` parse successfully. |
| YAML | `render.yaml` parses with 3 services; `docker-compose.yml` parses with 8 services. |
| Next config | Syntax and load pass; standalone output is enabled; TypeScript and ESLint build errors are not ignored. |
| Render API | Build, `prisma:migrate:deploy` pre-deploy ordering, start command, `/health`, and platform `PORT` fallback are declared. |
| Render web | Build/start shape uses the generated standalone server with platform `PORT`; public URL keys and disabled TUS activation flags are declared. Required URL values remain external settings. |
| Vercel | Next framework, frozen pnpm install, web build, and nested `.next` output are declared; no managed-runtime start command is required. |
| Local ports | Native wrapper supplies API `3101`; API resolves `API_PORT`, then `PORT`, then `3101`; web default remains `3000`; Compose uses API `3101` and web `3000`. |
| Docker output | API image exposes `3101` and starts `dist/index.js`; web image consumes `.next/standalone` and starts `apps/web/server.js`; Next config now enables that output. |
| Environment names | `DATABASE_URL` is the application database key; `NEXT_PUBLIC_API_URL` is the canonical web URL; `EXPO_PUBLIC_API_URL` is the mobile URL; `MONGODB_URL` is the active Mongo name; `API_BASE_URL` remains an agreeing Render alias. |
| Migration contract | API package exposes `prisma:migrate:deploy`; the Render API service invokes it before start. No migration was executed. |

## Exact Checks and Results

Each command below was an independent bounded command with a tool timeout of
60 seconds or less. These are static checks only.

| Check | Exact command | Result |
|---|---|---|
| JSON manifests/package files | `node -e "const fs=require('fs'); const files=['package.json','apps/api/package.json','apps/web/package.json','apps/mobile/package.json','vercel.json']; for (const file of files) JSON.parse(fs.readFileSync(file,'utf8')); console.log('PASS: '+files.length+' JSON files parsed')"` | PASS; 5 files parsed. |
| YAML manifests | `python -c "import yaml; from pathlib import Path; r=yaml.safe_load(Path('render.yaml').read_text(encoding='utf-8')); c=yaml.safe_load(Path('docker-compose.yml').read_text(encoding='utf-8')); assert isinstance(r,dict) and isinstance(r.get('services'),list) and len(r['services'])==3; assert isinstance(c,dict) and isinstance(c.get('services'),dict) and len(c['services'])==8; print('PASS: render.yaml YAML parsed (3 services); docker-compose.yml YAML parsed (8 services)')"` | PASS; both manifests parsed and expected service counts matched. |
| Next config syntax | `node --check apps/web/next.config.js` | PASS; exit 0. |
| Next config load | `node -e "const config=require('./apps/web/next.config.js'); if(config.output!=='standalone'||config.typescript?.ignoreBuildErrors!==false||config.eslint?.ignoreDuringBuilds!==false) throw new Error('Next contract mismatch'); console.log('PASS: Next config loads; standalone output and strict build/lint errors are enabled')"` | PASS. |
| Deployment contract assertions | Inline Node assertions over package scripts, Render/Vercel manifests, Next config, Dockerfiles, Compose, native wrapper, API port resolution, and web URL resolver | PASS; 19 assertions. |
| Example environment inventory | Key-name-only Python extraction over `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`, and `apps/mobile/.env.example` | PASS; names inspected without emitting values. |
| Next standalone documentation | Context7 `/vercel/next.js`; standalone output and self-hosting guidance | PASS; documented entrypoint is `node .next/standalone/server.js`; current Next source warns that `next start` does not work with standalone output. |
| Render standalone start correction | `pnpm test -- tests/foundation/p8-tus-deployment.test.mjs` | PASS; 8 tests passed, including package-relative output path, `PORT=$PORT` handoff, and worker placeholder preservation. |

## External-Blocked Items

- No Render or Vercel project ownership, environment settings, deployment logs,
  health responses, or authenticated browser evidence was inspected.
- No `DATABASE_URL` target identity, non-production loopback/profile proof, PostgreSQL connection,
  migration execution, seed, or database write was performed.
- No Docker or Compose command was run; Compose was syntax-parsed only.
- No long-lived Render worker proof exists. The checked-in worker command runs
  `python -m worker.main`; its entrypoint processes one example job and exits,
  and the manifest labels it an external-blocked placeholder.
- No live provider, legal, tax, KYC/KYB, Mercado Pago, POS, device, or
  production operational evidence was inferred from static validation.

## Remaining Mismatches

1. **High, Render worker lifecycle:** the Python worker is a one-shot example
   entrypoint, not a long-lived queue consumer; it remains external-blocked.
2. **Medium, Vercel reproducibility:** `NEXT_PUBLIC_API_URL` and the agreeing
   `API_BASE_URL` are external project settings, not checked-in values. The
   production resolver intentionally fails closed when neither is supplied.
3. **Medium, live rollout proof:** the Render migration command is correctly
   declared but unexecuted; static presence is not migration or database proof.

## Risks

- A Render web release still requires a completed build that emits the expected
  standalone directory; this correction does not provide live Render proof.
- Treating Render/Vercel settings or a successful build as live conformance
  would bypass the documented fail-closed evidence boundary.
- The worker service can terminate after one example job and silently fail to
  provide durable queue processing if enabled without a lifecycle fix.
- The existing dirty worktree contains unrelated user changes; they were
  preserved and not included in this evidence refresh.

## Next Recommended

1. Replace the worker placeholder with an approved long-lived worker contract
   or change its deployment classification/service type.
2. Supply separately authorized Vercel URL settings and Render secret ownership
   proof, then perform a bounded live deployment review.
3. Execute migration and health checks only under an approved non-production loopback/profile or
   authorized target window; retain this static audit as separate evidence.

## Skill Resolution

- `sdd-apply`: loaded from `C:\Users\mmmau\.config\opencode\skills\sdd-apply\SKILL.md`.
- `_shared`: loaded from `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md`.
- `nextjs-15`: loaded from `C:\Users\mmmau\.config\opencode\skills\curated\nextjs-15\SKILL.md`.
- Next.js standalone compatibility was checked against Context7 library `/vercel/next.js`.

## Safety Boundary

The sibling path `Goldenrepo-js_py`, unrelated OpenSpec changes, review
lifecycle, `sdd-verify`, and archive were not touched. The correction changed
only the Render/web start contract, its focused static test, and deployment
documentation. No secret value or database connection string is included in
this artifact.
