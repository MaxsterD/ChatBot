import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.string().optional().default("3000"),
  HOST: z.string().optional().default("127.0.0.1"),
  BASE_URL: z.string().optional().default("http://localhost:3000"),
  DB_PATH: z.string().optional().default("./data/app.db"),
  JWT_SECRET: z.string().min(16),
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(8),
  WHATSAPP_VERIFY_TOKEN: z.string().min(6),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().optional()
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function getConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return parsed.data;
}
