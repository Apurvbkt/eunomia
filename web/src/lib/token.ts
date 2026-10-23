// A treasury holds exactly one token, fixed when it is created. Two are offered: XLM, funded
// from the owner's wallet, and USDC — on testnet the TRY anchor's, funded with TRY through
// the anchor; on mainnet Circle's. Both are 7-decimal, so every amount in the app is the same
// arithmetic under a different label.
import { USDC_ISSUER, USDC_TOKEN, XLM_SAC } from "../config";

/** The USDC Stellar Asset Contract of this build's network. Derivable from the issuer
 *  (token.test.ts pins it to that derivation); written out so a label never has to wait
 *  for an issuer's stellar.toml. */
export { USDC_TOKEN };

/** The classic issuer behind USDC_TOKEN — a G… payee must trust it to receive USDC. */
export { USDC_ISSUER };

export type TokenCode = "XLM" | "USDC";

export const tokenIdOf = (code: TokenCode): string => (code === "USDC" ? USDC_TOKEN : XLM_SAC);

/** The label for a treasury's token. Anything unrecognised reads as XLM, which is what every
 *  treasury was before the choice existed. */
export const tokenCodeOf = (tokenId: string | null | undefined): TokenCode =>
  tokenId === USDC_TOKEN ? "USDC" : "XLM";
