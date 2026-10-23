# eunomia-mcp Changelog

Notable changes to the `eunomia-mcp` package, separated from the main Eunomia application changelog.

## [0.3.0] — 2026-10-19

- **Added** — `find_services` to discover paid APIs from the ROZO MPP Router catalog.
- **Added** — `fund_float` and `sweep_float` to fund the agent's account from the treasury and return unused funds.
- **Added** — `call_service` to pay HTTP 402 payment requirements through the official x402 client, subject to token, price, payment-cap, approved-payee and task-budget restrictions.
- **Added** — `float_status` to inspect the agent's balance and recorded service purchases.
- **Added** — `request_budget` to request a task-specific budget that the treasury owner can approve with one signature.
- **Added** — `init --client claude-desktop|cursor|claude-code` to merge MCP client configuration while preserving a backup.
- **Added** — `trustline` to prepare an agent account for USDC on mainnet.
- **Verified** — End-to-end float spending on testnet. Direct settlement of MPP charges was not supported by the tested facilitator; see [`docs/MPP-DIRECT-SETTLEMENT.md`](../../docs/MPP-DIRECT-SETTLEMENT.md).

## [0.2.2]

- **Changed** — Released `eunomia-mcp` version 0.2.2.

## [0.2.1]

- **Added** — Amounts include their token unit.

## [0.2.0]

- **Added** — Initial MCP package with treasury payment and exception-request workflows.

[Unreleased]: https://github.com/eunomia-finance/eunomia/compare/mcp-v0.3.0...HEAD
[0.3.0]: https://github.com/eunomia-finance/eunomia/releases/tag/mcp-v0.3.0