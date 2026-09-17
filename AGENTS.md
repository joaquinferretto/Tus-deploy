# Reglas de ejecución para agentes de TUS

## Procesos de larga duración

Nunca ejecutes en foreground procesos que se espera que permanezcan activos.

Esto incluye, entre otros:

- servidores Node.js;
- API Express;
- Next.js dev server;
- Expo;
- workers;
- watchers;
- PostgreSQL;
- Redis;
- Docker Compose con servicios persistentes.

Cuando necesites iniciar un servidor o proceso persistente:

1. iniciarlo en background o detached;
2. redirigir stdout y stderr a archivos de log;
3. conservar el PID;
4. devolver inmediatamente el control al agente;
5. verificar disponibilidad mediante puerto, health endpoint o proceso;
6. continuar la tarea sin esperar a que el servidor finalice.

No mantengas una llamada shell bloqueada esperando un servidor.

## Timeouts

Los comandos de verificación deben tener duración acotada.

Si un comando que normalmente debería terminar rápidamente lleva más de 60-120 segundos:

- no seguir esperando indefinidamente;
- inspeccionar procesos;
- inspeccionar logs;
- inspeccionar puertos;
- determinar si el proceso hijo sigue activo;
- continuar o reportar el bloqueo.

No repetir el mismo comando indefinidamente.

## API local de TUS

Cuando se necesite levantar la API para pruebas:

- ejecutarla en background;
- guardar stdout y stderr en logs temporales;
- registrar su PID;
- esperar solo hasta que el puerto esté escuchando;
- comprobar `/health` y `/ready`;
- continuar con los tests HTTP.

No abrir una nueva ventana de terminal interactiva para mantener la API activa.

## Web local

Aplicar el mismo criterio al servidor Next.js:

- background/detached;
- PID registrado;
- logs redirigidos;
- comprobar puerto;
- continuar.

## Launcher detached para uso humano

En una sesion humana interactiva se puede usar el launcher canonico:

```powershell
node scripts/dev/launch-detached.mjs api
node scripts/dev/launch-detached.mjs web
```

El launcher devuelve el control inmediatamente y conserva metadata, PID y stdout/stderr en el directorio temporal del sistema. No crea esos archivos dentro del repositorio. La variable `TUS_DEV_LAUNCHER_DIR` solo debe usarse para redirigir ese estado a otro directorio temporal aprobado.

Verificar el estado con un comando separado y acotado:

```powershell
node scripts/dev/check-detached.mjs api
node scripts/dev/check-detached.mjs web
```

Los estados posibles son `READY`, `STARTING`, `NOT_RUNNING` y `UNHEALTHY`. El check de API valida `/health` y `/ready`; el de Web valida `/`.

Detener solo el servicio registrado por el launcher:

```powershell
node scripts/dev/stop-detached.mjs api
node scripts/dev/stop-detached.mjs web
```

`stop-detached.mjs` solo envia senales al PID guardado en la metadata. No usar busquedas por nombre, `Stop-Process` global, `taskkill` global ni matar PostgreSQL para limpiar un servicio. Un resultado `STOPPED_PORT_OCCUPIED` requiere diagnosticar el listener restante sin matar procesos no registrados.

Los comandos `next dev`, `next start`, `pnpm dev`, `tsx watch` y `Start-Process` quedan reservados para una sesion humana interactiva.

## Agentes, CI y smoke local

Los agentes y los smokes automatizados no deben dejar servidores persistentes vivos entre tool calls. Usar el runner autocontenido:

```powershell
node scripts/dev/smoke-local.mjs web
node scripts/dev/smoke-local.mjs api
```

El runner inicia el proceso hijo sin detached, redirige sus logs a un directorio temporal, espera puerto y HTTP con timeout, ejecuta las comprobaciones y detiene el proceso en `finally` antes de terminar. No usar `launch-detached.mjs` para validar desde un agente ni conservar su PID entre comandos.

## Diagnóstico

Si una petición HTTP falla:

1. verificar primero si el puerto está escuchando;
2. comprobar el proceso;
3. leer el log del servidor;
4. recién después intentar reiniciarlo.

No reinstalar software ni modificar configuración del sistema como primera respuesta a un fallo de conexión.

## Alcance

No ejecutar procesos persistentes sin necesidad.

No instalar herramientas del sistema salvo que sean imprescindibles para la tarea y se haya explicado previamente el motivo.

Al terminar una fase, informar qué procesos se dejaron ejecutando y sus PID.
