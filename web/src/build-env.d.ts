// Constants vite.config.ts injects at build time (see networks.ts). Undefined when a module is
// loaded outside Vite (Playwright), so code that can run there checks with `typeof` first.
declare const __EUNOMIA_NETWORK__: import("./networks").NetworkName;
declare const __EUNOMIA_NET__: import("./networks").NetworkConfig;
