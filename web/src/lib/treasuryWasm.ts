// The treasury WASM the app instantiates for every new user treasury.
//
// Deliberately dependency-free: both the browser bundle and the serverless relay import it,
// and the relay runs outside Vite, where anything reaching `import.meta.env` breaks.
//
// v4 (2026-10-19): a calendar-month budget, monthly caps per payee, task budgets (a Leash
// limited to named payees) and a deposit cap fixed at deploy. Error codes 14-17. Carries
// v3.5's MAX_BATCH ceiling and the surfaces a compliance proof binds to forward unchanged.
//
// Older treasuries keep running the code they were born with; contracts are immutable by
// design, so a treasury created with a policy past the ceiling stays that way.
export const TREASURY_WASM_HASH =
  "c11a5c63e610be259cdcf23d276fdf6f3069fdc6069c4d713b52d556f24238ec";

/** The treasury factory (testnet v4, 2026-10-19): one owner signature deploys a v4 treasury
 *  with its policy, monthly budget, payees and their caps, Leash, funding and registry entry
 *  (contracts/treasury_factory). Pinned to TREASURY_WASM_HASH, the registry and the deposit
 *  cap at its own deploy; it has no admin. The relay admits it by address, so a passkey
 *  user's single call is sponsored like any other. */
export const TREASURY_FACTORY_ID = "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK";

/** The deposit cap the factory above pins on every treasury: 1,000 XLM on testnet. Mirrored
 *  here only so the app can say so before the owner signs; the contract is what enforces it. */
export const DEPOSIT_CAP_STROOPS = 10_000_000_000n;

/** Factories this app created treasuries through before. Kept so the relay still sponsors a
 *  call on one (an old factory is harmless to admit: it can only deploy its own pinned code). */
export const LEGACY_TREASURY_FACTORY_IDS = [
  // v3.5 factory (2026-09-16)
  "CAWLFTQ4V3ZPUWRVL5RGXBBA7FMJ26EXW37GGKCGKOXO4TKABEHF2OMS",
];

/** Treasury code this app deployed in the past and must keep able to spend.
 *
 *  Contracts are immutable: a treasury created last week still runs last week's wasm, and
 *  its owner's funds are inside it. The relay decides what it will sponsor by wasm hash,
 *  so dropping an old hash when a new version ships does not deprecate it — it locks that
 *  owner out of their own treasury through the passkey path, which has no other way to
 *  pay a fee. Shipping v3.5 did exactly that to every v3.4 treasury for the minutes it
 *  took to notice.
 *
 *  Append here when the shipped hash moves; never replace. */
export const LEGACY_TREASURY_WASM_HASHES = [
  // v3.5 (2026-08-07) — daily limit capped at MAX_BATCH x per-payment
  "824472060b3abec7c6c64e8985fa5d0c5a39ea277fbb67eab3125a483d059641",
  // v3.4 (2026-08-06) — period_spent + whitelist_root, the surfaces a proof binds to
  "b813a1e7a3d2ddb1013dbaa11a41dcc1fbed984a30cfef9023dc199b12131a72",
  // v3.1/v3.2 era — session keys, lifecycle, rolling window
  "475cfbe2ca79d7977c8e4d29438ae70b9d95a12cb2bfcd9fed4e4f7a26d798b2",
];
