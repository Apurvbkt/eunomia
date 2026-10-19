import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { decodeBudgetRequest, encodeBudgetRequest } from "./budgetRequestCodec";

// The link eunomia-mcp writes and the card this app shows are two copies of one codec
// (check:codec keeps them byte-identical); this pins that the app reads what the agent signs.
describe("budget request link", () => {
  const agent = Keypair.random();
  const request = {
    network: "testnet" as const,
    treasury: "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK",
    agent: agent.publicKey(),
    limit: 25_000_000n,
    hours: 6,
    payees: ["GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT"],
    task: "Find three flights under 400 euros",
    expires: 1_900_000_000,
  };

  it("reads back a link the agent signed, from the page's query string", () => {
    const url = new URL(`https://eunomia.finance/?${encodeBudgetRequest(request, agent)}#agent`);
    const back = decodeBudgetRequest(url.searchParams);
    expect(back.verified).toBe(true);
    expect(back.request).toEqual(request);
  });

  it("refuses an expired link even though its signature holds", () => {
    const params = encodeBudgetRequest(request, agent);
    expect(decodeBudgetRequest(params, 1_899_999_999).verified).toBe(true);
    const late = decodeBudgetRequest(params, 1_900_000_000);
    expect(late.verified).toBe(false);
    expect(late.problems.join()).toMatch(/expired/);
  });

  it("refuses a link whose task text was changed on the way", () => {
    const params = encodeBudgetRequest(request, agent);
    params.set("task", "Anything you like");
    expect(decodeBudgetRequest(params).verified).toBe(false);
  });
});
