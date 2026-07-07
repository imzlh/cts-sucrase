import type {Options} from "../index";
import {IdentifierRole, type Token} from "../parser/tokenizer";
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
    const tokenList = this.tokens.tokens;
    const token = tokenList[startIndex];
    if (token.type !== tt.name) {
      return false;
    }
    if (tokenMatchesCode(this.tokens.code, token, "createReactClass")) {
      this.tokens.copyToken();
      this.tryProcessCreateClassCall(startIndex);
      return true;
    }
    if (
      tokenList[startIndex + 1].type === tt.dot &&
      tokenList[startIndex + 2].type === tt.name &&
      tokenMatchesCode(this.tokens.code, token, "React") &&
      tokenMatchesCode(this.tokens.code, tokenList[startIndex + 2], "createClass")
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
    const tokenList = this.tokens.tokens;
    const nameToken = tokenList[startIndex - 2];
    if (nameToken.type === tt.name && tokenList[startIndex - 1].type === tt.eq) {
      return this.tokens.identifierNameForToken(nameToken);
    }
    if (
      startIndex >= 2 &&
      nameToken.identifierRole === IdentifierRole.ObjectKey
    ) {
      return this.tokens.identifierNameForToken(nameToken);
    }
    if (nameToken.type === tt._export && tokenList[startIndex - 1].type === tt._default) {
      return this.getDisplayNameFromFilename();
    }
    return null;
  }

  private getDisplayNameFromFilename(): string {
    const filePath = this.options.filePath || "unknown";
    const filenameStart = filePath.lastIndexOf("/") + 1;
    const filename = filePath.slice(filenameStart);
    const dotIndex = filename.lastIndexOf(".");
    const baseFilename = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
    if (baseFilename === "index" && filenameStart > 0) {
      const parentEnd = filenameStart - 2;
      const parentStart = filePath.lastIndexOf("/", parentEnd) + 1;
      return filePath.slice(parentStart, parentEnd + 1);
    } else {
      return baseFilename;
    }
  }

  private classNeedsDisplayName(): boolean {
    let index = this.tokens.currentIndex();
    const tokenList = this.tokens.tokens;
    if (tokenList[index].type !== tt.parenL || tokenList[index + 1].type !== tt.braceL) {
      return false;
    }
    const objectStartIndex = index + 1;
    const objectContextId = tokenList[objectStartIndex].contextId;
    if (objectContextId == null) {
      throw new Error("Expected non-null context ID on object open-brace.");
    }

    for (; index < tokenList.length; index++) {
      const token = tokenList[index];
      if (token.type === tt.braceR && token.contextId === objectContextId) {
        index++;
        break;
      }

      if (
        token.type === tt.name &&
        token.identifierRole === IdentifierRole.ObjectKey &&
        token.contextId === objectContextId &&
        tokenMatchesCode(this.tokens.code, token, "displayName")
      ) {
        return false;
      }
    }

    if (index === tokenList.length) {
      throw new Error("Unexpected end of input when processing React class.");
    }

    return (
      tokenList[index].type === tt.parenR ||
      (tokenList[index].type === tt.comma && tokenList[index + 1].type === tt.parenR)
    );
  }
}

function tokenMatchesCode(code: string, token: Token, expected: string): boolean {
  const length = token.end - token.start;
  if (length !== expected.length) {
    return false;
  }
  for (let i = 0; i < length; i++) {
    if (code.charCodeAt(token.start + i) !== expected.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
