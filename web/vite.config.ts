import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { serveRate } from "../api/_lib/rateHandler";

function publicRate(): Plugin {
  return {
    name: "public-rate",
    configureServer(server) {
      server.middlewares.use(async (req: Connect.IncomingMessage, res, next) => {
        const raw = req.url ?? "";
        const path = raw.split("?")[0];
        if (path !== "/api/rate") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
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

export default defineConfig({
  // GitHub project pages need /x402-sla-escrow/. Vercel and local stay /.
  base: process.env.VITE_BASE || "/",
  plugins: [react(), publicRate()],
  server: {
    port: 5173,
    proxy: {
      // Ledger/state stay on the local demo seller when one is running.
      // /api/rate is served above, so the Call playground works without it.
      "/api": {
        target: "http://127.0.0.1:4021",
        bypass: (req) => (req.url?.split("?")[0] === "/api/rate" ? req.url : undefined),
      },
    },
  },
});
