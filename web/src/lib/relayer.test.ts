import { describe, it, expect, vi } from "vitest";
import { ledgerConfirm, relayHostFunction, relayTx, RelayPendingError } from "./relayer";

const b64 = (s: string) => ({ toXDR: () => s });

/** An assembled transaction as the contract client hands it over, after the passkey signed it. */
const assembled = (auth: string[] = ["AUTH1"]) => ({
  signAndSend: vi.fn(),
  built: { operations: [{ func: b64("FUNC"), auth: auth.map((a) => b64(a)) }] },
});

const respond = (ok: boolean, status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });

describe("relayTx", () => {
  it("posts the decoded func and auth entries to our own relay endpoint", async () => {
    const fetchImpl = respond(true, 200, { hash: "abc123", status: "SUCCESS" });

    await expect(relayTx(fetchImpl, assembled())).resolves.toEqual({ hash: "abc123" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/relay");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ func: "FUNC", auth: ["AUTH1"] });
  });

  it("sends an empty auth list rather than failing when there are no entries", async () => {
    const fetchImpl = respond(true, 200, { hash: "h", status: "SUCCESS" });
    await relayTx(fetchImpl, assembled([]));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).auth).toEqual([]);
  });

  it("never leaks the raw server error", async () => {
    const fetchImpl = respond(false, 502, { error: "Relay failed." });
    await expect(relayTx(fetchImpl, assembled())).rejects.not.toThrow(/Relay failed\./);
  });

  it("fails clearly when the transaction was never built", async () => {
    const fetchImpl = respond(true, 200, { hash: "h", status: "SUCCESS" });
    await expect(relayTx(fetchImpl, { signAndSend: vi.fn() })).rejects.toThrow(/could not be prepared/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not tell the user to retry something the relay will always refuse", async () => {
    // A 403 means this build is not cleared to sponsor the call. It cost a live user an
    // evening of retrying "Couldn't submit that transaction. Try again." while every
    // attempt was refused identically, so the permanent case must not read as transient.
    await expect(relayTx(respond(false, 403, { error: "Not allowed." }), assembled())).rejects.toThrow(
      /on our side, not you/i,
    );
    await expect(
      relayTx(respond(false, 403, { error: "Not allowed." }), assembled()),
    ).rejects.not.toThrow(/try again/i);
  });

  it("says so when fee sponsorship is switched off entirely", async () => {
    await expect(relayTx(respond(false, 503, { error: "not configured" }), assembled())).rejects.toThrow(
      /configured/i,
    );
  });

  it("still asks for a retry on a genuinely transient failure", async () => {
    const fetchImpl = respond(false, 502, { error: "Relay failed." });
    await expect(relayTx(fetchImpl, assembled())).rejects.toThrow(/try again/i);
  });
});

// The 08-07 failure: the relay answered 200 for a transaction the ledger never confirmed, the
// caller ignored the status, and the app announced a treasury that did not exist.
describe("a 200 from the relay is not a success until the ledger says so", () => {
  it("does not resolve on a pending answer when nothing confirms it", async () => {
    const fetchImpl = respond(true, 200, { hash: "h1", status: "PENDING" });
    await expect(relayHostFunction(fetchImpl, "F", [])).rejects.toBeInstanceOf(RelayPendingError);
  });

  it("does not resolve when the relay omits the status", async () => {
    const fetchImpl = respond(true, 200, { hash: "h1" });
    await expect(relayHostFunction(fetchImpl, "F", [])).rejects.toBeInstanceOf(RelayPendingError);
  });

  it("asks the ledger and resolves once it reports SUCCESS", async () => {
    const fetchImpl = respond(true, 200, { hash: "h1", status: "NOT_FOUND" });
    const confirm = vi.fn().mockResolvedValue("SUCCESS");
    await expect(relayHostFunction(fetchImpl, "F", [], confirm)).resolves.toEqual({ hash: "h1" });
    expect(confirm).toHaveBeenCalledWith("h1");
  });

  it("does not ask the ledger again when the relay already saw SUCCESS", async () => {
    const confirm = vi.fn();
    await relayHostFunction(respond(true, 200, { hash: "h1", status: "SUCCESS" }), "F", [], confirm);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("reports a failed transaction as failed, not as pending", async () => {
    const fetchImpl = respond(true, 200, { hash: "h1", status: "PENDING" });
    const err = await relayHostFunction(fetchImpl, "F", [], async () => "FAILED").catch((e) => e);
    expect(err).not.toBeInstanceOf(RelayPendingError);
    expect(String(err)).toMatch(/failed/i);
  });

  it("carries the hash when the ledger is still silent, so the UI can link it", async () => {
    const fetchImpl = respond(true, 200, { hash: "h1", status: "PENDING" });
    const err = await relayHostFunction(fetchImpl, "F", [], async () => "NOT_FOUND").catch((e) => e);
    expect(err).toBeInstanceOf(RelayPendingError);
    expect((err as RelayPendingError).hash).toBe("h1");
  });

  it("treats a 200 without a hash as a failure", async () => {
    await expect(relayHostFunction(respond(true, 200, { status: "SUCCESS" }), "F", [])).rejects.toThrow(
      /try again/i,
    );
  });
});

describe("ledgerConfirm", () => {
  const noWait = () => Promise.resolve();

  it("polls past NOT_FOUND and PENDING to the final status", async () => {
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "SUCCESS" });
    await expect(ledgerConfirm({ getTransaction }, 5, noWait)("h")).resolves.toBe("SUCCESS");
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });

  it("gives up after its attempts and reports what it last saw", async () => {
    const getTransaction = vi.fn().mockResolvedValue({ status: "NOT_FOUND" });
    await expect(ledgerConfirm({ getTransaction }, 3, noWait)("h")).resolves.toBe("NOT_FOUND");
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });
});
