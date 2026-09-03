import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub project pages need /x402-sla-escrow/. Vercel and local stay /.
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5173,
    proxy: {
      // The seller's ledger, so the dashboard reads the same data the
      // settlement path does rather than a parallel source of truth.
      "/api": "http://127.0.0.1:4021",
    },
  },
});
