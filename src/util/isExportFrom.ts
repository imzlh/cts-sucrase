import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

/**
 * Starting at `export {`, look ahead and return `true` if this is an
 * `export {...} from` statement and `false` if this is a plain multi-export.
 */
export default function isExportFrom(tokens: TokenProcessor): boolean {
  const tokenList = tokens.tokens;
  let closeBraceIndex = tokens.currentIndex();
  // Bounded scan: stop at end-of-tokens to avoid infinite loop on malformed input
  while (closeBraceIndex < tokenList.length && tokenList[closeBraceIndex].type !== tt.braceR) {
    closeBraceIndex++;
  }
  if (closeBraceIndex >= tokenList.length) return false;
  return (
    tokenList[closeBraceIndex + 1].type === tt.name &&
    tokenList[closeBraceIndex + 1].contextualKeyword === ContextualKeyword._from &&
    tokenList[closeBraceIndex + 2].type === tt.string
  );
}
