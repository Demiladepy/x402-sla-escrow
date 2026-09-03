/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SELLER_URL?: string;
  readonly VITE_APP_DOMAIN?: string;
  readonly VITE_MAINNET_ESCROW?: string;
  readonly VITE_MAINNET_DEPLOY_TX?: string;
  readonly VITE_MAINNET_SETTLE_TX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
