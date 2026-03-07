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
      this.tokens.replaceToken("const");
      return true;
    }
    if (
      this.tokens.matches1(tt._async) ||
      this.tokens.matchesContextual(ContextualKeyword._await)
    ) {
      const nextToken = this.tokens.tokenAtRelativeIndex(1);
      if (
        nextToken.type === tt.name &&
        this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._using)
      ) {
        this.tokens.copyToken();
        this.tokens.replaceToken("const");
        return true;
      }
    }
    return false;
  }
}
