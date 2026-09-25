-- Google sign-in / sign-up (OpenID Connect) on top of the existing account model.
-- Forward-only and additive: new tables only. The permanent external identity is
-- provider + issuer + subject (never the email). No Google access or refresh token is stored.

CREATE TABLE public."identidades_externas" (
  "id" text NOT NULL,
  "cuenta_id" text NOT NULL,
  "proveedor" text NOT NULL,
  "emisor" text NOT NULL,
  "sujeto" text NOT NULL,
  "email" text,
  "vinculada_en" timestamp(3) NOT NULL,
  CONSTRAINT "identidades_externas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_identidades_externas_cuenta" FOREIGN KEY ("cuenta_id") REFERENCES public."Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_identidades_externas_proveedor" CHECK ("proveedor" IN ('google')),
  CONSTRAINT "ck_identidades_externas_sujeto" CHECK (length("sujeto") BETWEEN 1 AND 255)
);
-- One TUS account per external identity; accounts list their linked identities.
CREATE UNIQUE INDEX "uq_identidades_externas_identidad" ON public."identidades_externas"("proveedor", "emisor", "sujeto");
CREATE INDEX "ix_identidades_externas_cuenta" ON public."identidades_externas"("cuenta_id");

-- OAuth authorization transactions (state/nonce/PKCE). Only a hash of `state` is stored; the
-- verifier lives at most a few minutes and is consumed once.
CREATE TABLE public."transacciones_oauth" (
  "id" text NOT NULL,
  "proveedor" text NOT NULL,
  "hash_state" text NOT NULL,
  "nonce" text NOT NULL,
  "code_verifier" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "expira_en" timestamp(3) NOT NULL,
  "consumida_en" timestamp(3),
  CONSTRAINT "transacciones_oauth_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_transacciones_oauth_hash_state" CHECK ("hash_state" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "uq_transacciones_oauth_hash_state" ON public."transacciones_oauth"("hash_state");

-- Single-use codes that hand the callback result to the Web (session, sign-up or link) without
-- putting a session token in a URL. Only the sha256 of the code is stored.
CREATE TABLE public."codigos_ingreso_oauth" (
  "id" text NOT NULL,
  "hash_codigo" text NOT NULL,
  "tipo" text NOT NULL,
  "datos" jsonb NOT NULL,
  "expira_en" timestamp(3) NOT NULL,
  "usado_en" timestamp(3),
  CONSTRAINT "codigos_ingreso_oauth_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_codigos_ingreso_oauth_tipo" CHECK ("tipo" IN ('session', 'signup', 'link')),
  CONSTRAINT "ck_codigos_ingreso_oauth_hash" CHECK ("hash_codigo" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "uq_codigos_ingreso_oauth_hash" ON public."codigos_ingreso_oauth"("hash_codigo");
