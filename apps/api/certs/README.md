# Supabase database CA

`supabase-ca.crt` is the public Supabase Root 2021 CA, downloaded over verified
HTTPS on 2026-09-26 from:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Source: the `ssl:certificate_url` entry in the official Supabase dashboard:
https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json

SHA-256 certificate fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Expires: 2031-04-26. This is a public certificate, not a private key.

The PostgreSQL startup pool uses this CA only for recognized Supabase database
hosts with TLS enabled, and enforces `verify-full` (chain and hostname checks).
An explicit `sslrootcert` in the database URL takes precedence. The path is
resolved relative to the module, so both source and compiled deployments work
independently of the working directory. Keep this directory in the deployed
repository. Replace the certificate from the official source when Supabase
rotates its CA; never trust a certificate obtained from a failed TLS handshake.
