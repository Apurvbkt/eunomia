// The app on Cloudflare: static assets from dist/, and the two endpoints the browser cannot
// do for itself. Same handlers as Vercel's api/*, with Cloudflare's env and rate limiter.
// On pubnet the relay refuses to sponsor anything unless RELAY_LIMITER is bound.
import { handleFaucet, type FaucetEnv } from "../src/lib/faucetHandler";
import { handleRelay, type RateLimiter, type RelayEnv } from "../src/lib/relayHandler";

interface Env extends RelayEnv, FaucetEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RELAY_LIMITER?: RateLimiter;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/relay") return handleRelay(request, env, env.RELAY_LIMITER);
    if (pathname === "/api/faucet") return handleFaucet(request, env);
    return env.ASSETS.fetch(request);
  },
};
