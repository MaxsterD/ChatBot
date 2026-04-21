# BotControl (WhatsApp Cloud API) — Bandeja multi‑chat + Bot + Historial

Plataforma de soporte por WhatsApp basada en **Meta WhatsApp Cloud API** que combina:

- **Bot** (responde y/o deriva a asesor)
- **Bandeja de asesores** (multi‑chat en tiempo real)
- **Historial** (conversaciones finalizadas)
- **Soporte de imágenes** (entrantes y salientes)

Actualmente el bot funciona con respuestas base (placeholder) y está preparada la carpeta para cargar documentación `.md` más adelante.

---

## Qué hace

### Canal WhatsApp (Meta Cloud API)
- Expone un **webhook** compatible con Meta para recibir eventos.
- Responde mensajes de texto desde el bot cuando la conversación está en estado `bot`.
- Soporta escalamiento a asesor cuando el usuario lo solicita (por ejemplo: “asesor”, “humano”, “agente”).
- Procesa imágenes entrantes (se guardan como mensaje con `media_id`).

### Panel de asesores (web)
- Login para asesores (JWT).
- Bandeja “En cola” (conversaciones que requieren asesor).
- Bandeja “Mis chats” (conversaciones asignadas al asesor).
- “Historial” (conversaciones finalizadas).
- Indicadores visuales:
  - chats nuevos en cola
  - mensajes pendientes por leer en chats asignados
- Tiempo real con WebSocket (sin recargar).
- Envío de:
  - mensajes de texto
  - imágenes (subida a WhatsApp y envío)
- Respuestas rápidas:
  - envío con 1 click
  - crear/guardar/borrar respuestas personalizadas (persistencia local en el navegador)
- Sidebar izquierdo y panel derecho ocultables para maximizar el área del chat (persistencia local).

### Cierre de chat
Al “Cerrar” un chat asignado:
- Se envían 2 mensajes al cliente (avisando finalización).
- La conversación se marca como `closed` y pasa a **Historial**.
- Si el usuario vuelve a escribir, se crea/usa una conversación activa nueva (separada del historial).

---

## Alcance y limitaciones (importante)

- **Ventana de 24 horas (WhatsApp)**: si el cliente no ha escrito en las últimas 24 horas, WhatsApp puede bloquear mensajes libres y exigir plantillas. En ese caso operaciones como “Cerrar” pueden fallar al enviar los mensajes finales.
- **Modo prueba**: si tu número está en modo sandbox, solo podrás enviar mensajes a números en la lista de destinatarios permitidos (Meta “Allowed recipients”).
- **Base de conocimiento**: aún no está implementado el motor de búsqueda/RAG sobre `.md`; el bot responde con un placeholder y deriva a asesor.
- **Escalabilidad**:
  - Se usa **SQLite** para persistencia (ideal para MVP y despliegues simples).
  - Para alto volumen, se recomienda migrar a Postgres y agregar colas para tareas (no incluido en este MVP).
- **Deduplicación**: WhatsApp puede reintentar webhooks; si necesitas deduplicación por `wa_message_id`, se puede agregar (no incluido por defecto).

---

## Estructura del proyecto

- `src/index.ts`: servidor Fastify (API + webhook + panel + WebSocket)
- `src/whatsapp.ts`: integración con Meta Graph API (textos, imágenes, media)
- `src/db.ts`: persistencia SQLite (conversaciones, mensajes, usuarios)
- `public/login.html`: login del panel
- `public/agent.html`: bandeja de asesores (UI)
- `public/app.js`: lógica del panel (real‑time, tabs, respuestas rápidas, imágenes)
- `docs-md/`: carpeta para documentación futura del bot (vacía al inicio)

---

## Requisitos

- Node.js 18+ (recomendado 20+)
- Cuenta de Meta con WhatsApp Cloud API configurada
- (Para exponer webhook en local) ngrok o dominio público con HTTPS

---

## Configuración

1) Instala dependencias:

```bash
npm install
```

2) Crea tu `.env` (no se sube a Git) usando `.env.example`:

Variables clave:

- `PORT`, `HOST`: dónde escucha tu servidor local
- `JWT_SECRET`: secreto para firmar tokens del panel
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`: usuario inicial del panel
- `WHATSAPP_VERIFY_TOKEN`: token que tú defines para verificar el webhook
- `WHATSAPP_PHONE_NUMBER_ID`: Phone Number ID de Meta
- `WHATSAPP_ACCESS_TOKEN`: token de Meta (idealmente de System User)
- `WHATSAPP_APP_SECRET`: opcional, para validar firma del webhook

3) Ejecuta en desarrollo:

```bash
npm run dev
```

Abre el panel:

- `http://127.0.0.1:<PORT>/login.html`

---

## Webhook de WhatsApp Cloud API

### Verificación (Meta)
Meta te pide:

- **URL de devolución de llamada**: `https://TU_DOMINIO/webhook`
- **Token de verificación**: el valor de `WHATSAPP_VERIFY_TOKEN`

El servidor responde al desafío en:

- `GET /webhook`

### Recepción de mensajes
Meta enviará eventos a:

- `POST /webhook`

Debes **suscribirte al evento `messages`** en el panel de Webhooks para que lleguen mensajes.

---

## Probar con ngrok (local)

1) Con el server corriendo, abre un túnel:

```bash
ngrok http <PORT>
```

2) En Meta, configura:

- Callback URL: `https://TU_SUBDOMINIO.ngrok-free.app/webhook`
- Verify Token: tu `WHATSAPP_VERIFY_TOKEN`

3) Suscribe el campo `messages`.

---

## Endpoints principales

- `GET /health`: healthcheck
- `GET /webhook`: verificación Meta
- `POST /webhook`: inbound eventos WhatsApp
- `POST /auth/login`: login panel (retorna JWT)

API (requiere JWT):

- `GET /api/me`
- `GET /api/conversations?status=needs_agent|assigned|bot|closed`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/claim`
- `POST /api/conversations/:id/messages` (texto asesor)
- `POST /api/conversations/:id/image` (imagen asesor)
- `POST /api/conversations/:id/close`

Media:

- `GET /api/media/:mediaId` (proxy de media de WhatsApp; se usa token por query para render de `<img>`)

---

## Persistencia (historial)

Se guarda en **SQLite** (archivo configurado por `DB_PATH`).

Tablas principales:

- `conversations`: conversación por `wa_id` (usuario) y estado (`bot`, `needs_agent`, `assigned`, `closed`)
- `messages`: mensajes (texto e imagen) con metadatos (`content_type`, `media_id`, `media_mime`, `wa_message_id`)

---

## Seguridad

- **Nunca subas `.env`**: contiene tokens y secretos.
- Usa tokens de **System User** en Meta para producción (más estables que tokens temporales).
- Considera habilitar `WHATSAPP_APP_SECRET` para validar firma del webhook.

---

## Roadmap sugerido (opcional)

- Indexado de `docs-md/` + RAG para respuestas con base de conocimiento.
- Plantillas de WhatsApp para mensajes fuera de ventana 24h.
- Deduplicación por `wa_message_id`.
- Multi‑tenant (para revender).
- Migración a Postgres + colas (RabbitMQ) si crece el volumen.

