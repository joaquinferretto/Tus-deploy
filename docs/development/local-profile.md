# Provider-free local profile

The local profile is the complete development boundary. It uses deterministic
fakes and local PostgreSQL, MongoDB, and Redis; it never requires cloud credentials
or live provider calls.

```sh
cp .env.example .env.local
pnpm test
docker compose up --build
```

Compose includes the API, web client, mobile support process, Python workflow
runtime, databases, Redis, and `local-fakes`. The mobile support process is a
headless contract/lifecycle check; device builds remain an application concern.

Render is native service/worker deployment and does not use production Docker.
AWS is represented by the Terraform profile and remains disabled until its
credential, region, quota, cost, and owner gates are explicitly approved.
