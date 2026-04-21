import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppDb, UserRow } from "./db";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export type AuthUser = { id: number; email: string };

export function signJwt(input: AuthUser, jwtSecret: string) {
  return jwt.sign({ sub: String(input.id), email: input.email }, jwtSecret, { expiresIn: "7d" });
}

export function verifyJwt(token: string, jwtSecret: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, jwtSecret) as any;
    const id = Number(decoded.sub);
    if (!Number.isFinite(id)) return null;
    if (typeof decoded.email !== "string") return null;
    return { id, email: decoded.email };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function parseLoginBody(input: unknown) {
  return LoginSchema.parse(input);
}

export function requireAuth(db: AppDb, jwtSecret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized" });
    const token = auth.slice("Bearer ".length).trim();
    const user = verifyJwt(token, jwtSecret);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const row = db.getUserById(user.id);
    if (!row) return reply.code(401).send({ error: "unauthorized" });
    (req as any).authUser = { id: row.id, email: row.email } satisfies AuthUser;
  };
}

export function getAuthUser(req: FastifyRequest): AuthUser {
  const u = (req as any).authUser as AuthUser | undefined;
  if (!u) throw new Error("authUser missing");
  return u;
}

export async function ensureSeedUser(db: AppDb, email: string, password: string) {
  const exists = db.findUserByEmail(email);
  if (exists) return exists;
  const passwordHash = await hashPassword(password);
  db.insertUser(email, passwordHash);
  return db.findUserByEmail(email) as UserRow;
}

