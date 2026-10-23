// Build gate: nothing that can sign on a real network may ship in the bundle.
//
// The in-app guard for the embedded demo key lives in src/demo/config.ts, beside the value it
// guards — so a rushed cutover could delete it. This check does not: it reads what was
// actually produced, runs as part of every build, and fails the build rather than warning.
//
// The policy it encodes, which is the one the project actually holds:
//
//   * the testnet guided demo deliberately embeds ONE throwaway agent key, and that is fine
//     for exactly as long as the bundle targets testnet;
//   * a mainnet bundle carries no secret seed at all, no trace of the demo (its key, its
//     agent and treasury addresses), and never talks to a testnet endpoint;
//   * no OTHER secret seed may ever appear, whatever the network;
//   * the test-signer bypass must be folded away by the minifier — if the global
//     survives into the bundle it is reachable or near-reachable code, and it is
//     ready-made material for a "paste this in your console" script.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** The disclosed, worthless demo key (see SECURITY.md). Testnet only, by policy. */
const KNOWN_DEMO_KEY = "SC6F5K7IPNX6MMN2JAV766FU7WKWYQ3M34W3MOLCPXTU55HSKS2BT2XV";
const SECRET_SEED = /S[A-Z2-7]{55}/g;
const TEST_SIGNER = /__EUNOMIA_TEST_SIGNER__/g;

// What a mainnet bundle must not contain even with every seed gone: the demo's own
// addresses (proof its module was dropped, not just its key renamed or encoded) and the
// testnet endpoints (proof nothing in the app still talks to the wrong network).
const MAINNET_FORBIDDEN = [
  ["the demo agent's address", "GDAOXABLEOFZP2M4PRM7N6YKOKXWMPFOSLU35WL5ZQY4PQFHF3VCIDS6"],
  ["the demo treasury", "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ"],
  ["the demo funding pool", "GD2NZKSMQW367OIFXRM4NP7RIW6YLDZLJ4C7253MDOKCFC4Q4IOO3427"],
  ["the testnet RPC", "soroban-testnet.stellar.org"],
  ["testnet Horizon", "horizon-testnet.stellar.org"],
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs|cjs|html|css|map)$/.test(entry)) out.push(p);
  }
  return out;
}

// The network comes from the build itself (vite.config.ts writes it beside the bundle from the
// same resolved config that was compiled in), never from a guess. Searching the bundle for the
// testnet passphrase looks reasonable and is wrong: stellar-sdk ships the same string in its
// own `Networks` constant, so it would read "testnet" forever, including on a mainnet build.
const INFO = join(DIST, "build-info.json");
if (!existsSync(INFO)) {
  console.error("check:no-secrets — dist/build-info.json is missing; cannot tell which network this bundle targets");
  process.exit(1);
}
const { network } = JSON.parse(readFileSync(INFO, "utf8"));
if (network !== "testnet" && network !== "pubnet") {
  console.error(`check:no-secrets — unknown network "${network}" in dist/build-info.json`);
  process.exit(1);
}
const targetsTestnet = network === "testnet";

const files = walk(DIST).map((path) => ({ path, body: readFileSync(path, "utf8") }));
const problems = [];

for (const { path, body } of files) {
  const where = path.replace(DIST, "dist/");

  for (const seed of body.match(SECRET_SEED) ?? []) {
    if (seed === KNOWN_DEMO_KEY && targetsTestnet) continue; // disclosed, testnet-only
    problems.push(
      seed === KNOWN_DEMO_KEY
        ? `${where}: the embedded demo key is present but this bundle no longer targets testnet — it is a live signing key now`
        : `${where}: an undeclared secret seed "${seed.slice(0, 12)}…" reached the bundle`,
    );
  }

  if (!targetsTestnet) {
    for (const [what, needle] of MAINNET_FORBIDDEN) {
      if (body.includes(needle)) problems.push(`${where}: a mainnet bundle contains ${what}`);
    }
  }

  if (TEST_SIGNER.test(body)) {
    problems.push(
      `${where}: the test-signer global survived minification — the wallet bypass is in the published bundle`,
    );
    TEST_SIGNER.lastIndex = 0;
  }
}

if (problems.length) {
  console.error("\nBuild refused — check:no-secrets\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nMove signing server-side (api/relay.ts is the pattern) before shipping.\n");
  process.exit(1);
}

console.log(
  `check:no-secrets — ${files.length} built assets clean` +
    (targetsTestnet ? " (testnet bundle, demo key allowed)" : " (mainnet bundle, no keys, no demo, no testnet endpoints)"),
);
