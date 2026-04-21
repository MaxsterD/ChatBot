import crypto from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "./config";

const WebhookPayloadSchema = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            messages: z
              .array(
                z.object({
                  id: z.string().optional(),
                  from: z.string(),
                  timestamp: z.string().optional(),
                  type: z.string().optional(),
                  text: z.object({ body: z.string() }).optional(),
                  image: z
                    .object({
                      id: z.string(),
                      mime_type: z.string().optional(),
                      caption: z.string().optional()
                    })
                    .optional()
                })
              )
              .optional(),
            statuses: z.any().optional()
          })
        })
      )
    })
  )
});

export type InboundMessage =
  | { kind: "text"; waId: string; waMessageId: string | null; body: string }
  | { kind: "image"; waId: string; waMessageId: string | null; mediaId: string; mimeType: string | null; caption: string };

export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const parsed = WebhookPayloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const out: InboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const msgs = change.value.messages ?? [];
      for (const m of msgs) {
        const t = m.type ?? "";
        if (t === "text") {
          const body = m.text?.body;
          if (!body) continue;
          out.push({ kind: "text", waId: m.from, waMessageId: m.id ?? null, body });
          continue;
        }
        if (t === "image") {
          const mediaId = m.image?.id;
          if (!mediaId) continue;
          out.push({
            kind: "image",
            waId: m.from,
            waMessageId: m.id ?? null,
            mediaId,
            mimeType: m.image?.mime_type ?? null,
            caption: m.image?.caption ?? ""
          });
          continue;
        }
      }
    }
  }
  return out;
}

export function verifyMetaSignature(input: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  appSecret: string | undefined;
}): boolean {
  if (!input.appSecret) return true;
  if (!input.signatureHeader) return false;
  const prefix = "sha256=";
  if (!input.signatureHeader.startsWith(prefix)) return false;
  const received = input.signatureHeader.slice(prefix.length);
  const expected = crypto
    .createHmac("sha256", input.appSecret)
    .update(input.rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function sendWhatsappText(cfg: AppConfig, toWaId: string, body: string) {
  const url = `https://graph.facebook.com/v19.0/${cfg.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: { body }
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed (${res.status}): ${text}`);
  }
  return (await res.json().catch(() => ({}))) as unknown;
}

export async function getWhatsappMediaInfo(cfg: AppConfig, mediaId: string) {
  const url = `https://graph.facebook.com/v19.0/${mediaId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WhatsApp media info failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as any;
  return {
    url: String(data.url),
    mimeType: typeof data.mime_type === "string" ? data.mime_type : null
  };
}

export async function uploadWhatsappMedia(cfg: AppConfig, input: { filename: string; mimeType: string; buffer: Buffer }) {
  const url = `https://graph.facebook.com/v19.0/${cfg.WHATSAPP_PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  const bytes = new Uint8Array(input.buffer.buffer, input.buffer.byteOffset, input.buffer.byteLength);
  form.set("file", new Blob([bytes as any], { type: input.mimeType }), input.filename);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}` },
    body: form as any
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WhatsApp media upload failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as any;
  return { mediaId: String(data.id) };
}

export async function sendWhatsappImage(cfg: AppConfig, toWaId: string, mediaId: string, caption?: string) {
  const url = `https://graph.facebook.com/v19.0/${cfg.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId,
      type: "image",
      image: { id: mediaId, ...(caption ? { caption } : {}) }
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WhatsApp send image failed (${res.status}): ${text}`);
  }
  return (await res.json().catch(() => ({}))) as unknown;
}
