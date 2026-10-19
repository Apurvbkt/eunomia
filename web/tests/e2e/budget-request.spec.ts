// An agent asks for a task budget; the owner opens the link and approves it with one
// signature. Driven through the UI against testnet: the link is built with the same codec
// eunomia-mcp's request_budget uses, the card verifies it, and the chain is asked afterwards
// whether the Leash is the budget that was asked for — and only that.
import { test as base } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";
import { getTestSigner, injectTestSigner, EunomiaPage, expect } from "./eunomiaTest";
import { encodeBudgetRequest } from "../../src/lib/budgetRequestCodec";
import { fundWithFriendbot } from "../../src/lib/funding";
import { Client as TreasuryClient } from "../../src/lib/treasuryClient";
import { NETWORK_PASSPHRASE, RPC_URL } from "../../src/config";

const test = base.extend<{ eunomia: EunomiaPage; signer: ReturnType<typeof getTestSigner> }>({
  signer: async ({}, use) => {
    await use(getTestSigner());
  },
  context: async ({ context, signer }, use) => {
    await injectTestSigner(context, signer);
    await use(context);
  },
  eunomia: async ({ page }, use) => {
    await use(new EunomiaPage(page));
  },
});

test("the owner approves an agent's budget request with one signature", async ({ eunomia }) => {
  test.info().annotations.push({ type: "network", description: "Stellar testnet" });
  const page = eunomia.page;
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await eunomia.gotoWorkspace();
  await eunomia.connectWallet();
  await eunomia.friendbotIfNeeded();
  await page.getByRole("button", { name: /^XLM/ }).click();
  await page.getByLabel(/daily limit.*xlm/i).fill("50");
  await page.getByLabel(/per-payment limit.*xlm/i).fill("10");
  await page.getByRole("button", { name: /create treasury/i }).click();
  await eunomia.waitForToast("success", 180_000);
  await eunomia.waitForNoBusyButtons();
  const treasury = (await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("prism_treasuries:"));
    return key ? (JSON.parse(localStorage.getItem(key)!) as { ids: string[] }).ids.at(-1) : null;
  })) as string;
  expect(treasury).toMatch(/^C[A-Z2-7]{55}$/);

  const vendor = Keypair.random();
  await fundWithFriendbot(vendor.publicKey());
  await eunomia.whitelistPayee(vendor.publicKey());

  // What request_budget hands the owner.
  const agent = Keypair.random();
  const params = encodeBudgetRequest(
    {
      network: "testnet",
      treasury,
      agent: agent.publicKey(),
      limit: 30_000_000n,
      hours: 6,
      payees: [vendor.publicKey()],
      task: "Compare three suppliers' prices",
    },
    agent,
  );

  // An edited link is caught before anything can be signed.
  const tampered = new URLSearchParams(params);
  tampered.set("l", "300000000");
  await page.goto(`/?${tampered}#agent`);
  const card = page.locator("section", { hasText: /budget request/i });
  await expect(card).toContainText(/does not verify/i);
  await expect(card.getByRole("button", { name: /approve budget/i })).toHaveCount(0);

  await page.goto(`/?${params}#agent`);
  await expect(card).toContainText("Compare three suppliers' prices");
  await expect(card).toContainText(/3 XLM/);
  await expect(card).toContainText(/6 hours/);
  await expect(card).toContainText(/approved payee/i);
  await expect(card).toContainText(/has not worked with/i);
  await page.screenshot({ path: "test-results/budget-request-1-card.png", fullPage: true });
  await card.getByRole("button", { name: /approve budget/i }).click();
  await expect(page.locator('[data-toast-kind="success"]', { hasText: /budget approved/i })).toBeVisible({ timeout: 180_000 });

  // The request is consumed: the link is gone from the address bar and the card with it.
  await expect(card).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");

  // And the chain holds exactly the budget asked for.
  const t = new TreasuryClient({ contractId: treasury, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
  const session = (await t.get_session()).result;
  expect(session?.agent).toBe(agent.publicKey());
  expect(session?.limit).toBe(30_000_000n);
  expect((await t.session_payees()).result).toEqual([vendor.publicKey()]);

  // The v4 limits from Settings: a monthly budget and a cap on the vendor.
  await page.goto("/#settings");
  await page.getByLabel(/monthly limit in xlm/i).fill("40");
  await page.getByRole("button", { name: /set monthly limit/i }).click();
  await expect(page.locator('[data-toast-kind="success"]', { hasText: /monthly limit set/i })).toBeVisible({ timeout: 180_000 });
  await eunomia.waitForNoBusyButtons();
  await page.getByLabel(/payee to cap/i).fill(vendor.publicKey());
  await page.getByLabel(/payee monthly cap in xlm/i).fill("2");
  await page.getByRole("button", { name: /^set cap$/i }).click();
  await expect(page.locator('[data-toast-kind="success"]', { hasText: /cap set/i })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/40 XLM/).first()).toBeVisible();
  expect((await t.monthly_limit()).result).toBe(400_000_000n);
  expect((await t.payee_cap({ payee: vendor.publicKey() })).result).toBe(20_000_000n);
  await page.screenshot({ path: "test-results/budget-request-2-settings.png", fullPage: true });
  expect(pageErrors).toEqual([]);
});
