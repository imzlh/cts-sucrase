import type NameManager from "../NameManager";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import type RootTransformer from "./RootTransformer";
import Transformer from "./Transformer";

const JEST_GLOBAL_NAME = "jest";

export default class JestHoistTransformer extends Transformer {
  private hoistedCode = "";

  constructor(
    readonly rootTransformer: RootTransformer,
    readonly tokens: TokenProcessor,
    readonly nameManager: NameManager,
  ) {
    super();
  }

  process(): boolean {
    const tokenList = this.tokens.tokens;
    const tokenIndex = this.tokens.currentIndex();
    const token = tokenList[tokenIndex];
    if (
      token.scopeDepth === 0 &&
      token.type === tt.name &&
      tokenList[tokenIndex + 1].type === tt.dot &&
      tokenList[tokenIndex + 2].type === tt.name &&
      tokenList[tokenIndex + 3].type === tt.parenL &&
      this.tokens.identifierNameForToken(token) === JEST_GLOBAL_NAME
    ) {
      return this.extractHoistedCalls();
    }

    return false;
  }

  getHoistedCode(): string {
    return this.hoistedCode;
  }

  private extractHoistedCalls(): boolean {
    const tokenList = this.tokens.tokens;
    this.tokens.removeToken();
    let followsNonHoistedJestCall = false;

    while (true) {
      const tokenIndex = this.tokens.currentIndex();
      if (
        tokenList[tokenIndex].type !== tt.dot ||
        tokenList[tokenIndex + 1].type !== tt.name ||
        tokenList[tokenIndex + 2].type !== tt.parenL
      ) {
        break;
      }
      const methodName = this.tokens.identifierNameForToken(tokenList[tokenIndex + 1]);
      if (isHoistedJestMethod(methodName)) {
        const hoistedFunctionName = this.nameManager.claimFreeName("__jestHoist");
        this.hoistedCode += `${hoistedFunctionName}();`;
        this.tokens.replaceToken(`function ${hoistedFunctionName}(){${JEST_GLOBAL_NAME}.`);
        this.tokens.copyToken();
        this.tokens.copyToken();
        this.rootTransformer.processBalancedCode();
        this.tokens.copyExpectedToken(tt.parenR);
        this.tokens.appendCode(";}");
        followsNonHoistedJestCall = false;
      } else {
        if (followsNonHoistedJestCall) {
          this.tokens.copyToken();
        } else {
          this.tokens.replaceToken(`${JEST_GLOBAL_NAME}.`);
        }
        this.tokens.copyToken();
        this.tokens.copyToken();
        this.rootTransformer.processBalancedCode();
        this.tokens.copyExpectedToken(tt.parenR);
        followsNonHoistedJestCall = true;
      }
    }

    return true;
  }
}

function isHoistedJestMethod(methodName: string): boolean {
  switch (methodName) {
    case "mock":
    case "unmock":
    case "enableAutomock":
    case "disableAutomock":
      return true;
    default:
      return false;
  }
}
