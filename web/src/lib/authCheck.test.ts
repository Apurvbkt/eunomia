import { describe, it, expect } from "vitest";
import { Address, Contract, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { authProblem } from "./authCheck";

const WALLET = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const OTHER = "CCU3NHMJGYNFNGWH5IZ3RTE7PPETD7QVVWK2H6DIQCFJKGXGLKKRHWO7";
const FACTORY = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const create = (amount: bigint) =>
  new Contract(FACTORY)
    .call("create", new Address(WALLET).toScVal(), nativeToScVal(amount, { type: "i128" }))
    .body()
    .invokeHostFunctionOp()
    .hostFunction();

function creds(address = WALLET, expiration = 0): xdr.SorobanAddressCredentials {
  return new xdr.SorobanAddressCredentials({
    address: new Address(address).toScAddress(),
    nonce: xdr.Int64.fromString("1"),
    signatureExpirationLedger: expiration,
    signature: xdr.ScVal.scvVoid(),
  });
}

function entry(fn: xdr.HostFunction, credentials: xdr.SorobanCredentials): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn.invokeContract()),
      subInvocations: [],
    }),
  });
}

describe("authProblem", () => {
  const fn = create(10n);

  it("passes the wallet authorising exactly the call, in either address-credential shape", () => {
    expect(authProblem(fn, [entry(fn, xdr.SorobanCredentials.sorobanCredentialsAddress(creds()))], WALLET)).toBeNull();
    expect(authProblem(fn, [entry(fn, xdr.SorobanCredentials.sorobanCredentialsAddressV2(creds()))], WALLET)).toBeNull();
  });

  it("refuses the same function with different arguments", () => {
    // Root matching is byte for byte: a setup with another amount is another action.
    const e = entry(create(10_000n), xdr.SorobanCredentials.sorobanCredentialsAddress(creds()));
    expect(authProblem(fn, [e], WALLET)).toMatch(/root invocation/);
  });

  it("refuses an entry for any address but this wallet", () => {
    const e = entry(fn, xdr.SorobanCredentials.sorobanCredentialsAddress(creds(OTHER)));
    expect(authProblem(fn, [e], WALLET)).toMatch(/not this wallet/);
  });

  it("refuses source-account and delegated credentials", () => {
    expect(authProblem(fn, [entry(fn, xdr.SorobanCredentials.sorobanCredentialsSourceAccount())], WALLET)).toMatch(
      /SourceAccount/,
    );
    const delegated = xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
      new xdr.SorobanAddressCredentialsWithDelegates({ addressCredentials: creds(), delegates: [] }),
    );
    expect(authProblem(fn, [entry(fn, delegated)], WALLET)).toMatch(/WithDelegates/);
  });

  it("refuses an expiration the RPC chose", () => {
    const e = entry(fn, xdr.SorobanCredentials.sorobanCredentialsAddress(creds(WALLET, 5_000_000)));
    expect(authProblem(fn, [e], WALLET)).toMatch(/expiration/);
  });

  it("refuses a contract call presented for a deploy", () => {
    const deploy = xdr.HostFunction.hostFunctionTypeCreateContractV2(
      new xdr.CreateContractArgsV2({
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new xdr.ContractIdPreimageFromAddress({ address: new Address(WALLET).toScAddress(), salt: Buffer.alloc(32) }),
        ),
        executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
        constructorArgs: [],
      }),
    );
    const e = entry(fn, xdr.SorobanCredentials.sorobanCredentialsAddress(creds()));
    expect(authProblem(deploy, [e], WALLET)).toMatch(/root invocation/);
  });
});
