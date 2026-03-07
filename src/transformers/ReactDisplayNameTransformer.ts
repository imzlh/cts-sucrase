import type {Options} from "../index";
import {IdentifierRole} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import type RootTransformer from "./RootTransformer";
import Transformer from "./Transformer";

export default class ReactDisplayNameTransformer extends Transformer {
  constructor(
    readonly rootTransformer: RootTransformer,
    readonly tokens: TokenProcessor,
    readonly importProcessor: null,
    readonly options: Options,
  ) {
    super();
  }

  process(): boolean {
    const startIndex = this.tokens.currentIndex();
    if (this.tokens.identifierName() === "createReactClass") {
      this.tokens.copyToken();
      this.tryProcessCreateClassCall(startIndex);
      return true;
    }
    if (
      this.tokens.matches3(tt.name, tt.dot, tt.name) &&
      this.tokens.identifierName() === "React" &&
      this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + 2) === "createClass"
    ) {
      this.tokens.copyToken();
      this.tokens.copyToken();
      this.tokens.copyToken();
      this.tryProcessCreateClassCall(startIndex);
      return true;
    }
    return false;
  }

  private tryProcessCreateClassCall(startIndex: number): void {
    const displayName = this.findDisplayName(startIndex);
    if (!displayName) {
      return;
    }

    if (this.classNeedsDisplayName()) {
      this.tokens.copyExpectedToken(tt.parenL);
      this.tokens.copyExpectedToken(tt.braceL);
      this.tokens.appendCode(`displayName: '${displayName}',`);
      this.rootTransformer.processBalancedCode();
      this.tokens.copyExpectedToken(tt.braceR);
      this.tokens.copyExpectedToken(tt.parenR);
    }
  }

  private findDisplayName(startIndex: number): string | null {
    if (startIndex < 2) {
      return null;
    }
    if (this.tokens.matches2AtIndex(startIndex - 2, tt.name, tt.eq)) {
      return this.tokens.identifierNameAtIndex(startIndex - 2);
    }
    if (
      startIndex >= 2 &&
      this.tokens.tokens[startIndex - 2].identifierRole === IdentifierRole.ObjectKey
    ) {
      return this.tokens.identifierNameAtIndex(startIndex - 2);
    }
    if (this.tokens.matches2AtIndex(startIndex - 2, tt._export, tt._default)) {
      return this.getDisplayNameFromFilename();
    }
    return null;
  }

  private getDisplayNameFromFilename(): string {
    const filePath = this.options.filePath || "unknown";
    const pathSegments = filePath.split("/");
    const filename = pathSegments[pathSegments.length - 1];
    const dotIndex = filename.lastIndexOf(".");
    const baseFilename = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
    if (baseFilename === "index" && pathSegments[pathSegments.length - 2]) {
      return pathSegments[pathSegments.length - 2];
    } else {
      return baseFilename;
    }
  }

  private classNeedsDisplayName(): boolean {
    let index = this.tokens.currentIndex();
    if (!this.tokens.matches2(tt.parenL, tt.braceL)) {
      return false;
    }
    const objectStartIndex = index + 1;
    const objectContextId = this.tokens.tokens[objectStartIndex].contextId;
    if (objectContextId == null) {
      throw new Error("Expected non-null context ID on object open-brace.");
    }

    for (; index < this.tokens.tokens.length; index++) {
      const token = this.tokens.tokens[index];
      if (token.type === tt.braceR && token.contextId === objectContextId) {
        index++;
        break;
      }

      if (
        this.tokens.identifierNameAtIndex(index) === "displayName" &&
        this.tokens.tokens[index].identifierRole === IdentifierRole.ObjectKey &&
        token.contextId === objectContextId
      ) {
        return false;
      }
    }

    if (index === this.tokens.tokens.length) {
      throw new Error("Unexpected end of input when processing React class.");
    }

    return (
      this.tokens.matches1AtIndex(index, tt.parenR) ||
      this.tokens.matches2AtIndex(index, tt.comma, tt.parenR)
    );
  }
}
