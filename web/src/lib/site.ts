/** Public origin: the existing Vercel deployment. */
export const APP_DOMAIN = (
  import.meta.env.VITE_APP_DOMAIN ?? "https://web-one-drab-31.vercel.app"
).replace(/\/$/, "");
