import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * A time-bound, spend-capped agent credential to start the treasury with (the Leash).
 */
export interface Leash {
  agent: string;
  limit: i128;
  valid_until: u64;
}


/**
 * Everything a treasury needs to be useful on the first ledger it exists in.
 */
export interface Setup {
  daily_limit: i128;
  /**
 * Amount of `token` deposited from the owner into the treasury (0 = unfunded). Refused
 * as a whole if it exceeds the factory's deposit cap.
 */
fund: i128;
  /**
 * Start a Leash for an agent key right away: empty = none, one entry = that agent.
 * (A `Vec` rather than an `Option`: the SDK's spec cannot carry an optional struct.)
 */
leash: Array<Leash>;
  /**
 * Most the agent may move per UTC calendar month (0 = no monthly limit).
 */
monthly_limit: i128;
  /**
 * Owner of the funds: becomes the treasury's admin AND root agent (as the app did).
 */
owner: string;
  /**
 * Monthly caps on individual payees (may be empty). A cap does not approve its payee.
 */
payee_caps: Array<PayeeCap>;
  /**
 * Payees approved from the start (may be empty).
 */
payees: Array<string>;
  per_task_limit: i128;
  /**
 * Record the treasury under the owner in the registry (cross-device recovery).
 */
register: boolean;
  /**
 * Caller-chosen; the treasury address is derived from the factory and this salt.
 */
salt: Buffer;
  /**
 * SEP-41 / SAC token the treasury holds and spends.
 */
token: string;
}


/**
 * A monthly ceiling on what one payee may receive (v4).
 */
export interface PayeeCap {
  cap: i128;
  payee: string;
}

export interface Client {
  /**
   * Construct and simulate a create transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy a treasury and set it up — one owner signature for the whole thing.
   * 
   * Order matters for atomicity only in the sense that any refusal (an incoherent
   * policy in the constructor, an invalid Leash, an unfunded owner) aborts the entire
   * transaction: no half-configured treasury can exist.
   */
  create: ({s}: {s: Setup}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a deposit_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The deposit cap every treasury from this factory is born with (0 = uncapped).
   */
  deposit_cap: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a treasury_wasm transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  treasury_wasm: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {treasury_wasm, registry, deposit_cap}: {treasury_wasm: Buffer, registry: string, deposit_cap: i128},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({treasury_wasm, registry, deposit_cap}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAFNBIHRpbWUtYm91bmQsIHNwZW5kLWNhcHBlZCBhZ2VudCBjcmVkZW50aWFsIHRvIHN0YXJ0IHRoZSB0cmVhc3VyeSB3aXRoICh0aGUgTGVhc2gpLgAAAAAAAAAABUxlYXNoAAAAAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAY=",
        "AAAAAQAAAEpFdmVyeXRoaW5nIGEgdHJlYXN1cnkgbmVlZHMgdG8gYmUgdXNlZnVsIG9uIHRoZSBmaXJzdCBsZWRnZXIgaXQgZXhpc3RzIGluLgAAAAAAAAAAAAVTZXR1cAAAAAAAAAsAAAAAAAAAC2RhaWx5X2xpbWl0AAAAAAsAAACIQW1vdW50IG9mIGB0b2tlbmAgZGVwb3NpdGVkIGZyb20gdGhlIG93bmVyIGludG8gdGhlIHRyZWFzdXJ5ICgwID0gdW5mdW5kZWQpLiBSZWZ1c2VkCmFzIGEgd2hvbGUgaWYgaXQgZXhjZWVkcyB0aGUgZmFjdG9yeSdzIGRlcG9zaXQgY2FwLgAAAARmdW5kAAAACwAAAKNTdGFydCBhIExlYXNoIGZvciBhbiBhZ2VudCBrZXkgcmlnaHQgYXdheTogZW1wdHkgPSBub25lLCBvbmUgZW50cnkgPSB0aGF0IGFnZW50LgooQSBgVmVjYCByYXRoZXIgdGhhbiBhbiBgT3B0aW9uYDogdGhlIFNESydzIHNwZWMgY2Fubm90IGNhcnJ5IGFuIG9wdGlvbmFsIHN0cnVjdC4pAAAAAAVsZWFzaAAAAAAAA+oAAAfQAAAABUxlYXNoAAAAAAAARk1vc3QgdGhlIGFnZW50IG1heSBtb3ZlIHBlciBVVEMgY2FsZW5kYXIgbW9udGggKDAgPSBubyBtb250aGx5IGxpbWl0KS4AAAAAAA1tb250aGx5X2xpbWl0AAAAAAAACwAAAFFPd25lciBvZiB0aGUgZnVuZHM6IGJlY29tZXMgdGhlIHRyZWFzdXJ5J3MgYWRtaW4gQU5EIHJvb3QgYWdlbnQgKGFzIHRoZSBhcHAgZGlkKS4AAAAAAAAFb3duZXIAAAAAAAATAAAAU01vbnRobHkgY2FwcyBvbiBpbmRpdmlkdWFsIHBheWVlcyAobWF5IGJlIGVtcHR5KS4gQSBjYXAgZG9lcyBub3QgYXBwcm92ZSBpdHMgcGF5ZWUuAAAAAApwYXllZV9jYXBzAAAAAAPqAAAH0AAAAAhQYXllZUNhcAAAAC5QYXllZXMgYXBwcm92ZWQgZnJvbSB0aGUgc3RhcnQgKG1heSBiZSBlbXB0eSkuAAAAAAAGcGF5ZWVzAAAAAAPqAAAAEwAAAAAAAAAOcGVyX3Rhc2tfbGltaXQAAAAAAAsAAABMUmVjb3JkIHRoZSB0cmVhc3VyeSB1bmRlciB0aGUgb3duZXIgaW4gdGhlIHJlZ2lzdHJ5IChjcm9zcy1kZXZpY2UgcmVjb3ZlcnkpLgAAAAhyZWdpc3RlcgAAAAEAAABOQ2FsbGVyLWNob3NlbjsgdGhlIHRyZWFzdXJ5IGFkZHJlc3MgaXMgZGVyaXZlZCBmcm9tIHRoZSBmYWN0b3J5IGFuZCB0aGlzIHNhbHQuAAAAAAAEc2FsdAAAA+4AAAAgAAAAMVNFUC00MSAvIFNBQyB0b2tlbiB0aGUgdHJlYXN1cnkgaG9sZHMgYW5kIHNwZW5kcy4AAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAQAAADVBIG1vbnRobHkgY2VpbGluZyBvbiB3aGF0IG9uZSBwYXllZSBtYXkgcmVjZWl2ZSAodjQpLgAAAAAAAAAAAAAIUGF5ZWVDYXAAAAACAAAAAAAAAANjYXAAAAAACwAAAAAAAAAFcGF5ZWUAAAAAAAAT",
        "AAAAAAAAASFEZXBsb3kgYSB0cmVhc3VyeSBhbmQgc2V0IGl0IHVwIOKAlCBvbmUgb3duZXIgc2lnbmF0dXJlIGZvciB0aGUgd2hvbGUgdGhpbmcuCgpPcmRlciBtYXR0ZXJzIGZvciBhdG9taWNpdHkgb25seSBpbiB0aGUgc2Vuc2UgdGhhdCBhbnkgcmVmdXNhbCAoYW4gaW5jb2hlcmVudApwb2xpY3kgaW4gdGhlIGNvbnN0cnVjdG9yLCBhbiBpbnZhbGlkIExlYXNoLCBhbiB1bmZ1bmRlZCBvd25lcikgYWJvcnRzIHRoZSBlbnRpcmUKdHJhbnNhY3Rpb246IG5vIGhhbGYtY29uZmlndXJlZCB0cmVhc3VyeSBjYW4gZXhpc3QuAAAAAAAABmNyZWF0ZQAAAAAAAQAAAAAAAAABcwAAAAAAB9AAAAAFU2V0dXAAAAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAIcmVnaXN0cnkAAAAAAAAAAQAAABM=",
        "AAAAAAAAAE1UaGUgZGVwb3NpdCBjYXAgZXZlcnkgdHJlYXN1cnkgZnJvbSB0aGlzIGZhY3RvcnkgaXMgYm9ybiB3aXRoICgwID0gdW5jYXBwZWQpLgAAAAAAAAtkZXBvc2l0X2NhcAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAPpQaW5zIHRoZSB0cmVhc3VyeSBjb2RlLCB0aGUgcmVnaXN0cnkgYW5kIHRoZSBkZXBvc2l0IGNhcC4gSW1tdXRhYmxlIGFmdGVyIGRlcGxveSAobm8Kc2V0dGVycyk6IGEgZmFjdG9yeSB0aGF0IGNvdWxkIGJlIHJlLXBvaW50ZWQgd291bGQgYmUgYSB3YXkgdG8gaGFuZCB1c2VycyBkaWZmZXJlbnQKY29kZSwgYW5kIG9uZSB3aG9zZSBjYXAgY291bGQgYmUgcmFpc2VkIHdvdWxkIG1ha2UgdGhlIGJldGEgYm91bmQgYSBwcm9taXNlIG9ubHkuAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAMAAAAAAAAADXRyZWFzdXJ5X3dhc20AAAAAAAPuAAAAIAAAAAAAAAAIcmVnaXN0cnkAAAATAAAAAAAAAAtkZXBvc2l0X2NhcAAAAAALAAAAAA==",
        "AAAAAAAAAAAAAAANdHJlYXN1cnlfd2FzbQAAAAAAAAAAAAABAAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    create: this.txFromJSON<string>,
        registry: this.txFromJSON<string>,
        deposit_cap: this.txFromJSON<i128>,
        treasury_wasm: this.txFromJSON<Buffer>
  }
}