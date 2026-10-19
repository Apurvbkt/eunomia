// Vercel serverless function: fee sponsorship for passkey users. The logic is host-neutral
// and lives in src/lib/relayHandler.ts; the Cloudflare Pages function in functions/api/
// calls the same handler. See that file for what is sponsored and why.
//
// This deployment is testnet: no rate limiter is wired here, and a pubnet env without one is
// refused by the handler itself.
// Explicit .js extensions — see the note in api/faucet.ts.
import process from "node:process";
import { handleRelay } from "../src/lib/relayHandler.js";

// Named HTTP methods rather than `export default` — see the note in api/faucet.ts.
const handler = (req: Request): Promise<Response> => handleRelay(req, process.env);

export const GET = handler;
export const POST = handler;
