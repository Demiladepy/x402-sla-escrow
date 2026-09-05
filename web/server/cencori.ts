export type Quote = {
  pair: string;
  rate: number;
  asOf: number;
  via: "cencori" | "static";
};

const BASE = (process.env.CENCORI_BASE_URL ?? "https://api.cencori.com/v1").replace(/\/$/, "");
const MODEL = process.env.CENCORI_MODEL ?? "gpt-4o";
const BUDGET_MS = 450;

/**
 * Published mids the SLA is measured against. Cencori formats the quote; it
 * does not invent a price. If the gateway is slow or unset, we still serve.
 */
export async function quotePair(pair: string, published: number): Promise<Quote> {
  const asOf = Math.floor(Date.now() / 1000);
  const key = process.env.CENCORI_API_KEY;
  if (!key) return { pair, rate: published, asOf, via: "static" };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BUDGET_MS);

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You format an FX mid for a paid HTTP seller. Return only JSON {pair, rate, asOf}. rate must equal the published mid. asOf is the unix seconds you were given.",
          },
          {
            role: "user",
            content: JSON.stringify({ pair, publishedMid: published, asOf }),
          },
        ],
      }),
    });
    if (!res.ok) return { pair, rate: published, asOf, via: "static" };
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return { pair, rate: published, asOf, via: "static" };
    const parsed = JSON.parse(raw) as { pair?: string; rate?: number; asOf?: number };
    const rate = typeof parsed.rate === "number" ? parsed.rate : published;
    return {
      pair: parsed.pair ?? pair,
      rate: rate === published ? rate : published,
      asOf: typeof parsed.asOf === "number" ? parsed.asOf : asOf,
      via: "cencori",
    };
  } catch {
    return { pair, rate: published, asOf, via: "static" };
  } finally {
    clearTimeout(timer);
  }
}

export function cencoriConfigured(): boolean {
  return Boolean(process.env.CENCORI_API_KEY);
}
