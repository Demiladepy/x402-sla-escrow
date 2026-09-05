import type { IncomingMessage, ServerResponse } from "node:http";
import { serveRate } from "./rateHandler.js";
import { describeStack } from "./stack.js";

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function cors(res: ServerResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-payment");
  res.setHeader("access-control-expose-headers", "x-payment-receipt");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
}

export async function handleRateRequest(req: IncomingMessage, res: ServerResponse) {
  cors(res);
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

export function handleStackRequest(req: IncomingMessage, res: ServerResponse) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(describeStack()));
}
