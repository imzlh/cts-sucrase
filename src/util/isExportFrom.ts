import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

/**
 * Starting at `export {`, look ahead and return `true` if this is an
 * `export {...} from` statement and `false` if this is a plain multi-export.
 */
export default function isExportFrom(tokens: TokenProcessor): boolean {
  let closeBraceIndex = tokens.currentIndex();
  // Bounded scan: stop at end-of-tokens to avoid infinite loop on malformed input
  while (closeBraceIndex < tokens.tokens.length && !tokens.matches1AtIndex(closeBraceIndex, tt.braceR)) {
    closeBraceIndex++;
  }
  if (closeBraceIndex >= tokens.tokens.length) return false;
  return (
    tokens.matchesContextualAtIndex(closeBraceIndex + 1, ContextualKeyword._from) &&
    tokens.matches1AtIndex(closeBraceIndex + 2, tt.string)
  );
}
