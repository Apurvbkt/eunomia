// What the passkey signs has to be what the app asked for.
//
// Auth entries come back from RPC simulation, and the passkey prompt cannot show what an
// entry authorises. A hostile or compromised RPC could return, next to the real entry, one
// whose root call is `usdc.transfer(wallet → attacker)` with a far-off expiration, and the
// user would sign both with one touch. So before anything is signed, every entry is held to
// the host function the app built itself:
//   - address credentials for this wallet and nothing else: no source-account credentials,
//     no delegates, no other address
//   - a root invocation identical, byte for byte, to the transaction's own host function
//   - no expiration chosen by the RPC: simulation leaves it at 0, and the signer sets it from
//     the latest ledger
// Sub-invocations are left as simulated. They authorise only calls made while the pinned root
// call runs, and that code is the factory, treasury, registry or token the app chose; a node
// for a call it never makes is never matched.
import { Address, type Transaction, xdr } from "@stellar/stellar-sdk";

export const AUTH_MISMATCH =
  "The network asked for a signature on something other than this action, so nothing was signed.";

function rootMatches(fn: xdr.HostFunction, root: xdr.SorobanAuthorizedFunction): boolean {
  switch (fn.switch().name) {
    case "hostFunctionTypeInvokeContract":
      return (
        root.switch().name === "sorobanAuthorizedFunctionTypeContractFn" &&
        root.contractFn().toXDR("base64") === fn.invokeContract().toXDR("base64")
      );
    case "hostFunctionTypeCreateContractV2":
      return (
        root.switch().name === "sorobanAuthorizedFunctionTypeCreateContractV2HostFn" &&
        root.createContractV2HostFn().toXDR("base64") === fn.createContractV2().toXDR("base64")
      );
    default:
      return false;
  }
}

/** Why these entries may not be signed by `wallet` for `fn`, or null when they may. */
export function authProblem(
  fn: xdr.HostFunction,
  entries: xdr.SorobanAuthorizationEntry[],
  wallet: string,
): string | null {
  for (const [i, entry] of entries.entries()) {
    const creds = entry.credentials();
    const kind = creds.switch().name;
    if (kind !== "sorobanCredentialsAddress" && kind !== "sorobanCredentialsAddressV2") {
      return `entry ${i}: ${kind} credentials`;
    }
    const addr = kind === "sorobanCredentialsAddress" ? creds.address() : creds.addressV2();
    const who = Address.fromScAddress(addr.address()).toString();
    if (who !== wallet) return `entry ${i}: authorises as ${who}, not this wallet`;
    if (addr.signatureExpirationLedger() !== 0) {
      return `entry ${i}: arrived with expiration ledger ${addr.signatureExpirationLedger()}`;
    }
    if (!rootMatches(fn, entry.rootInvocation().function())) {
      return `entry ${i}: root invocation is not the call being made`;
    }
  }
  return null;
}

/** Throw a user-facing refusal when the entries are not exactly this action's. */
export function assertAuthMatches(
  fn: xdr.HostFunction,
  entries: xdr.SorobanAuthorizationEntry[],
  wallet: string,
): void {
  const problem = authProblem(fn, entries, wallet);
  if (problem) {
    console.error("[auth check] refused to sign:", problem);
    throw new Error(AUTH_MISMATCH);
  }
}

/** The same check for a contract client's assembled transaction: its host function is the
 *  one the client built, its auth is what simulation returned. */
export function assertAssembledAuth(tx: { built?: unknown }, wallet: string): void {
  const op = (tx.built as Transaction | undefined)?.operations?.[0];
  if (!op || op.type !== "invokeHostFunction") {
    console.error("[auth check] refused to sign: no assembled host function");
    throw new Error(AUTH_MISMATCH);
  }
  assertAuthMatches(op.func, op.auth ?? [], wallet);
}
