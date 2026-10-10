# Experiencia operativa de TUS — referencia canónica (2026-10-10)

> Qué hace hoy el código de la rama `feat/experiencia-operativa-tus`, por tema. Nada de esto está
> desplegado. El avance fase por fase y lo pendiente están en `docs/PROGRESO_MASTER_TUS_2026-10-10.md`.
> Regla general: la API decide; la Web y WhatsApp solo muestran.

## 1. Prestadores: persona física, empresa, titular y nombre público

| Concepto | Dónde vive | Quién lo cambia |
| --- | --- | --- |
| Titular de la cuenta (persona real) | `User.firstName` / `lastName` de la cuenta vinculada al prestador (`prestadores.cuenta_id`) | El titular, en su perfil personal; Admin en Usuarios → Identidad |
| Tipo de prestador | `perfiles_publicos_prestador.tipo_prestador` (`persona_fisica` \| `empresa`) | Solo Admin: `POST /tus/v1/admin/prestadores/:id/tipo` |
| Nombre público | `perfiles_publicos_prestador.nombre_publico` | Depende del tipo |

- **Persona física:** el nombre público se **deriva**: todos los nombres y todos los apellidos del titular, capitalizados por un único helper (`capitalizarNombrePropio` / `nombrePublicoPersonaFisica`, en `packages/contracts/src/tus-directorio.ts`). No se escribe a mano ni desde el prestador ni desde Admin; la API rechaza otro nombre (`PUBLIC_NAME_DERIVED`). Si el titular cambia su nombre, el nombre público lo sigue (auditado).
- **Empresa:** nombre comercial libre, con las reglas de cualquier nombre público.
- **Empresa → Persona física:** regenera el nombre desde el titular; se rechaza si faltan nombre o apellido. **Persona física → Empresa:** conserva el nombre o toma el que se indique. En ambos casos es la misma cuenta, tenant, prestador, servicios, turnos, pagos, saldo, Mercado Pago, identidad y opiniones.
- **Homónimos:** no se agregan números ni alias. Se distinguen por foto, rubro, zona y rating; nunca por DNI, teléfono o email.
- El tipo no condiciona trabajar, cobrar ni retirar. La identidad verificada por TUS sigue siendo opcional.
- Invariante de la migración: un perfil existente queda Persona física solo si su nombre público ya es el nombre completo de su titular; el resto queda Empresa con su nombre intacto.

## 2. Agenda: duración e intervalo de comienzo

- **Duración:** por servicio (`perfil_servicios.duracion_minutos`) y por variante (`tarifas_servicio_prestador.duracion_minutos`; la variante manda).
- **Cada cuánto puede comenzar un turno:** por servicio (`perfil_servicios.intervalo_inicio_minutos`: 15, 30, 45 o 60). Sin valor, un turno comienza cuando termina el anterior (duración + descanso), que es el comportamiento de todos los servicios existentes.
- **Generación:** un solo generador, en la API (`agendaDelDia`, `apps/api/src/tus/calendar/agenda.ts`). Los comienzos van desde la apertura real; el turno ocupa toda su duración; un turno tomado quita todos los comienzos que pisa.
- **Concurrencia:** la reserva se decide con la agenda bloqueada y la base impide dos turnos superpuestos; dos pedidos simultáneos que se pisan: entra uno.
- **Pantalla:** Prestador → Agenda → "Duración y comienzo de los turnos". `PUT /tus/v1/prestador/servicios/:oficioId/turnos-config`.

## 3. Geografía: búsqueda del cliente y cobertura del prestador

- **Tres modos** (`GET /tus/v1/public/prestadores?ambito=`): `cerca` (8 km de un punto), `localidad`, `provincia`. Un pedido incompleto no filtra: la búsqueda responde igual.
- **Cerca de mí:** dentro de 8 km **y** dentro de las reglas reales del prestador. Quien atiende en su lugar aparece por distancia; quien va a domicilio, solo si el barrio del cliente está en sus zonas o dentro de la distancia que se desplaza. Estar cerca no alcanza.
- **Privacidad del cliente:** su posición se redondea (~100 m), se usa solo para medir, no se guarda, no se registra y no se devuelve. La respuesta trae la distancia en kilómetros enteros. Sin permiso de ubicación, la Web busca en la localidad.
- **Cobertura del prestador:** zona principal, zonas donde presta servicio y "¿Hasta qué distancia te desplazás?" (solo si va a domicilio). El código vive en `apps/api/src/tus/directorio/busqueda-geografica.ts`.

## 4. Modalidades y lugar de atención

| Modalidad | Qué se pide |
| --- | --- |
| A domicilio | Zonas y distancia. Sin lugar |
| En un lugar | Nombre del lugar (opcional), **dirección** (obligatoria) y cómo llegar (opcional) |
| Ambas | El lugar y la cobertura a domicilio |

- **Datos:** `lugar_nombre`, `lugar_direccion`, `lugar_descripcion` en `perfiles_publicos_prestador`.
- **Privacidad:** el directorio, la búsqueda y el perfil público muestran solo el **nombre** del lugar y la zona aproximada. La dirección y la indicación las leen únicamente: el propio prestador, Admin, y el cliente dueño de un turno en estado `confirmed` con ese prestador (en Mis turnos, "Lugar de atención"). Pendiente, impago, rechazado, cancelado o terminado: sin dirección.
- **Históricos:** un perfil "en un lugar" anterior a esto sigue funcionando sin dirección; su próximo guardado propio la pide.

## 5. Pantallas: ancho y navegación

- Un solo módulo decide el ancho (`apps/web/src/features/layout/layout.module.css`): `contained` (lectura, 800 px), `wide` (formulario con contexto, 1180 px), `dashboard` (pantallas operativas, hasta 1680 px).
- Panel de prestador, Mis solicitudes y Trabajos usan `dashboard`; Mi perfil público y Mis turnos, `wide`. Esas pantallas privadas no muestran el footer del sitio público.
- El panel de prestador tiene una sola navegación, en pestañas: Solicitudes, Agenda, Trabajos, Servicios y perfil, Ganancias, Ubicación (las mismas rutas de siempre). El manual queda al costado.
- Solicitudes: tarjetas con quién pide, qué necesita, rubro, zona aproximada, antigüedad y hasta 2 fotos del cliente (privadas, leídas con la sesión); estados vacíos breves; urgencias en un panel compacto al costado.
- Ayuda: ancho de lectura; en escritorio el índice del artículo queda fijo al costado y las portadas van en dos columnas.
- No rediseñado en esta etapa: Admin y Alojamientos (ya usaban el ancho disponible) ni el contenido interno de Agenda, Trabajos y Ganancias más allá del ancho y la navegación.

## 6. Opiniones de turnos

Una opinión exige un trabajo `completed`. El trabajo de un turno no tiene paso de "iniciar": se completa cuando el cierre está confirmado (por el cliente o por la ventana de 72 horas) **y** el total está pago, o cuando se aprueba el saldo después del cierre. Solo la seña paga, sin confirmar, o cancelado: no se puede opinar. La liberación de dinero no cambió.

## 7. Límite de autenticación

El límite estricto (40 pedidos cada 15 minutos por IP) cubre ingreso, registro, recuperación, verificación y todo desafío o cambio de MFA. La lectura del estado del segundo factor (`GET /auth/mfa/status`), que hace cada carga del Admin, no lo consume. `/auth/session` nunca estuvo bajo ese límite. Los límites por cuenta y por email (en PostgreSQL) no cambiaron.

## 8. Mercado Pago

- **Flujo:** cliente → cuenta de TUS → retención → cierre → saldo interno del prestador → retiro a su Mercado Pago vinculado. Vincular Mercado Pago solo se exige para retirar. Sin Split como flujo productivo.
- **Vincular (OAuth):** Authorization Code + PKCE S256, `state` de un solo uso, tokens cifrados. Lo puede hacer el dueño de un prestador sobre su propia cuenta y nadie más; cada rechazo dice su causa (401 sin sesión, 403 `FORBIDDEN`, 403 `PROVIDER_REQUIRED`, 503 `PAYMENTS_UNAVAILABLE`).
- **Calidad de integración:** `docs/MERCADO_PAGO_CALIDAD_100.md`. **Primer pago real:** `docs/PRUEBA_PAGO_REAL_TUS.md`. **Reembolsos:** `docs/AUDITORIA_REEMBOLSOS_Y_CANCELACIONES_2026-10-10.md`.

## 9. Alojamientos

El propietario recibe un email cuando entra una reserva confirmada y cuando el huésped la cancela (si hay transporte de email configurado). Solo informa. Siguen abiertas, sin decidir: seña, comisión, devoluciones, penalidades, destino de fondos, límite de reservas por cuenta y qué pasa con las reservas vigentes al suspender. La pantalla para que el huésped califique su estadía no existe todavía (la API y el cliente Web sí).

## 10. Seguridad operativa

- Rotación de la credencial de PostgreSQL: `docs/runbooks/rotacion-credencial-postgresql.md` (pendiente, la ejecuta el dueño).
- Dependencias: `docs/security/AUDITORIA_DEPENDENCIAS_2026-10-10.md` (auditado, sin actualizar).
- Nosis: rama `feat/identidad-documento-nosis-publico`, fuera de `main`, apagada por configuración; no se hicieron consultas reales.
