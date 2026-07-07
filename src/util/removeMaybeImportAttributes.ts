import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

/**
 * Starting at a potential `with` or (legacy) `assert` token, remove the import
 * attributes if they exist.
 */
export function removeMaybeImportAttributes(tokens: TokenProcessor): void {
  const tokenList = tokens.tokens;
  const tokenIndex = tokens.currentIndex();
  const token = tokenList[tokenIndex];
  const nextToken = tokenList[tokenIndex + 1];
  if (
    (token.type === tt._with && nextToken.type === tt.braceL) ||
    (token.type === tt.name &&
      token.contextualKeyword === ContextualKeyword._assert &&
      nextToken.type === tt.braceL)
  ) {
    // assert
    tokens.removeToken();
    // {
    tokens.removeToken();
    tokens.removeBalancedCode();
    // }
    tokens.removeToken();
  }
}
