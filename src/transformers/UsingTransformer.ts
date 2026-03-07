import type NameManager from "../NameManager";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import Transformer from "./Transformer";

export default class UsingTransformer extends Transformer {
  constructor(readonly tokens: TokenProcessor, readonly nameManager: NameManager) {
    super();
  }

  process(): boolean {
    if (this.tokens.matchesContextual(ContextualKeyword._using)) {
      // Only replace `using` when it's a declaration keyword, not when used as an
      // identifier (e.g. `obj.using`, `{ using: 5 }`, `for (using of ...)`)
      // Guard: next token must be a plain identifier, and not `of` (for-of loop variable)
      const next = this.tokens.tokenAtRelativeIndex(1);
      if (
        next &&
        next.type === tt.name &&
        next.contextualKeyword !== ContextualKeyword._of
      ) {
        this.tokens.replaceToken("const");
        return true;
      }
    }
    if (this.tokens.matchesContextual(ContextualKeyword._await)) {
      const next = this.tokens.tokenAtRelativeIndex(1);
      if (
        next &&
        next.type === tt.name &&
        this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._using)
      ) {
        // `await using foo = expr` -> `const foo = expr`
        // The `await` in `await using` applies to disposal (not initialization), so drop it.
        this.tokens.removeInitialToken();
        this.tokens.replaceToken("const");
        return true;
      }
    }
    return false;
  }
}