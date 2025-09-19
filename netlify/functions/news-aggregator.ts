// netlify/functions/news-aggregator.ts
import type { Handler } from "@netlify/functions";

/** ===== Tipos de respuesta ===== */
type Verdict = "Alcista" | "Bajista" | "Mixto/Neutro";
type SummaryBlock = {
  verdict: Verdict;
  confidence: number; // 0–100
  reasons: string[]; // puntos cortos
  summary: string; // 1–3 frases explicativas
};

type ApiResponse = {
  updatedAt: number; // epoch ms
  shortTerm: SummaryBlock; // 24–72h
  mediumTerm: SummaryBlock; // 1–2 semanas
  sampleHeadlines: { title: string; source: string }[];
};

/** ===== Headers consistentes ===== */
const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=60",
};

/** ===== Handler Netlify ===== */
export const handler: Handler = async (_event, _context) => {
  try {
    // ⚡️ Aquí deberías integrar tus APIs de noticias reales (CryptoPanic, CoinDesk, CoinTelegraph, RSS, etc.)
    // Para testeo dejamos un payload estático de ejemplo:

    const payload: ApiResponse = {
      updatedAt: Date.now(),
      shortTerm: {
        verdict: "Mixto/Neutro",
        confidence: 55,
        reasons: [
          "Noticias macro mixtas (inflación y política monetaria).",
          "Narrativas cripto con actividad en adopción retail.",
        ],
        summary:
          "En el corto plazo (24–72h) el sentimiento es neutral: algunas noticias de riesgo macro pesan a la baja, mientras que la adopción y el uso en cadenas secundarias apoyan el mercado.",
      },
      mediumTerm: {
        verdict: "Alcista",
        confidence: 68,
        reasons: [
          "Mayor exposición institucional a BTC/ETH.",
          "Menor presión vendedora en exchanges.",
        ],
        summary:
          "A mediano plazo (1–2 semanas) predomina un sesgo alcista. El flujo institucional y la reducción de balances en exchanges sugieren soporte, aunque la volatilidad global puede interrumpir avances.",
      },
      sampleHeadlines: [
        {
          title: "Institucionales incrementan exposición a cripto",
          source: "Ejemplo 1",
        },
        {
          title: "Datos macro mixtos mantienen a los mercados cautos",
          source: "Ejemplo 2",
        },
        {
          title: "Actividad en L2 alcanza nuevo máximo mensual",
          source: "Ejemplo 3",
        },
      ],
    };

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: {
        ...JSON_HEADERS,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        ok: false,
        error:
          typeof err?.message === "string" ? err.message : "Internal error",
      }),
    };
  }
};
