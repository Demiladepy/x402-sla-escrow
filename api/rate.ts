import type { IncomingMessage, ServerResponse } from "node:http";
import { serveRate } from "./_lib/rateHandler.js";

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-payment");
  res.setHeader("access-control-expose-headers", "x-payment-receipt");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const host = header(req, "host") ?? "localhost";
  const url = new URL(req.url ?? "/api/rate", `http://${host}`);
  const result = await serveRate(url, header(req, "x-payment"));

  res.statusCode = result.status;
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  res.end(result.body);
}
