# Can the treasury settle an MPP charge directly?

*SOW 2, deliverable 2: "We also test whether the treasury contract can settle an MPP charge
directly (money stays in the contract until the moment of payment) and ship it if the
facilitator accepts it." Result, 2026-10-19: **no — not with the facilitators that exist.**
What ships instead is the bounded task float.*

## The question

The ideal path keeps every unit inside the contract until the instant of payment: the agent
signs a transaction that calls `treasury.pay(task, to = seller, amount)`, the treasury checks
its policy and moves the money, and the seller's server accepts that transaction as payment
for the call. No float, nothing outside the contract's protection.

## What the seller's server accepts

The catalog we target, the ROZO MPP Router, verifies Stellar payments with `@stellar/mpp`'s
charge server (`src/mpp/stellar-server.ts` in
[mpprouter/rozo-mpprouter](https://github.com/mpprouter/rozo-mpprouter): `stellar({ currency,
recipient, feePayer, … })` from `@stellar/mpp/charge/server`). Reading that server
(`@stellar/mpp` 0.7.1, `dist/charge/server/Charge.js`), a credential is accepted only when:

1. **The payer is a `G…` account.** The credential's `source` is a `did:pkh:stellar:<net>:<key>`
   and the key goes through `Keypair.fromPublicKey` (`publicKeyFromDID`). A contract address
   is not a key and is rejected before anything else is looked at.
2. **The transaction is exactly one SEP-41 `transfer` on the currency contract.**
   `verifyTokenTransfer` requires the single operation's contract to *be* the USDC contract,
   the function to be `transfer`, and `(from, to, amount)` to be (payer, recipient, price).
   A call to `treasury.pay` is a call to a different contract and fails the first check.
3. **The auth entry authorises that transfer at its root.** `authorizationCoversTransfer`
   requires the root invocation of an address-credential entry to be the same `transfer`.
   In a `treasury.pay` transaction the root is `pay`, and the transfer happens inside it,
   authorised by the treasury contract itself — not by an entry anyone signs.
4. **On the hash path** (the client submits, the server reads the ledger), the transfer event's
   `from` must equal the DID's `G…` key. A treasury's transfer is `from` the treasury's `C…`.

Every one of these fails for a contract treasury, independently. x402's Stellar `exact` scheme
has the same shape: the client signs the auth entry of a SEP-41 `transfer` with an ed25519
key ([x402-foundation/x402#3158](https://github.com/x402-foundation/x402/issues/3158), open
since 2026-08-14). Support for contract-account payers in `@stellar/mpp` is an open request
([stellar/stellar-mpp-sdk#90](https://github.com/stellar/stellar-mpp-sdk/issues/90), opened
2026-10-05, still open on 2026-10-19).

## What would make it possible

- The treasury would have to be a **custom account**: implement `__check_auth`, so a
  `transfer` *from* the treasury can be authorised by an agent's signature and checked
  against the policy in the same breath. That is a different contract (the policy moves
  from `pay` into authorisation), not a change to v4.
- **And** the facilitators would have to accept a `C…` payer and a non-ed25519 auth entry —
  the two open issues above.

The first is ours to build when the second lands; building it before would produce a
contract no seller can be paid by.

## What ships instead: a bounded float

The agent pays from its own `G…` account, which is exactly what every facilitator accepts,
and the treasury bounds that account from every side:

- the float is funded by an ordinary `treasury.pay()` to the agent's address, so the daily,
  per-payment, monthly and task-budget limits all apply on-chain, plus a **monthly payee cap
  on the agent's own address** (v4) that bounds how much can ever sit outside the contract;
- `call_service` signs a 402 only for the treasury's token, within `maxPrice`, the
  per-payment cap and the float, to a payee the treasury approves and — under a task
  budget — one the budget names;
- `sweep_float` returns what a task did not spend.

Proven end to end on testnet with the official `@x402/stellar` facilitator:
`packages/mcp/scripts/live-spend.ts` (transactions in [`DEPLOYMENT.md`](../DEPLOYMENT.md)).

We will rerun this test when either issue closes.
