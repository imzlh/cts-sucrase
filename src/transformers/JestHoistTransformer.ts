import type NameManager from "../NameManager";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import type RootTransformer from "./RootTransformer";
import Transformer from "./Transformer";

const JEST_GLOBAL_NAME = "jest";
const HOISTED_METHODS = ["mock", "unmock", "enableAutomock", "disableAutomock"];

export default class JestHoistTransformer extends Transformer {
  private readonly hoistedFunctionNames: Array<string> = [];

  constructor(
    readonly rootTransformer: RootTransformer,
    readonly tokens: TokenProcessor,
    readonly nameManager: NameManager,
  ) {
    super();
  }

  process(): boolean {
    if (
      this.tokens.currentToken().scopeDepth === 0 &&
      this.tokens.matches4(tt.name, tt.dot, tt.name, tt.parenL) &&
      this.tokens.identifierName() === JEST_GLOBAL_NAME
    ) {
      return this.extractHoistedCalls();
    }

    return false;
  }

  getHoistedCode(): string {
    if (this.hoistedFunctionNames.length > 0) {
      return this.hoistedFunctionNames.map((name) => `${name}();`).join("");
    }
    return "";
  }

  private extractHoistedCalls(): boolean {
    this.tokens.removeToken();
    let followsNonHoistedJestCall = false;

    while (this.tokens.matches3(tt.dot, tt.name, tt.parenL)) {
      const methodName = this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + 1);
      const shouldHoist = HOISTED_METHODS.includes(methodName);
      if (shouldHoist) {
        const hoistedFunctionName = this.nameManager.claimFreeName("__jestHoist");
        this.hoistedFunctionNames.push(hoistedFunctionName);
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
