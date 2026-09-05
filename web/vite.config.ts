import { loadEnv } from "vite";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { serveRate } from "./server/rateHandler";
import { describeStack } from "./server/stack";

const rootEnv = loadEnv("", fileURLToPath(new URL("..", import.meta.url)), "");
for (const [k, v] of Object.entries(rootEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

function publicApi(): Plugin {
  return {
    name: "public-api",
    configureServer(server) {
      server.middlewares.use(async (req: Connect.IncomingMessage, res, next) => {
        const raw = req.url ?? "";
        const path = raw.split("?")[0];
        if (path !== "/api/rate" && path !== "/api/stack") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (path === "/api/stack") {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.setHeader("access-control-allow-origin", "*");
          res.end(JSON.stringify(describeStack()));
          return;
        }
        const url = new URL(raw, "http://localhost");
        const payment = req.headers["x-payment"];
        const result = await serveRate(url, Array.isArray(payment) ? payment[0] : payment);
        res.statusCode = result.status;
        for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
        res.end(result.body);
      });
    },
  };
}

function bypassPublic(url?: string) {
  const path = url?.split("?")[0];
  return path === "/api/rate" || path === "/api/stack" ? url : undefined;
}

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), publicApi()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4021",
        bypass: (req) => bypassPublic(req.url),
      },
    },
  },
});
