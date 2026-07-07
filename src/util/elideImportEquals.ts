import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

export default function elideImportEquals(tokens: TokenProcessor): void {
  const tokenList = tokens.tokens;
  // import
  tokens.removeInitialToken();
  // name
  tokens.removeToken();
  // =
  tokens.removeToken();
  // name or require
  tokens.removeToken();
  // Handle either `import A = require('A')` or `import A = B.C.D`.
  if (tokenList[tokens.currentIndex()].type === tt.parenL) {
    // (
    tokens.removeToken();
    // path string
    tokens.removeToken();
    // )
    tokens.removeToken();
  } else {
    while (tokenList[tokens.currentIndex()].type === tt.dot) {
      // .
      tokens.removeToken();
      // name
      tokens.removeToken();
    }
  }
}
