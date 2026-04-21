import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { getConfig } from "./config";
import { openDb } from "./db";
import { decideBotResponse } from "./bot";
import { ensureSeedUser, getAuthUser, parseLoginBody, requireAuth, signJwt, verifyPassword, verifyJwt } from "./auth";
import { RealtimeHub } from "./realtime";
import { getWhatsappMediaInfo, parseInboundMessages, sendWhatsappImage, sendWhatsappText, uploadWhatsappMedia, verifyMetaSignature } from "./whatsapp";

function maskWaId(waId: string) {
  const digits = waId.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

async function main() {
  const cfg = getConfig();
  const db = openDb(cfg.DB_PATH);
  await ensureSeedUser(db, cfg.SEED_ADMIN_EMAIL, cfg.SEED_ADMIN_PASSWORD);
  const hub = new RealtimeHub();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });
  await app.register(staticPlugin, { root: path.join(process.cwd(), "public") });

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (e) {
      done(e as Error);
    }
  });

  app.get("/", async (_req, reply) => reply.redirect("/login.html"));
  app.get("/health", async () => ({ ok: true }));

  app.get("/webhook", async (req, reply) => {
    const q = req.query as any;
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"];
    const challenge = q["hub.challenge"];
    if (mode === "subscribe" && token === cfg.WHATSAPP_VERIFY_TOKEN) {
      reply.code(200).type("text/plain").send(String(challenge ?? ""));
      return;
    }
    reply.code(403).send("forbidden");
  });

  app.post("/webhook", async (req, reply) => {
      const raw = (req as any).rawBody as Buffer | undefined;
      const ok = verifyMetaSignature({
        rawBody: raw ?? Buffer.from(JSON.stringify(req.body ?? {})),
        signatureHeader: req.headers["x-hub-signature-256"] as string | undefined,
        appSecret: cfg.WHATSAPP_APP_SECRET
      });
      if (!ok) return reply.code(401).send({ error: "invalid_signature" });

      const inbound = parseInboundMessages(req.body);
      if (inbound.length === 0) {
        app.log.info({ hasBody: Boolean(req.body) }, "webhook_received_no_text_messages");
      } else {
        app.log.info({ count: inbound.length }, "webhook_received_messages");
      }
      for (const msg of inbound) {
        const conversation = db.getOrCreateActiveConversation(msg.waId);
        if (msg.kind === "text") {
          app.log.info({ from: maskWaId(msg.waId), bodyLen: msg.body.length }, "webhook_inbound_text");
          db.addMessage({
            conversationId: conversation.id,
            sender: "customer",
            direction: "in",
            contentType: "text",
            body: msg.body,
            waMessageId: msg.waMessageId
          });
        } else if (msg.kind === "image") {
          app.log.info({ from: maskWaId(msg.waId) }, "webhook_inbound_image");
          db.addMessage({
            conversationId: conversation.id,
            sender: "customer",
            direction: "in",
            contentType: "image",
            body: msg.caption ?? "",
            mediaId: msg.mediaId,
            mediaMime: msg.mimeType,
            waMessageId: msg.waMessageId
          });
        }
        hub.broadcast({ type: "message.new", conversationId: conversation.id });

        const current = db.getConversation(conversation.id);
        if (!current) continue;
        if (current.status !== "bot") continue;

        if (msg.kind !== "text") continue;
        const decision = decideBotResponse({ conversation: current, userText: msg.body, db });
        if (decision.type === "escalate") {
          db.updateConversationStatus(current.id, "needs_agent", null);
          const out = decision.textToUser;
          try {
            await sendWhatsappText(cfg, current.waId, out);
          } catch (e) {
            app.log.error(e);
          }
          db.addMessage({ conversationId: current.id, sender: "bot", direction: "out", body: out });
          hub.broadcast({ type: "conversation.updated", conversationId: current.id });
          hub.broadcast({ type: "message.new", conversationId: current.id });
          continue;
        }

        const out = decision.text;
        try {
          await sendWhatsappText(cfg, current.waId, out);
        } catch (e) {
          app.log.error(e);
        }
        db.addMessage({ conversationId: current.id, sender: "bot", direction: "out", body: out });
        hub.broadcast({ type: "message.new", conversationId: current.id });
      }

      reply.code(200).send({ ok: true });
    });

  app.post("/auth/login", async (req, reply) => {
    const body = parseLoginBody(req.body);
    const user = db.findUserByEmail(body.email);
    if (!user) return reply.code(401).send({ error: "invalid_credentials" });
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });
    const token = signJwt({ id: user.id, email: user.email }, cfg.JWT_SECRET);
    reply.send({ token });
  });

  const authPreHandler = requireAuth(db, cfg.JWT_SECRET);

  app.get("/api/me", { preHandler: authPreHandler }, async (req) => {
    const u = getAuthUser(req);
    return { id: u.id, email: u.email };
  });

  app.get("/api/conversations", { preHandler: authPreHandler }, async (req) => {
    const u = getAuthUser(req);
    const q = req.query as any;
    const statusRaw = typeof q.status === "string" ? q.status : null;
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    const offset = Math.max(0, Number(q.offset ?? 0));

    if (statusRaw === "assigned") {
      const items = db.listAssignedConversations(u.id, limit, offset);
      return { items };
    }
    const status = statusRaw === "bot" || statusRaw === "needs_agent" || statusRaw === "closed" ? statusRaw : null;
    const items = db.listConversations(status, limit, offset);
    return { items };
  });

  app.get("/api/conversations/:id/messages", { preHandler: authPreHandler }, async (req) => {
    const p = req.params as any;
    const q = req.query as any;
    const limit = Math.min(500, Math.max(1, Number(q.limit ?? 200)));
    const offset = Math.max(0, Number(q.offset ?? 0));
    const order = typeof q.order === "string" ? q.order : "asc";
    const items = order === "desc" ? db.listMessagesDesc(String(p.id), limit, offset) : db.listMessages(String(p.id), limit, offset);
    return { items };
  });

  app.get("/api/media/:mediaId", async (req, reply) => {
    const auth = req.headers.authorization;
    const q = (req.query as any) ?? {};
    const token =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length).trim()
        : typeof q.token === "string"
          ? q.token
          : "";
    const user = verifyJwt(token, cfg.JWT_SECRET);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const exists = db.getUserById(user.id);
    if (!exists) return reply.code(401).send({ error: "unauthorized" });

    const p = req.params as any;
    const mediaId = String(p.mediaId);
    const info = await getWhatsappMediaInfo(cfg, mediaId);
    const res = await fetch(info.url, { headers: { Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return reply.code(502).send({ error: `media_fetch_failed:${res.status}:${text}` });
    }
    if (info.mimeType) reply.header("Content-Type", info.mimeType);
    const buf = Buffer.from(await res.arrayBuffer());
    reply.send(buf);
  });

  app.post("/api/conversations/:id/claim", { preHandler: authPreHandler }, async (req, reply) => {
    const u = getAuthUser(req);
    const p = req.params as any;
    const updated = db.claimConversation(String(p.id), u.id);
    if (!updated) return reply.code(409).send({ error: "cannot_claim" });
    hub.broadcast({ type: "conversation.updated", conversationId: updated.id });
    return { ok: true };
  });

  app.post("/api/conversations/:id/close", { preHandler: authPreHandler }, async (req, reply) => {
    const u = getAuthUser(req);
    const p = req.params as any;
    const conv = db.getConversation(String(p.id));
    if (!conv) return reply.code(404).send({ error: "not_found" });
    if (conv.status !== "assigned" || conv.assignedUserId !== u.id) {
      return reply.code(403).send({ error: "not_assigned" });
    }

    const agentText = "Este chat ha sido finalizado. A partir de ahora te atenderá el bot.";
    const botText = "Se ha finalizado la conversación. Si necesitas algo más, cuéntame.";

    try {
      await sendWhatsappText(cfg, conv.waId, agentText);
      await sendWhatsappText(cfg, conv.waId, botText);
    } catch (e) {
      app.log.error(e);
      return reply.code(502).send({ error: "whatsapp_send_failed" });
    }

    db.addMessage({ conversationId: conv.id, sender: "agent", direction: "out", contentType: "text", body: agentText });
    db.addMessage({ conversationId: conv.id, sender: "bot", direction: "out", contentType: "text", body: botText });
    db.updateConversationStatus(conv.id, "closed", null);
    hub.broadcast({ type: "conversation.updated", conversationId: conv.id });
    hub.broadcast({ type: "message.new", conversationId: conv.id });
    return { ok: true };
  });

  app.post("/api/conversations/:id/messages", { preHandler: authPreHandler }, async (req, reply) => {
    const u = getAuthUser(req);
    const p = req.params as any;
    const body = req.body as any;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return reply.code(400).send({ error: "text_required" });
    const conv = db.getConversation(String(p.id));
    if (!conv) return reply.code(404).send({ error: "not_found" });
    if (conv.status !== "assigned" || conv.assignedUserId !== u.id) {
      return reply.code(403).send({ error: "not_assigned" });
    }

    try {
      await sendWhatsappText(cfg, conv.waId, text);
    } catch (e) {
      app.log.error(e);
      return reply.code(502).send({ error: "whatsapp_send_failed" });
    }
    db.addMessage({ conversationId: conv.id, sender: "agent", direction: "out", body: text });
    hub.broadcast({ type: "message.new", conversationId: conv.id });
    return { ok: true };
  });

  app.post("/api/conversations/:id/image", { preHandler: authPreHandler }, async (req, reply) => {
    const u = getAuthUser(req);
    const p = req.params as any;
    const conv = db.getConversation(String(p.id));
    if (!conv) return reply.code(404).send({ error: "not_found" });
    if (conv.status !== "assigned" || conv.assignedUserId !== u.id) {
      return reply.code(403).send({ error: "not_assigned" });
    }

    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: "file_required" });
    const mimeType = String(file.mimetype || "");
    if (!mimeType.startsWith("image/")) return reply.code(400).send({ error: "only_images_allowed" });
    const buffer = await file.toBuffer();
    const filename = file.filename || "image";

    let mediaId: string;
    try {
      const up = await uploadWhatsappMedia(cfg, { filename, mimeType, buffer });
      mediaId = up.mediaId;
      await sendWhatsappImage(cfg, conv.waId, mediaId);
    } catch (e) {
      app.log.error(e);
      return reply.code(502).send({ error: "whatsapp_send_failed" });
    }

    db.addMessage({
      conversationId: conv.id,
      sender: "agent",
      direction: "out",
      contentType: "image",
      body: "",
      mediaId,
      mediaMime: mimeType
    });
    hub.broadcast({ type: "message.new", conversationId: conv.id });
    return { ok: true };
  });

  app.get("/ws", { websocket: true }, (conn, req) => {
    const q = (req.query as any) ?? {};
    const token = typeof q.token === "string" ? q.token : "";
    const user = verifyJwt(token, cfg.JWT_SECRET);
    if (!user) {
      const ws = (conn as any).socket ?? (conn as any);
      ws?.close?.();
      return;
    }
    const ws = (conn as any).socket ?? (conn as any);
    if (!ws) {
      return;
    }
    hub.add(user.id, ws);
  });

  await app.listen({ port: Number(cfg.PORT), host: cfg.HOST });
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
