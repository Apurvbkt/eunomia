import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { resolveNetwork, type NetworkConfig } from './src/networks'

/** Records which network the bundle was built for, next to the bundle. check:no-secrets and
 *  headers.mjs read this rather than any source file, so they judge what was built. */
function buildInfo(net: NetworkConfig): Plugin {
  const info = { network: net.name, rpcOrigin: new URL(net.rpcUrl).origin }
  return {
    name: 'eunomia-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(info) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `vite build --mode mainnet` is the mainnet build; EUNOMIA_* from the environment fill in
  // what networks.ts leaves for deploy time. Anything missing stops the build here.
  const env = loadEnv(mode, process.cwd(), 'EUNOMIA_')
  const net = resolveNetwork(mode === 'mainnet' ? { ...env, EUNOMIA_NETWORK: 'pubnet' } : env)

  return {
    plugins: [react(), buildInfo(net)],
    define: {
      global: 'globalThis',
      // Two separate constants on purpose: the bare string folds in comparisons, so testnet-only
      // branches (the guided demo and its key among them) drop out of a mainnet bundle.
      __EUNOMIA_NETWORK__: JSON.stringify(net.name),
      __EUNOMIA_NET__: JSON.stringify(net),
    },
    resolve: {
      // Seven packages in this tree ship their own @stellar/stellar-sdk (passkey-kit pins it
      // exactly while also declaring it a peer). XDR encoding checks values with `instanceof`,
      // so two copies in one bundle are two incompatible sets of classes: an auth entry built
      // by the app's SDK was rejected inside passkey-kit's writer with
      // "XDR Write Error: <nonce> is not a Te" the moment a real passkey signed a deploy.
      //
      // Deduping is deliberately scoped to the bundle. The npm tree is left alone: collapsing
      // it with `overrides` re-resolved transitive deps and left the SDK's CommonJS entry
      // requiring an ESM-only @noble/hashes, which killed the relay function on boot.
      dedupe: ['@stellar/stellar-sdk'],
    },
    test: {
      // Playwright owns tests/e2e — vitest must not try to collect its specs.
      exclude: [...configDefaults.exclude, 'tests/e2e/**'],
      server: {
        deps: {
          // The kit ships ESM but is externalized by default; inlining routes it through
          // vite's resolver so the freighter-api alias below actually applies.
          inline: [/@creit\.tech\/stellar-wallets-kit/],
        },
      },
      alias: {
        // CJS package whose named exports break node-ESM interop under vitest; the kit's
        // Freighter module imports it, and walletDevice.test.ts imports that module for
        // the real FREIGHTER_ID. See src/test-stubs/freighter-api.ts.
        '@stellar/freighter-api': fileURLToPath(
          new URL('./src/test-stubs/freighter-api.ts', import.meta.url),
        ),
      },
    },
  }
})
