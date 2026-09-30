-- Identidad por teléfono + WhatsApp (verificación iniciada por el usuario). Aditiva.
--
-- 1. El teléfono de identidad pertenece a la PERSONA ("User"), no a un rol: una misma cuenta es
--    cliente, prestador o propietario con un único número. Solo se guarda ya VERIFICADO
--    ("phoneNumber" + "phoneVerifiedAt"); un número a verificar vive en "phonePending" (lo carga
--    el usuario o un admin) y en el desafío. Los usuarios históricos quedan con NULL: nada se
--    rellena automáticamente (no hay una columna de teléfono previa de la que copiar).
-- 2. UNIQUE real sobre "phoneNumber": dos personas no comparten un teléfono de identidad. Un
--    UNIQUE de PostgreSQL admite muchos NULL, así que las cuentas sin teléfono no chocan.
-- 3. desafios_telefono: desafíos de un solo uso (hash, nunca el código), vencimiento, propósito,
--    intentos desde un número incorrecto, el mensaje de Meta que lo verificó (idempotencia) y el
--    resultado del envío de la confirmación (un fallo de transporte no revierte la identidad).

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "phonePending" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "ck_user_phone_e164"
  CHECK ("phoneNumber" IS NULL OR "phoneNumber" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "User" ADD CONSTRAINT "ck_user_phone_pending_e164"
  CHECK ("phonePending" IS NULL OR "phonePending" ~ '^\+[1-9][0-9]{7,14}$');
-- A verified identity phone always has its verification date, and only then.
ALTER TABLE "User" ADD CONSTRAINT "ck_user_phone_verified_pair"
  CHECK (("phoneNumber" IS NULL) = ("phoneVerifiedAt" IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS "User_phoneNumber_key" ON "User"("phoneNumber");

CREATE TABLE IF NOT EXISTS public."desafios_telefono" (
  "id" TEXT NOT NULL,
  "cuenta_id" TEXT NOT NULL,
  "telefono" TEXT NOT NULL,
  "proposito" TEXT NOT NULL,
  "hash_desafio" TEXT NOT NULL,
  "hash_secreto_consulta" TEXT,
  "expira_en" TIMESTAMP(3) NOT NULL,
  "usado_en" TIMESTAMP(3),
  "invalidado_en" TIMESTAMP(3),
  "motivo_invalidacion" TEXT,
  "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
  "wamid_verificacion" TEXT,
  "entregado_en" TIMESTAMP(3),
  "confirmacion_enviada_en" TIMESTAMP(3),
  "confirmacion_error" TEXT,
  "creado_en" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "desafios_telefono_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_desafios_telefono_cuenta" FOREIGN KEY ("cuenta_id")
    REFERENCES public."Account"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_desafios_telefono_e164" CHECK ("telefono" ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT "ck_desafios_telefono_proposito"
    CHECK ("proposito" IN ('verificar_telefono', 'cambiar_telefono', 'recuperar_contrasena')),
  CONSTRAINT "ck_desafios_telefono_intentos" CHECK ("intentos_fallidos" >= 0),
  CONSTRAINT "ck_desafios_telefono_motivo"
    CHECK ("motivo_invalidacion" IS NULL OR "motivo_invalidacion" IN ('reemplazado', 'intentos', 'conflicto'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_desafios_telefono_hash" ON public."desafios_telefono"("hash_desafio");
-- One live challenge per account and purpose (creating a new one invalidates the previous).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_desafios_telefono_activo"
  ON public."desafios_telefono"("cuenta_id", "proposito")
  WHERE "usado_en" IS NULL AND "invalidado_en" IS NULL;
CREATE INDEX IF NOT EXISTS "ix_desafios_telefono_telefono" ON public."desafios_telefono"("telefono", "creado_en");
