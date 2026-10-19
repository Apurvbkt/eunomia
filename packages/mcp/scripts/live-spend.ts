// Live, on Stellar testnet: the whole D2/D3 spending path through eunomia-mcp's own code.
//
//   1. a v4 treasury from the factory (owner = the `alice` CLI identity), XLM
//   2. the owner approves a task budget for a fresh agent key, naming the agent itself (for
//      its float) and one vendor — the same signature an approval link produces
//   3. fund_float: treasury pay() to the agent's own account
//   4. call_service: a real HTTP 402 from a local seller, settled by the official
//      @x402/stellar facilitator, paid from the float with the agent's key
//   5. call_service to a payee the treasury never approved: refused, nothing signed
//   6. fund_float past the agent's monthly payee cap: refused by the contract (#14)
//   7. sweep_float: the rest goes back to the treasury
//
// Needs the stellar CLI with the `alice` identity. Run: npx tsx scripts/live-spend.ts
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Keypair } from "@stellar/stellar-sdk";
import { x402Facilitator } from "@x402/core/facilitator";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as FacilitatorScheme } from "@x402/stellar/exact/facilitator";
import { memoryCache } from "../src/cache.js";
import { callService } from "../src/call.js";
import { fundFloat, sweepFloat } from "../src/float.js";
import { NETWORKS } from "../src/network.js";
import type { ServerContext } from "../src/server.js";
import { memoryExceptionStore, memoryPurchaseLog } from "../src/store.js";

const FACTORY = "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK";
const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const XLM_1 = 10_000_000n;
const net = NETWORKS.testnet;

const invoke = (id: string, fn: string, args: string[] = []) =>
  execFileSync("stellar", ["contract", "invoke", "--id", id, "--source", "alice", "--network", "testnet", "--", fn, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const friendbot = async (a: string) => {
  const r = await fetch(`${net.friendbot}?addr=${a}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${a}: ${r.status}`);
};

const alice = execFileSync("stellar", ["keys", "address", "alice"], { encoding: "utf8" }).trim();
const agent = Keypair.random();
const vendor = Keypair.random();
const stranger = Keypair.random();
const facilitatorKey = Keypair.random();
await Promise.all([agent, vendor, stranger, facilitatorKey].map((k) => friendbot(k.publicKey())));
console.log("agent", agent.publicKey(), "\nvendor", vendor.publicKey());

// 1. treasury: daily 100 / per-payment 10 XLM, monthly 200; the agent's own address capped at 4 XLM a month
const setup = {
  owner: alice,
  token: XLM,
  daily_limit: String(100n * XLM_1),
  per_task_limit: String(10n * XLM_1),
  monthly_limit: String(200n * XLM_1),
  payees: [vendor.publicKey(), agent.publicKey()],
  payee_caps: [{ payee: agent.publicKey(), cap: String(4n * XLM_1) }],
  leash: [],
  fund: String(20n * XLM_1),
  register: false,
  salt: randomBytes(32).toString("hex"),
};
const treasury = JSON.parse(invoke(FACTORY, "create", ["--s", JSON.stringify(setup)])) as string;
console.log("\n1. treasury", treasury);

// 2. the task budget an approval link signs
const until = Math.floor(Date.now() / 1000) + 3600;
invoke(treasury, "set_task_budget", [
  "--agent", agent.publicKey(), "--valid_until", String(until), "--limit", String(8n * XLM_1),
  "--payees", JSON.stringify([agent.publicKey(), vendor.publicKey()]),
]);
console.log("2. task budget: 8 XLM for 1h, payees = agent + vendor");

const ctx: ServerContext = {
  net,
  treasuryId: treasury,
  credential: { version: 1, network: "testnet", treasuryId: treasury, agentPublicKey: agent.publicKey(), agentSecret: agent.secret(), createdAt: new Date().toISOString() },
  cache: memoryCache(),
  exceptions: memoryExceptionStore(),
  purchases: memoryPurchaseLog(),
};

// 3. float
const funded = await fundFloat(ctx, 3n * XLM_1, 7n);
if (!funded.paid) throw new Error(`fund_float refused: ${funded.message} ${JSON.stringify(funded.reasons)}`);
console.log("3. fund_float 3 XLM:", funded.txHash);

// 4. a seller behind a real 402 + the official facilitator
const facilitator = new x402Facilitator().register(
  "stellar:testnet",
  new FacilitatorScheme([createEd25519Signer(facilitatorKey.secret(), "stellar:testnet")]),
);
const requirementsFor = (payTo: string) => ({
  scheme: "exact",
  network: "stellar:testnet" as const,
  amount: String(XLM_1),
  asset: XLM,
  payTo,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
});
const server = createServer(async (req, res) => {
  const accepts = [requirementsFor(req.url === "/elsewhere" ? stranger.publicKey() : vendor.publicKey())];
  const header = req.headers["payment-signature"];
  if (!header || Array.isArray(header)) {
    res.writeHead(402, {
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
        x402Version: 2,
        resource: { url: `http://${req.headers.host}${req.url}`, description: "search", mimeType: "application/json" },
        accepts,
      }),
    });
    res.end("{}");
    return;
  }
  try {
    const payload = decodePaymentSignatureHeader(header);
    const v = await facilitator.verify(payload, accepts[0]);
    if (!v.isValid) throw new Error(`verify: ${v.invalidReason}`);
    const s = await facilitator.settle(payload, accepts[0]);
    if (!s.success) throw new Error(`settle: ${s.errorReason}`);
    res.writeHead(200, { "content-type": "application/json", "PAYMENT-RESPONSE": encodePaymentResponseHeader(s) });
    res.end(JSON.stringify({ results: ["three suppliers"], paidTx: s.transaction }));
  } catch (e) {
    res.writeHead(402, { "payment-error": (e as Error).message });
    res.end("{}");
  }
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const bought = await callService(ctx, { url: `${base}/search`, maxPrice: 2n * XLM_1 });
if ("refused" in bought || !bought.paid) throw new Error(`call_service did not pay: ${JSON.stringify(bought, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
console.log("4. call_service paid 1 XLM to the vendor:", bought.txHash, "→", JSON.stringify(bought.body));

// 5. a payee the treasury never approved
const refused = await callService(ctx, { url: `${base}/elsewhere`, maxPrice: 2n * XLM_1 });
if (!("refused" in refused)) throw new Error("an unapproved payee was paid");
console.log("5. unapproved payee refused before signing:", refused.options[0].problems.join("; "));
server.close();

// 6. the agent's own address is capped at 4 XLM a month; 3 are already out
const overCap = await fundFloat(ctx, 2n * XLM_1, 7n);
if (overCap.paid) throw new Error("the payee cap did not hold");
console.log("6. fund_float past the agent's cap refused:", overCap.reasons.map((r) => `#${r.code} ${r.name}`).join(", "));

// 7. return the rest (on XLM the amount is named; see sweepFloat)
const swept = await sweepFloat(ctx, 2n * XLM_1);
console.log("7. sweep_float 2 XLM:", swept.status, swept.txHash);
const back = BigInt(invoke(treasury, "balance").replace(/"/g, ""));
console.log(`\ntreasury balance ${back} stroops (20 − 3 float + 2 swept = 19 XLM expected)`);
if (back !== 19n * XLM_1) throw new Error("treasury balance does not add up");
console.log("\nLIVE OK");
