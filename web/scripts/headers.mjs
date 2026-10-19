// Writes dist/_headers — the security headers Cloudflare serves with every static asset,
// including a CSP with a strict script-src.
//
// script-src names every inline script by hash instead of allowing 'unsafe-inline'. The hashes
// cannot be written by hand: the docs site (VitePress) inlines a page-hash map that changes
// whenever the docs do. So they are read from the built HTML here, after `vite build`, and the
// policy always matches the files it ships with.
//
// Vercel (testnet, until the move) keeps its own headers in vercel.json; this file is the
// Cloudflare one.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const htmlFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : [],
  );

export function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim() === "") continue;
    // The browser hashes the script as parsed, and the HTML parser turns CRLF into LF. A
    // checkout with Windows line endings would otherwise ship a hash no browser computes.
    const text = m[1].replace(/\r\n?/g, "\n");
    out.push(`'sha256-${createHash("sha256").update(text).digest("base64")}'`);
  }
  return out;
}

const hashes = [...new Set(htmlFiles(DIST).flatMap((f) => inlineScriptHashes(readFileSync(f, "utf8"))))];

// Every origin the app talks to, and why. Anything not here is refused by the browser.
const connect = [
  "'self'",
  "https://*.stellar.org", // Soroban RPC, Horizon, friendbot (testnet and mainnet)
  "https://*.supabase.co", // activity + funnel tables
  "wss://*.supabase.co",
  "https://*.walletconnect.org", // WalletConnect v2 (mobile wallets)
  "wss://*.walletconnect.org",
  "https://*.walletconnect.com",
  "wss://*.walletconnect.com",
  "https://*.reown.com",
  "https://*.web3modal.org",
  "https://tr-mock-anchor.fly.dev", // the TRY → USDC anchor leg
  "https://cloudflareinsights.com", // Web Analytics beacon
];

const csp = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(" ")} https://static.cloudflareinsights.com`,
  // React and framer-motion write style attributes; fonts come from two hosts.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com",
  "img-src 'self' data: blob: https:",
  `connect-src ${connect.join(" ")}`,
  "frame-src https://verify.walletconnect.org https://verify.walletconnect.com https://secure.walletconnect.org",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const headers = `/*
  Content-Security-Policy: ${csp}
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
`;

writeFileSync(join(DIST, "_headers"), headers);
console.log(`headers — dist/_headers written, ${hashes.length} inline script hash(es) in script-src`);
