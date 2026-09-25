---
name: tus-security
description: Controles de seguridad de TUS (autorización multi-tenant, IDOR, webhooks, uploads, secretos, PII, logs). Usar al crear o revisar endpoints, servicios con datos de usuarios, integraciones externas, uploads o cualquier cambio con impacto en seguridad, y en auditorías.
---

# TUS: seguridad

Referencia canónica: `docs/SEGURIDAD_TUS.md` (gate y riesgos residuales).

## Autorización (siempre en el servidor)
- Tenant, actor y roles salen de la sesión autenticada; nunca del body, headers ni del texto de un modelo de IA. Rechazar campos de autoridad falsificados.
- Verificar ownership en cada recurso por id (IDOR): un recurso ajeno responde 403/404 sin revelar datos.
- Roles y permisos se recalculan desde el backend; no confiar en roles cacheados de canales secundarios.
- Administración de plataforma: permiso específico **y** tenant de plataforma.

## Entradas e integraciones
- Schemas estrictos (zod/JSON Schema) que rechazan campos desconocidos; validar ids y formatos.
- Webhooks: verificar la firma sobre los bytes crudos antes de parsear, comparación timing-safe, idempotencia por id externo; sin firma válida no se escribe nada.
- Uploads: validar magic bytes, tamaño y estructura; quitar metadata; guardar cifrado y privado; servir solo autenticado con `no-store` y `nosniff`.

## Datos y secretos
- Secretos solo en el backend y en el gestor de secretos de cada plataforma; jamás `NEXT_PUBLIC_*`.
- PII mínima: enviar a terceros (IA incluida) solo lo necesario, redactado.
- Logs y auditoría sin tokens, contraseñas, cookies, HTML ni DNI/CUIL completos (enmascarar).
- Fallar cerrado: configuración faltante o inválida deja la función deshabilitada, nunca abierta.

## Gate
- Ejecutar `corepack pnpm run security:scan` y `node scripts/security/validate-policy.mjs`.
- Hallazgos Critical/High bloquean declarar algo READY; corregirlos o dejarlos explícitos como bloqueantes.
