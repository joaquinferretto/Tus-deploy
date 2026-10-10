# Rotación de la credencial de PostgreSQL de producción

> Estado al 2026-10-10: **PENDIENTE, sin ejecutar.** La contraseña de la base de producción apareció
> en una conversación y debe considerarse expuesta. Este runbook es para que la ejecute el dueño,
> despierto y con el panel abierto. Ningún agente la ejecuta ni tiene (ni debe usar) esa credencial.
> No pegar valores en chats, commits, documentos ni capturas: en todo registro usar solo
> CONFIGURADO / AUSENTE / INVÁLIDO.

## Qué se rota y quién lo usa

| Dato | Dónde vive | Quién lo consume |
| --- | --- | --- |
| Proveedor | Supabase (PostgreSQL 17, plan Free) | — |
| Usuario de la base | el usuario `postgres` del proyecto (confirmar en Supabase → Project Settings → Database) | API |
| `DATABASE_URL` (pooler, runtime) | Variables de entorno de la API en **Hostinger** | API Express (`apps/api`), en cada pedido |
| `DIRECT_URL` (conexión directa, migraciones) | Variables de entorno de la API en **Hostinger** | `scripts/db/migrate-deploy.mjs` al desplegar |
| `TUS_BACKUP_URL` | Solo en la terminal del dueño, al correr el respaldo | `scripts/db/respaldo-produccion.mjs` |
| Web (Vercel) | No usa la base: habla con la API | Confirmar que Vercel **no** tiene `DATABASE_URL` ni `DIRECT_URL` cargadas; si las tiene, borrarlas |
| Worker de identidad / otros hosts | Hoy no hay ninguno desplegado con acceso a la base | Si existiera uno, entra en el paso 3 |
| `.env` raíz local | Apunta a la base **local** (`factory_local`), no a producción | No se toca |

Las tres URLs llevan la **misma** contraseña del usuario de la base: se rota una vez y se actualizan las tres.

Antes de empezar, confirmar esta tabla contra los paneles (Hostinger → variables de la app Node; Vercel → Environment Variables; Supabase → Database → Connection string). Si aparece un consumidor que no está acá, agregarlo al paso 3 antes de seguir.

## Por qué hay un corte breve

En Supabase la contraseña del usuario se **reemplaza**: no pueden convivir la vieja y la nueva. Entre el paso 2 y el final del paso 4 la API no puede abrir conexiones nuevas. Con todo preparado son uno o dos minutos. Hacerlo en un horario de poco uso y **no** durante un pago o un deploy.

## Procedimiento

1. **Respaldo.** En la terminal del dueño, con `TUS_BACKUP_URL` cargada con la credencial todavía vigente:
   `node scripts/db/respaldo-produccion.mjs`. Seguir solo si termina en `RESPALDO VERIFICADO`. Anotar la carpeta.
2. **Nueva credencial.** Supabase → Project Settings → Database → *Reset database password*. Generar una contraseña larga y aleatoria en el gestor de contraseñas (sin `@`, `:`, `/`, `?`, `#` ni espacios, o habrá que codificarla en la URL). Guardarla solo en el gestor. Desde este momento la vieja deja de servir.
3. **Actualizar secretos.** Hostinger → la app de la API → variables de entorno: reemplazar la contraseña dentro de `DATABASE_URL` y de `DIRECT_URL` (mismo host, puerto, base y parámetros; solo cambia la contraseña). No tocar ninguna otra variable.
4. **Reiniciar la API.** Reiniciar la app desde el panel de Hostinger (no hace falta un deploy de código). Si el panel solo reinicia con un deploy, volver a desplegar el **mismo** commit que está en producción.
5. **`/health`.** `https://api.tusservicios.shop/health` → 200.
6. **`/ready`.** `https://api.tusservicios.shop/ready` → 200 con `ready: true`. Si responde 503 por la base, la URL quedó mal escrita: corregir en Hostinger y reiniciar.
7. **Conectividad real.** Con `Origin: https://tusservicios.shop`, abrir `https://api.tusservicios.shop/tus/v1/public/oficios` (lee la base) → 200 con datos. Entrar a la Web con una cuenta y abrir Mis turnos.
8. **Invalidar la vieja.** Ya quedó invalidada en el paso 2. Verificarlo: una conexión con la contraseña anterior debe fallar por autenticación. Borrar la contraseña vieja de cualquier nota, historial de terminal (`TUS_BACKUP_URL` en el historial de PowerShell) o gestor.
9. **Volver a verificar.** A los 10 minutos: `/ready` 200 y los logs de Hostinger sin errores de autenticación de PostgreSQL. Correr un respaldo nuevo con `TUS_BACKUP_URL` armada con la credencial nueva para confirmar que el respaldo sigue funcionando.

## Si algo sale mal

- `/ready` en 503 después del paso 4: es casi siempre la URL (contraseña con un carácter sin codificar, o se editó solo una de las dos). Corregir y reiniciar. No hay "vuelta atrás" a la contraseña vieja: se avanza corrigiendo la nueva.
- Si la API no levanta y no se encuentra el error: resetear otra vez la contraseña en Supabase (paso 2) y repetir 3 a 6 con cuidado. Los datos no se tocan en ningún paso.
- No correr `prisma migrate` ni ningún comando de esquema durante la rotación.

## Qué registrar

Fecha y hora, quién la hizo, carpeta del respaldo, resultado de `/health`, `/ready` y de la prueba del paso 8. Nunca el valor de la contraseña ni la URL completa.

## Lo que este runbook no hace

No rota las credenciales de Mercado Pago, Meta, Groq ni la clave de cifrado de tokens: esas no estuvieron expuestas. Para esas, ver `docs/runbooks/secret-rotation.md`.
