// The app on Cloudflare: static assets from dist/, and the two endpoints the browser cannot
// do for itself. Same handlers as Vercel's api/*, with Cloudflare's env, rate limiters and
// the Durable Object that holds the relay's daily fee total. On pubnet the relay refuses to
// sponsor anything unless all three are bound.
import { handleFaucet, type FaucetEnv } from "../src/lib/faucetHandler";
import { handleRelay, type RateLimiter, type RelayEnv } from "../src/lib/relayHandler";
import { durableBudget, type BudgetNamespace } from "./relayBudget";

export { RelayBudget } from "./relayBudget";

interface Env extends RelayEnv, FaucetEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RELAY_LIMITER?: RateLimiter;
  RELAY_WALLET_LIMITER?: RateLimiter;
  RELAY_BUDGET?: BudgetNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/relay") {
      return handleRelay(request, env, {
        limiter: env.RELAY_LIMITER,
        walletLimiter: env.RELAY_WALLET_LIMITER,
        budget: env.RELAY_BUDGET ? durableBudget(env.RELAY_BUDGET) : undefined,
      });
    }
    if (pathname === "/api/faucet") return handleFaucet(request, env);
    return env.ASSETS.fetch(request);
  },
};
