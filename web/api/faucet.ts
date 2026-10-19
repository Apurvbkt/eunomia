// Vercel serverless function: testnet starting funds for passkey users. The logic is
// host-neutral and lives in src/lib/faucetHandler.ts; the Cloudflare worker calls it too.
//
// Explicit .js extension: Vercel compiles api/* with node16 resolution, where an extensionless
// relative import does not resolve and the function dies at cold start with a 500. The local
// bundler config maps .js back to .ts, so this satisfies both.
import process from "node:process";
import { handleFaucet } from "../src/lib/faucetHandler.js";

// Exported as named HTTP methods, not as `export default`. Vercel treats a default export as
// the legacy `(req, res) => void` signature and ignores whatever it returns — so a handler
// written against the Web `Request`/`Response` API produced no response at all and the request
// hung until it timed out. Named methods select the fetch-style signature. GET is wired up too
// so the handler's own 405 answers it.
const handler = (req: Request): Promise<Response> => handleFaucet(req, process.env);

export const GET = handler;
export const POST = handler;
