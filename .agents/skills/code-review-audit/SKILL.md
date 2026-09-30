---
name: code-review-audit
description: Procedimientos de revisión crítica de código, auditorías de seguridad y prevención de regresiones en TUS. Usar antes de commitear o al auditar cambios sustanciales.
---

# Auditoría y Revisión de Código en TUS

## Criterios de Evaluación
1. **Seguridad y Control de Acceso**:
   - Verificar autorización robusta: mitigación de IDOR comprobando siempre que el recurso pertenezca al usuario/inquilino autenticado derivado de sesión.
   - Protección contra asignación masiva (Mass Assignment) mediante allowlists explícitas en DTOs.
   - Cero exposición de secretos, hashes o tokens en logs, respuestas de error o código fuente.
2. **Arquitectura y Reutilización**:
   - Reutilizar la infraestructura existente (calendarios, Mercado Pago, geografía de polígonos, mensajería).
   - Mantener desacopladas las capas de dominio, aplicación e infraestructura.
3. **Eficiencia y Concurrencia**:
   - Prevenir consultas N+1 en listados y vistas agregadas.
   - Emplear transacciones de base de datos y constraints de exclusión en reservas y turnos.
4. **Validación Previa al Commit**:
   - Compilación y typecheck sin advertencias ni errores.
   - Tests focales ejecutados y aprobados.
   - `git diff --check` limpio (sin espacios residuales ni marcadores).
   - Excluir estrictamente `opencode.json` y archivos `.env`.
