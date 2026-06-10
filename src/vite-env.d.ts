/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.css" {
  const src: string;
  export default src;
}

// Injected by Vite `define` at build time (see vite.config.ts).
declare const __BUILD_DATE__: string;
