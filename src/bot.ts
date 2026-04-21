import type { AppDb, ConversationRow } from "./db";

function normalize(text: string) {
  return text.trim().toLowerCase();
}

export type BotDecision =
  | { type: "reply"; text: string }
  | { type: "escalate"; textToUser: string };

export function decideBotResponse(input: { conversation: ConversationRow; userText: string; db: AppDb }): BotDecision {
  const t = normalize(input.userText);
  const wantsAgent =
    t.includes("asesor") || t.includes("humano") || t.includes("agente") || t.includes("persona") || t === "0";

  if (wantsAgent) {
    return { type: "escalate", textToUser: "Listo. Te conecto con un asesor. Un momento por favor." };
  }

  return {
    type: "reply",
    text:
      "Aún no tengo la base de conocimiento cargada.\n\n" +
      "Si quieres, escribe ASESOR para que te atienda una persona.\n\n" +
      "Mientras tanto, envíame:\n" +
      "1) Módulo/pantalla\n" +
      "2) Mensaje de error exacto\n" +
      "3) Pasos que hiciste antes del error"
  };
}

