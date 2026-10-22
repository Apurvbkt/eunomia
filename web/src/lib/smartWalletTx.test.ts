import { describe, it, expect, vi } from "vitest";
import { Address, nativeToScVal, scValToNative, xdr, type Operation, type Transaction } from "@stellar/stellar-sdk";
import {
  deployFromSmartWallet,
  transferFromSmartWallet,
  type SimulatingServer,
} from "./smartWalletTx";
import { AUTH_MISMATCH } from "./authCheck";
import { classifyHostFunction } from "./hostFunction";

const WALLET = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const DEPLOYED = "CCU3NHMJGYNFNGWH5IZ3RTE7PPETD7QVVWK2H6DIQCFJKGXGLKKRHWO7";
const SOURCE = "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6";
const PASSPHRASE = "Test SDF Network ; September 2015";
const WASM = "475cfbe2ca79d7977c8e4d29438ae70b9d95a12cb2bfcd9fed4e4f7a26d798b2";
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** An address-credentials auth entry, the shape Soroban returns when the deployer is a
 *  contract — and the only shape the relayer accepts. */
function addressEntry(address: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: xdr.Int64.fromString("42"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(WALLET).toScAddress(),
          functionName: "noop",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

/** The entry an honest simulation returns: the wallet authorising exactly the transaction's
 *  own host function, expiration left for the signer to set. */
function honestEntry(tx: Transaction): xdr.SorobanAuthorizationEntry {
  const fn = (tx.operations[0] as Operation.InvokeHostFunction).func;
  const root =
    fn.switch().name === "hostFunctionTypeCreateContractV2"
      ? xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(fn.createContractV2())
      : xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn.invokeContract());
  const entry = addressEntry(WALLET);
  entry.rootInvocation(new xdr.SorobanAuthorizedInvocation({ function: root, subInvocations: [] }));
  return entry;
}

/** What a hostile RPC would slip in next to the real entry: the wallet's USDC to an attacker. */
function drainEntry(): xdr.SorobanAuthorizationEntry {
  const entry = addressEntry(WALLET);
  entry.rootInvocation(
    new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(XLM_SAC).toScAddress(),
          functionName: "transfer",
          args: [new Address(WALLET).toScVal(), new Address(SOURCE).toScVal(), nativeToScVal(1n, { type: "i128" })],
        }),
      ),
      subInvocations: [],
    }),
  );
  return entry;
}

function server(
  over: Partial<Record<string, unknown>> = {},
  extra: (tx: Transaction) => xdr.SorobanAuthorizationEntry[] = () => [],
): SimulatingServer {
  return {
    simulateTransaction: vi.fn().mockImplementation((tx: Transaction) =>
      Promise.resolve({
        result: {
          retval: new Address(DEPLOYED).toScVal(),
          auth: [honestEntry(tx), ...extra(tx)],
        },
        ...over,
      }),
    ),
  } as unknown as SimulatingServer;
}

function deps(over: Partial<Parameters<typeof deployFromSmartWallet>[0]> = {}) {
  return {
    server: server(),
    networkPassphrase: PASSPHRASE,
    simulationSource: SOURCE,
    signAuthEntry: vi.fn().mockImplementation((e) => Promise.resolve(e)),
    relay: vi.fn().mockResolvedValue({ hash: "HASH" }),
    ...over,
  };
}

const ARGS = [new Address(WALLET).toScVal(), nativeToScVal(1n, { type: "i128" })];

describe("deployFromSmartWallet", () => {
  it("names the smart wallet as the deployer, not the transaction source", async () => {
    // The regression this guards: deploying from the transaction source produced
    // SOURCE_ACCOUNT credentials, which OpenZeppelin Channels rejects outright
    // ("Detached address credentials required") because it submits from its own account.
    const d = deps();
    await deployFromSmartWallet(d, WALLET, WASM, ARGS);

    const [func] = (d.relay as ReturnType<typeof vi.fn>).mock.calls[0];
    const fn = xdr.HostFunction.fromXDR(func as string, "base64");
    const preimage = fn.createContractV2().contractIdPreimage();

    expect(preimage.switch().name).toBe("contractIdPreimageFromAddress");
    expect(Address.fromScAddress(preimage.fromAddress().address()).toString()).toBe(WALLET);
    expect(fn.createContractV2().executable().wasmHash().toString("hex")).toBe(WASM);
  });

  it("produces a host function the relay's admission gate reads as an allowed deploy", async () => {
    // The relay decodes the host function itself and admits a deploy only when the wasm hash
    // is on its allowlist. A shape it cannot classify comes back "other" and is rejected, so
    // the two ends of that contract are pinned together here.
    const d = deps();
    await deployFromSmartWallet(d, WALLET, WASM, ARGS);

    const [func] = (d.relay as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(classifyHostFunction(func as string)).toEqual({ kind: "deploy", wasmHash: WASM });
  });

  it("returns the contract id the chain reported, rather than deriving one", async () => {
    await expect(deployFromSmartWallet(deps(), WALLET, WASM, ARGS)).resolves.toBe(DEPLOYED);
  });

  it("relays every auth entry after the passkey has signed it", async () => {
    const signAuthEntry = vi.fn().mockResolvedValue(addressEntry(WALLET));
    const d = deps({ signAuthEntry });

    await deployFromSmartWallet(d, WALLET, WASM, ARGS);

    expect(signAuthEntry).toHaveBeenCalledTimes(1);
    const [, auth] = (d.relay as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(auth).toHaveLength(1);
    expect(() => xdr.SorobanAuthorizationEntry.fromXDR(auth[0], "base64")).not.toThrow();
  });

  it("gives each deploy its own salt, so one wallet can own several treasuries", async () => {
    const d = deps();
    await deployFromSmartWallet(d, WALLET, WASM, ARGS);
    await deployFromSmartWallet(d, WALLET, WASM, ARGS);

    const salts = (d.relay as ReturnType<typeof vi.fn>).mock.calls.map(([func]) =>
      xdr.HostFunction.fromXDR(func as string, "base64")
        .createContractV2()
        .contractIdPreimage()
        .fromAddress()
        .salt()
        .toString("hex"),
    );
    expect(salts[0]).not.toBe(salts[1]);
  });

  it("moves XLM with the wallet as the `from` argument, so its signature authorises it", async () => {
    // The wallet cannot source a transaction, so the transfer has to be authorised by
    // signature instead. `from` being the wallet is what stops whoever pays the fee from
    // redirecting the funds.
    const d = deps();
    const TREASURY = "CCU3NHMJGYNFNGWH5IZ3RTE7PPETD7QVVWK2H6DIQCFJKGXGLKKRHWO7";

    await transferFromSmartWallet(d, WALLET, XLM_SAC, TREASURY, 5_000_000n);

    const [func] = (d.relay as ReturnType<typeof vi.fn>).mock.calls[0];
    const fn = xdr.HostFunction.fromXDR(func as string, "base64");
    const call = fn.invokeContract();

    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(XLM_SAC);
    expect(call.functionName().toString()).toBe("transfer");
    const [from, to, amount] = call.args();
    expect(Address.fromScVal(from).toString()).toBe(WALLET);
    expect(Address.fromScVal(to).toString()).toBe(TREASURY);
    expect(scValToNative(amount)).toBe(5_000_000n);
  });

  it("signs nothing when the RPC slips an extra entry in next to the real one", async () => {
    // M1: the passkey prompt cannot show what an entry authorises, so a hostile RPC could
    // have one touch sign a transfer out of the wallet along with the deploy.
    const d = deps({ server: server({}, () => [drainEntry()]) });

    await expect(deployFromSmartWallet(d, WALLET, WASM, ARGS)).rejects.toThrow(AUTH_MISMATCH);
    expect(d.signAuthEntry).not.toHaveBeenCalled();
    expect(d.relay).not.toHaveBeenCalled();
  });

  it("signs nothing when the RPC sets the expiration itself", async () => {
    // A far-off expiration would leave a signed entry replayable long after this session.
    const late = (tx: Transaction) => {
      const e = honestEntry(tx);
      e.credentials().address().signatureExpirationLedger(99_999_999);
      return e;
    };
    const d = deps({
      server: {
        simulateTransaction: vi.fn().mockImplementation((tx: Transaction) =>
          Promise.resolve({ result: { retval: new Address(DEPLOYED).toScVal(), auth: [late(tx)] } }),
        ),
      } as unknown as SimulatingServer,
    });

    await expect(transferFromSmartWallet(d, WALLET, XLM_SAC, DEPLOYED, 1n)).rejects.toThrow(AUTH_MISMATCH);
    expect(d.signAuthEntry).not.toHaveBeenCalled();
  });

  it("surfaces a simulation failure as something the user can act on", async () => {
    const d = deps({
      server: {
        simulateTransaction: vi.fn().mockResolvedValue({ error: "HostError: budget exceeded" }),
      } as unknown as SimulatingServer,
    });

    await expect(deployFromSmartWallet(d, WALLET, WASM, ARGS)).rejects.toThrow(/couldn't be prepared/i);
  });

  it("refuses to report success when the chain named no contract", async () => {
    const d = deps({
      server: {
        simulateTransaction: vi.fn().mockResolvedValue({ result: { auth: [] } }),
      } as unknown as SimulatingServer,
    });

    await expect(deployFromSmartWallet(d, WALLET, WASM, ARGS)).rejects.toThrow(/couldn't be prepared/i);
  });
});
