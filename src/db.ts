import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ConversationStatus = "bot" | "needs_agent" | "assigned" | "closed";
export type MessageSender = "customer" | "bot" | "agent";

export type ConversationRow = {
  id: string;
  waId: string;
  status: ConversationStatus;
  assignedUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  sender: MessageSender;
  direction: "in" | "out";
  contentType: "text" | "image";
  body: string;
  mediaId: string | null;
  mediaMime: string | null;
  waMessageId: string | null;
  createdAt: string;
};

export type UserRow = {
  id: number;
  email: string;
  passwordHash: string;
  createdAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function openDb(dbPath: string) {
  const abs = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const db = new Database(abs);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      wa_id TEXT NOT NULL,
      status TEXT NOT NULL,
      assigned_user_id INTEGER NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_wa_id ON conversations(wa_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      direction TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      body TEXT NOT NULL,
      media_id TEXT NULL,
      media_mime TEXT NULL,
      wa_message_id TEXT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  `);

  const cols = (db.prepare(`PRAGMA table_info(messages)`).all() as any[]).map((r) => String(r.name));
  if (!cols.includes("content_type")) db.exec(`ALTER TABLE messages ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text'`);
  if (!cols.includes("media_id")) db.exec(`ALTER TABLE messages ADD COLUMN media_id TEXT NULL`);
  if (!cols.includes("media_mime")) db.exec(`ALTER TABLE messages ADD COLUMN media_mime TEXT NULL`);

  const stmts = {
    findActiveConversationByWaId: db.prepare(
      `SELECT id, wa_id as waId, status, assigned_user_id as assignedUserId, created_at as createdAt, updated_at as updatedAt
       FROM conversations
       WHERE wa_id = ? AND status != 'closed'
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    insertConversation: db.prepare(
      `INSERT INTO conversations (id, wa_id, status, assigned_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    updateConversationStatus: db.prepare(
      `UPDATE conversations SET status = ?, assigned_user_id = ?, updated_at = ? WHERE id = ?`
    ),
    claimConversation: db.prepare(
      `UPDATE conversations
       SET status = 'assigned', assigned_user_id = ?, updated_at = ?
       WHERE id = ? AND status = 'needs_agent'`
    ),
    touchConversation: db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`),
    insertMessage: db.prepare(
      `INSERT INTO messages (id, conversation_id, sender, direction, content_type, body, media_id, media_mime, wa_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    listConversations: db.prepare(
      `SELECT id, wa_id as waId, status, assigned_user_id as assignedUserId, created_at as createdAt, updated_at as updatedAt
       FROM conversations
       WHERE (? IS NULL OR status = ?)
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`
    ),
    listAssignedConversations: db.prepare(
      `SELECT id, wa_id as waId, status, assigned_user_id as assignedUserId, created_at as createdAt, updated_at as updatedAt
       FROM conversations
       WHERE status = 'assigned' AND assigned_user_id = ?
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`
    ),
    getConversation: db.prepare(
      `SELECT id, wa_id as waId, status, assigned_user_id as assignedUserId, created_at as createdAt, updated_at as updatedAt
       FROM conversations WHERE id = ?`
    ),
    listMessagesByConversationId: db.prepare(
      `SELECT id, conversation_id as conversationId, sender, direction, content_type as contentType, body, media_id as mediaId, media_mime as mediaMime, wa_message_id as waMessageId, created_at as createdAt
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`
    ),
    listMessagesByConversationIdDesc: db.prepare(
      `SELECT id, conversation_id as conversationId, sender, direction, content_type as contentType, body, media_id as mediaId, media_mime as mediaMime, wa_message_id as waMessageId, created_at as createdAt
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ),
    findUserByEmail: db.prepare(
      `SELECT id, email, password_hash as passwordHash, created_at as createdAt FROM users WHERE email = ?`
    ),
    insertUser: db.prepare(
      `INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)`
    ),
    getUserById: db.prepare(
      `SELECT id, email, password_hash as passwordHash, created_at as createdAt FROM users WHERE id = ?`
    )
  };

  function getOrCreateActiveConversation(waId: string): ConversationRow {
    const existing = stmts.findActiveConversationByWaId.get(waId) as ConversationRow | undefined;
    if (existing) return existing;
    const id = randomUUID();
    const ts = nowIso();
    stmts.insertConversation.run(id, waId, "bot", null, ts, ts);
    return (stmts.getConversation.get(id) as ConversationRow)!;
  }

  function addMessage(input: {
    conversationId: string;
    sender: MessageSender;
    direction: "in" | "out";
    contentType?: "text" | "image";
    body: string;
    mediaId?: string | null;
    mediaMime?: string | null;
    waMessageId?: string | null;
  }): MessageRow {
    const id = randomUUID();
    const ts = nowIso();
    const contentType = input.contentType ?? "text";
    stmts.insertMessage.run(
      id,
      input.conversationId,
      input.sender,
      input.direction,
      contentType,
      input.body,
      input.mediaId ?? null,
      input.mediaMime ?? null,
      input.waMessageId ?? null,
      ts
    );
    stmts.touchConversation.run(ts, input.conversationId);
    return {
      id,
      conversationId: input.conversationId,
      sender: input.sender,
      direction: input.direction,
      contentType,
      body: input.body,
      mediaId: input.mediaId ?? null,
      mediaMime: input.mediaMime ?? null,
      waMessageId: input.waMessageId ?? null,
      createdAt: ts
    };
  }

  return {
    raw: db,
    getOrCreateActiveConversation,
    updateConversationStatus: (id: string, status: ConversationStatus, assignedUserId: number | null) => {
      stmts.updateConversationStatus.run(status, assignedUserId, nowIso(), id);
      return stmts.getConversation.get(id) as ConversationRow | undefined;
    },
    claimConversation: (id: string, userId: number) => {
      const ts = nowIso();
      const r = stmts.claimConversation.run(userId, ts, id);
      if (r.changes === 0) return undefined;
      return stmts.getConversation.get(id) as ConversationRow | undefined;
    },
    getConversation: (id: string) => stmts.getConversation.get(id) as ConversationRow | undefined,
    addMessage,
    listConversations: (status: ConversationStatus | null, limit: number, offset: number) =>
      stmts.listConversations.all(status, status, limit, offset) as ConversationRow[],
    listAssignedConversations: (userId: number, limit: number, offset: number) =>
      stmts.listAssignedConversations.all(userId, limit, offset) as ConversationRow[],
    listMessages: (conversationId: string, limit: number, offset: number) =>
      stmts.listMessagesByConversationId.all(conversationId, limit, offset) as MessageRow[],
    listMessagesDesc: (conversationId: string, limit: number, offset: number) =>
      stmts.listMessagesByConversationIdDesc.all(conversationId, limit, offset) as MessageRow[],
    findUserByEmail: (email: string) => stmts.findUserByEmail.get(email) as UserRow | undefined,
    getUserById: (id: number) => stmts.getUserById.get(id) as UserRow | undefined,
    insertUser: (email: string, passwordHash: string) => stmts.insertUser.run(email, passwordHash, nowIso())
  };
}

export type AppDb = ReturnType<typeof openDb>;
