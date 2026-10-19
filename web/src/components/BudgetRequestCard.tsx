// An agent asked for a task budget (eunomia-mcp `request_budget`) and the owner opened the
// link. Everything the signature will grant is on this card before the button: the amount,
// how long, which payees, what for — and whose key is asking. Approving signs exactly that
// as `set_task_budget`; nothing here is approved off-chain.
import { useEffect, useState } from "react";
import { EXPLORER, NETWORK_PASSPHRASE, RPC_URL, fmtXlm, shortAddr } from "../config";
import { decodeBudgetRequest, type BudgetRequest } from "../lib/budgetRequestCodec";
import { Client } from "../lib/treasuryClient";
import { useTreasury } from "../state/useTreasury";

const APP_NETWORK = NETWORK_PASSPHRASE.startsWith("Public") ? "pubnet" : "testnet";

/** The request carried in this page's URL, if any. */
function budgetRequestFromUrl(search = window.location.search): ReturnType<typeof decodeBudgetRequest> | null {
  const params = new URLSearchParams(search);
  return params.has("sig") ? decodeBudgetRequest(params) : null;
}

/** Drop the request from the address bar, keeping the page the owner is on. */
function clearRequest() {
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
}

export default function BudgetRequestCard({ onDone }: { onDone: () => void }) {
  const t = useTreasury();
  const [parsed] = useState(() => budgetRequestFromUrl());
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");

  const r: BudgetRequest | null = parsed?.request ?? null;
  const usable = !!parsed?.verified && !!r && r.network === APP_NETWORK && r.treasury === t.treasuryId;

  // Which of the named payees the treasury already pays — a budget does not approve them.
  useEffect(() => {
    if (!usable || !r) return;
    let cancelled = false;
    const client = new Client({ contractId: r.treasury, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
    void Promise.all(
      r.payees.map(async (p) => [p, await client.is_payee({ payee: p }).then((x) => x.result).catch(() => false)] as const),
    ).then((pairs) => {
      if (!cancelled) setApproved(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [usable, r, t.refreshKey]);

  if (!parsed) return null;
  const dismiss = () => {
    clearRequest();
    onDone();
  };

  const problem = !parsed.verified
    ? `This link does not verify: ${parsed.problems.join("; ")}. Ask the agent for a new one.`
    : r && r.network !== APP_NETWORK
      ? `This request is for ${r.network === "pubnet" ? "mainnet" : "testnet"}; this app runs on ${APP_NETWORK === "pubnet" ? "mainnet" : "testnet"}.`
      : r && r.treasury !== t.treasuryId
        ? `This request is for treasury ${shortAddr(r.treasury)}. Open that treasury from the switcher, then this card returns.`
        : "";

  const session = t.lifecycle?.session ?? null;
  const knownAgent = !!r && (session?.agent === r.agent || t.state?.agent === r.agent);
  const replaces = !!r && t.sessionActive && session && session.agent !== r.agent;

  const approve = async () => {
    if (!r) return;
    setErr("");
    const res = await t.approveBudget(r);
    if (res.ok) dismiss();
    else if (res.validation) setErr(res.msg);
  };

  return (
    <section className="panel panel--pad" aria-label="Budget request from your agent">
      <div className="eyebrow">Budget request{r ? ` · ${shortAddr(r.agent)}` : ""}</div>
      {problem || !r ? (
        <>
          <div className="panel__note">{problem || "This link carries no readable request."}</div>
          <div>
            <button className="linkbtn" onClick={dismiss} type="button">dismiss</button>
          </div>
        </>
      ) : (
        <>
          <div className="panel__title">“{r.task}”</div>
          <div className="panel__kv"><span>Up to</span><span className="num">{fmtXlm(r.limit)} {t.tokenCode}</span></div>
          <div className="panel__kv"><span>For</span><span className="num">{r.hours} {r.hours === 1 ? "hour" : "hours"}</span></div>
          <div className="panel__kv">
            <span>Agent key</span>
            <a className="num" href={`${EXPLORER}/account/${r.agent}`} target="_blank" rel="noreferrer">
              {shortAddr(r.agent)} ↗
            </a>
          </div>
          <div className="panel__note">
            {knownAgent
              ? "This is the agent already working for this treasury."
              : "A key this treasury has not worked with. Approve only if it is the one your agent printed with eunomia-mcp init."}
          </div>
          <div className="eyebrow" style={{ marginTop: 6 }}>May pay only</div>
          {r.payees.map((p) => (
            <div className="panel__kv" key={p}>
              <span className="num">{shortAddr(p)}</span>
              {approved[p] === false ? (
                <button className="linkbtn" onClick={() => void t.whitelist(p)} disabled={!!t.busy} type="button">
                  not approved yet — approve
                </button>
              ) : (
                <span>{approved[p] ? "approved payee" : "checking…"}</span>
              )}
            </div>
          ))}
          <div className="panel__note">
            Your daily, per-payment and monthly limits still apply inside this budget.
            {replaces ? " Approving replaces the Leash that is running now." : ""}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="btn btn--lg" onClick={() => void approve()} disabled={!!t.busy} type="button">
              {t.busy === "session" ? "Approving…" : "Approve budget"}
            </button>
            <button className="linkbtn" onClick={dismiss} type="button">not now</button>
          </div>
          {err && <div className="err">{err}</div>}
        </>
      )}
    </section>
  );
}
