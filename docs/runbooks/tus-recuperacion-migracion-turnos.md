# Recuperación: migración fallida de Turnos (P3009) — PENDIENTE EN PRODUCCIÓN

Estado al 2026-09-30: producción sigue en `bab6ad2`. El deploy de `79a652a` se detuvo en `prisma migrate deploy` con
P3009 porque `20261017100000_tus_turnos_modalidades_concurrencia` quedó registrada como fallida (P3018 / SQLSTATE
42P17: `tstzrange()` sobre columnas `timestamp` sin zona horaria de `reservas`).

Inspección de solo lectura ya hecha en producción: `applied_steps_count = 0`, `finished_at = NULL`,
`rolled_back_at = NULL`, sin `btree_gist`, sin `ex_reservas_sin_solapamiento`, sin columnas nuevas en `reservas` y sin
`tarifas_servicio_prestador`. No quedaron objetos parciales.

Fix local: `872db90 fix(db): use tsrange for appointment exclusion constraint` (+ `d0cac8a` para el check determinístico
de CI). Ensayado en PostgreSQL 16 descartable: la migración original deja exactamente ese estado, un segundo deploy da
P3009, `migrate resolve --rolled-back` la marca y el deploy con el fix aplica 20261017 y 20261018.

## Pasos (en orden; detenerse ante cualquier desvío)

1. **Solapamientos (solo lectura, SQL Editor de Supabase).** Debe dar 0; si no, NO seguir (la constraint no se puede
   crear con reservas activas superpuestas y hay que decidir conscientemente qué hacer con ellas):

   ```sql
   SELECT count(*) AS pares_superpuestos
   FROM public."reservas" a JOIN public."reservas" b
     ON a."calendario_id" = b."calendario_id" AND a."id" < b."id"
    AND tsrange(a."fecha_inicio", a."fecha_fin", '[)') && tsrange(b."fecha_inicio", b."fecha_fin", '[)')
   WHERE a."estado" NOT IN ('cancelled','cancelled-late','no-show')
     AND b."estado" NOT IN ('cancelled','cancelled-late','no-show');
   ```

2. **Marcar la migración fallida como revertida** (herramienta oficial; nunca editar `_prisma_migrations` a mano). Desde
   el repo, con las URLs del panel de Hostinger cargadas sin mostrarlas (PowerShell):

   ```powershell
   cd C:\Users\juaqu\Desktop\Tus\apps\api
   $d = Read-Host -AsSecureString 'DIRECT_URL';   $env:DIRECT_URL   = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($d))
   $u = Read-Host -AsSecureString 'DATABASE_URL'; $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($u))
   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261017100000_tus_turnos_modalidades_concurrencia --schema prisma/schema.prisma
   node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
   Remove-Item Env:DIRECT_URL, Env:DATABASE_URL
   ```

   `migrate status` debe listar pendientes (no fallidas). La fila vieja queda con `rolled_back_at` (no se borra).

3. **Push del backend SOLO hasta el fix** (sin force), para no mezclar la recuperación con trabajo posterior:

   ```powershell
   gh auth switch --hostname github.com --user alfajoresnande
   gh auth setup-git --hostname github.com
   git push hostinger d0cac8a:main
   ```

   `main` local tiene además la identidad por teléfono (`0ee315a`..., migración `20261019100000_tus_identidad_telefono`).
   Se despliega en un segundo paso, cuando la recuperación esté verificada.

4. **Hostinger:** si no despliega solo, `Redeploy` en Hostinger → api.tusservicios.shop → Aplicación Node.js/Git. El
   postinstall compila, corre `scripts/db/migrate-deploy.mjs` (aplica 20261017 y 20261018) y arranca la API. Si vuelve a
   fallar: DETENER, no improvisar.

5. **Verificar:** `/version` = `d0cac8a…`; `/health` 200; `/ready` 200 (postgres ok, schema compatible, `missing: []`).
   En `_prisma_migrations`: la ejecución nueva de 20261017 con `finished_at` y sin `rolled_back_at`; la vieja con
   `rolled_back_at`; 20261018 aplicada; 0 fallidas.

6. **Funcional:** Turnos, Alojamientos, WhatsApp (bot y herramientas de turnos) y Groq reales.

7. **Después:** push del resto de `main` (identidad por teléfono) con `TUS_WHATSAPP_PUBLIC_NUMBER` cargada en Hostinger,
   y recién entonces sincronizar la Web (`deploy/main`).
