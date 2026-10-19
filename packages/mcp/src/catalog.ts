// Paid services an agent can buy with Stellar USDC: the ROZO MPP Router catalog (hundreds of
// routes — LLMs, search, scraping, data — behind one x402 endpoint on Stellar mainnet).
// Discovery is free and unauthenticated; paying is call.ts.
//
// One thing the catalog makes plain and the owner should know: almost every route settles to
// the same router address. Approving that address as a payee opens the whole catalog, so the
// per-payee cap on it is one bucket for every service. Narrower limits (which services, how
// much each) live here, in the agent's tooling, and in the task budgets the owner approves.

export const ROZO_BASE_URL = "https://apiserver.mpprouter.dev";

/** A catalog route, trimmed to what an agent needs to choose and call it. */
export interface ServiceRoute {
  id: string;
  name: string;
  description: string;
  categories: string[];
  /** absolute URL to call */
  url: string;
  method: string;
  /** human-readable, e.g. "$0.010/request" or a range ending in "(dynamic)" */
  price: string;
  /** fixed price in USDC when the route has one */
  priceUsdc: string | null;
  /** where the payment settles — the address the owner must have approved */
  payTo: string | null;
  network: string | null;
  /** ROZO made a real paid call through this route */
  verified: boolean;
  status: string;
  docs: string | null;
}

interface RawRoute {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  categories?: string[];
  public_path: string;
  method?: string;
  price?: string;
  status?: string;
  payment_enabled?: boolean;
  charge_rozo_verified?: boolean | null;
  methods?: { stellar_x402?: { pay_to?: string; network?: string } };
  payment_hints?: { pay_to?: string; network?: string; amount_usdc?: string };
  docs?: { llms_txt?: string; api_reference?: string; homepage?: string };
}

// The catalog's text arrives double-encoded in places (UTF-8 read as Windows-1252): "â€“"
// where an en dash was meant. Undo the common sequences rather than show the agent noise.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const MOJIBAKE: Array<[string, string]> = [
  [cp(0xe2, 0x20ac, 0x201c), cp(0x2013)], // en dash
  [cp(0xe2, 0x20ac, 0x201d), cp(0x2014)], // em dash
  [cp(0xe2, 0x20ac, 0x2122), cp(0x2019)], // right single quote
  [cp(0xe2, 0x20ac, 0x0153), cp(0x201c)], // left double quote
  [cp(0xe2, 0x20ac, 0x009d), cp(0x201d)], // right double quote
  [cp(0xe2, 0x20ac, 0x00a6), cp(0x2026)], // ellipsis
];
export const tidy = (s: string | undefined): string =>
  MOJIBAKE.reduce((acc, [bad, good]) => acc.split(bad).join(good), s ?? "").trim();

export function toRoute(r: RawRoute, base = ROZO_BASE_URL): ServiceRoute {
  const payTo = r.methods?.stellar_x402?.pay_to ?? r.payment_hints?.pay_to ?? null;
  return {
    id: r.id,
    name: tidy(r.name ?? r.id),
    description: tidy(r.description),
    categories: r.categories ?? (r.category ? [r.category] : []),
    url: base + r.public_path,
    method: (r.method ?? "POST").toUpperCase(),
    price: tidy(r.price),
    priceUsdc: r.payment_hints?.amount_usdc ?? null,
    payTo,
    network: r.methods?.stellar_x402?.network ?? r.payment_hints?.network ?? null,
    verified: r.charge_rozo_verified === true,
    status: r.status ?? "unknown",
    docs: r.docs?.llms_txt ?? r.docs?.api_reference ?? r.docs?.homepage ?? null,
  };
}

export interface SearchArgs {
  query?: string;
  category?: string;
  /** only routes ROZO has paid through itself */
  verifiedOnly?: boolean;
  limit?: number;
}

export async function searchServices(
  args: SearchArgs,
  fetchImpl: typeof fetch = globalThis.fetch,
  base = ROZO_BASE_URL,
): Promise<{ total: number; routes: ServiceRoute[] }> {
  const q = new URLSearchParams();
  if (args.query) q.set("q", args.query);
  if (args.category) q.set("category", args.category);
  // Ask for the most the router serves: unpayable and (optionally) unverified routes are
  // dropped below, and the catalog lists them in no particular order.
  q.set("limit", "100");
  const res = await fetchImpl(`${base}/v1/services/search?${q}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`service catalog answered ${res.status}`);
  const body = (await res.json()) as { total?: number; services?: RawRoute[] };
  const routes = (body.services ?? [])
    .filter((r) => r.payment_enabled !== false)
    .map((r) => toRoute(r, base))
    .filter((r) => r.payTo !== null && (!args.verifiedOnly || r.verified))
    // verified routes first: they are the ones known to deliver after payment
    .sort((a, b) => Number(b.verified) - Number(a.verified));
  return { total: body.total ?? routes.length, routes: routes.slice(0, args.limit ?? 10) };
}
