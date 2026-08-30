# Secret Exposure Incident Procedure

This procedure applies when a credential, token, certificate, or provider secret may
have entered a worktree, staging area, log, artifact, or remote system.

1. **Contain:** stop the affected deployment or integration and revoke the exposed
   credential immediately. Do not paste the value into an issue, log, or chat.
2. **Rotate:** issue a replacement in the owning Render/AWS secret store, scoped to
   the smallest environment and service. Render-to-AWS bootstrap credentials must
   be secret-store references with permission for only `sts:AssumeRole`; use
   temporary role credentials for workloads with a 900–3600 second session.
3. **Remove:** delete the value from the worktree and Git history through the normal
   repository incident process. The staged and tracked scans must pass without
   printing matches.
4. **Assess:** review access logs, provider audit events, CI artifacts, and repository
   permissions without reproducing the secret. Record affected scope and timestamps.
5. **Recover:** redeploy the last passing configuration, invalidate derived sessions
   or jobs when applicable, and verify health/readiness before resuming traffic.
6. **Record:** document owner, incident identifier, rotation evidence, impacted
   profiles, follow-up controls, and the exact evidence gate that returned to green.

## Prevention gates

- `.github/workflows/security.yml` blocks tracked and staged secret-like content.
- `.github/workflows/ci.yml` runs the deterministic test suite and tracked-secret scan.
- CI and scripts never print environment values, secret files, or matching content.
- Render and AWS manifests contain references to provider secret stores only; real
  values are not workflow inputs, fixtures, logs, or committed artifacts.

Real values belong only in approved Render/AWS secret stores. `.env` is local-only,
ignored, and must never be copied into an artifact or evidence record.
