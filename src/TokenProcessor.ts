import type {HelperManager} from "./HelperManager";
import type {Token} from "./parser/tokenizer";
import type {ContextualKeyword} from "./parser/tokenizer/keywords";
import {type TokenType, TokenType as tt} from "./parser/tokenizer/types";

export interface TokenProcessorSnapshot {
  resultCodeLength: number;
  tokenIndex: number;
}

export interface TokenProcessorResult {
  code: string;
  mappings: Int32Array | null;
}

export default class TokenProcessor {
  private resultCode = "";
  private resultCodeLength = 0;
  private resultMappings: Int32Array | null = null;
  private tokenIndex = 0;

  constructor(
    readonly code: string,
    readonly tokens: Array<Token>,
    readonly isFlowEnabled: boolean,
    readonly helperManager: HelperManager,
    readonly shouldGenerateSourceMap: boolean,
  ) {}

  snapshot(): TokenProcessorSnapshot {
    return {
      resultCodeLength: this.resultCodeLength,
      tokenIndex: this.tokenIndex,
    };
  }

  currentResultCodeLength(): number {
    return this.resultCodeLength;
  }

  restoreToSnapshot(snapshot: TokenProcessorSnapshot): void {
    this.resultCode = this.resultCode.slice(0, snapshot.resultCodeLength);
    this.resultCodeLength = snapshot.resultCodeLength;
    this.tokenIndex = snapshot.tokenIndex;
  }

  restoreToState(resultCodeLength: number, tokenIndex: number): void {
    this.resultCode = this.resultCode.slice(0, resultCodeLength);
    this.resultCodeLength = resultCodeLength;
    this.tokenIndex = tokenIndex;
  }

  dangerouslyGetAndRemoveCodeSinceSnapshot(snapshot: TokenProcessorSnapshot): string {
    const result = this.resultCode.slice(snapshot.resultCodeLength);
    this.resultCode = this.resultCode.slice(0, snapshot.resultCodeLength);
    this.resultCodeLength = snapshot.resultCodeLength;
    return result;
  }

  dangerouslyGetAndRemoveCodeSince(resultCodeLength: number): string {
    const result = this.resultCode.slice(resultCodeLength);
    this.resultCode = this.resultCode.slice(0, resultCodeLength);
    this.resultCodeLength = resultCodeLength;
    return result;
  }

  reset(): void {
    this.resultCode = "";
    this.resultCodeLength = 0;
    this.resultMappings = this.shouldGenerateSourceMap ? new Int32Array(this.tokens.length) : null;
    this.tokenIndex = 0;
  }

  matchesContextualAtIndex(index: number, contextualKeyword: ContextualKeyword): boolean {
    const token = this.tokens[index];
    return token.type === tt.name && token.contextualKeyword === contextualKeyword;
  }

  identifierNameAtIndex(index: number): string {
    return this.identifierNameForToken(this.tokens[index]);
  }

  identifierNameAtRelativeIndex(relativeIndex: number): string {
    return this.identifierNameForToken(this.tokenAtRelativeIndex(relativeIndex));
  }

  identifierName(): string {
    return this.identifierNameForToken(this.currentToken());
  }

  identifierNameForToken(token: Token): string {
    return this.code.slice(token.start, token.end);
  }

  rawCodeForToken(token: Token): string {
    return this.code.slice(token.start, token.end);
  }

  stringValueAtIndex(index: number): string {
    return this.stringValueForToken(this.tokens[index]);
  }

  stringValue(): string {
    return this.stringValueForToken(this.currentToken());
  }

  stringValueForToken(token: Token): string {
    return this.code.slice(token.start + 1, token.end - 1);
  }

  matches1AtIndex(index: number, t1: TokenType): boolean {
    return this.tokens[index].type === t1;
  }

  matches2AtIndex(index: number, t1: TokenType, t2: TokenType): boolean {
    const tokens = this.tokens;
    return tokens[index].type === t1 && tokens[index + 1].type === t2;
  }

  matches3AtIndex(index: number, t1: TokenType, t2: TokenType, t3: TokenType): boolean {
    const tokens = this.tokens;
    return (
      tokens[index].type === t1 &&
      tokens[index + 1].type === t2 &&
      tokens[index + 2].type === t3
    );
  }

  matches1(t1: TokenType): boolean {
    return this.tokens[this.tokenIndex].type === t1;
  }

  matches2(t1: TokenType, t2: TokenType): boolean {
    const tokens = this.tokens;
    const index = this.tokenIndex;
    return tokens[index].type === t1 && tokens[index + 1].type === t2;
  }

  matches3(t1: TokenType, t2: TokenType, t3: TokenType): boolean {
    const tokens = this.tokens;
    const index = this.tokenIndex;
    return (
      tokens[index].type === t1 &&
      tokens[index + 1].type === t2 &&
      tokens[index + 2].type === t3
    );
  }

  matches4(t1: TokenType, t2: TokenType, t3: TokenType, t4: TokenType): boolean {
    const tokens = this.tokens;
    const index = this.tokenIndex;
    return (
      tokens[index].type === t1 &&
      tokens[index + 1].type === t2 &&
      tokens[index + 2].type === t3 &&
      tokens[index + 3].type === t4
    );
  }

  matches5(t1: TokenType, t2: TokenType, t3: TokenType, t4: TokenType, t5: TokenType): boolean {
    const tokens = this.tokens;
    const index = this.tokenIndex;
    return (
      tokens[index].type === t1 &&
      tokens[index + 1].type === t2 &&
      tokens[index + 2].type === t3 &&
      tokens[index + 3].type === t4 &&
      tokens[index + 4].type === t5
    );
  }

  matchesContextual(contextualKeyword: ContextualKeyword): boolean {
    const token = this.tokens[this.tokenIndex];
    return token.type === tt.name && token.contextualKeyword === contextualKeyword;
  }

  matchesContextIdAndLabel(type: TokenType, contextId: number): boolean {
    const token = this.tokens[this.tokenIndex];
    return token.type === type && token.contextId === contextId;
  }

  replaceToken(newCode: string): void {
    this.appendPreviousWhitespaceAndComments();
    const tokenIndex = this.tokenIndex;
    if (this.resultMappings !== null) {
      this.resultMappings[tokenIndex] = this.resultCodeLength + 1;
    }
    this.appendResultCode(newCode);
    this.tokenIndex = tokenIndex + 1;
  }

  replaceTokenTrimmingLeftWhitespace(newCode: string): void {
    this.appendPreviousWhitespaceAndCommentsTrimmingLeft();
    const tokenIndex = this.tokenIndex;
    if (this.resultMappings !== null) {
      this.resultMappings[tokenIndex] = this.resultCodeLength + 1;
    }
    this.appendResultCode(newCode);
    this.tokenIndex = tokenIndex + 1;
  }

  removeInitialToken(): void {
    this.appendPreviousWhitespaceAndComments();
    const tokenIndex = this.tokenIndex;
    if (this.resultMappings !== null) {
      this.resultMappings[tokenIndex] = this.resultCodeLength + 1;
    }
    this.tokenIndex = tokenIndex + 1;
  }

  removeToken(): void {
    this.appendPreviousWhitespaceAndCommentsTrimmingLeft();
    const tokenIndex = this.tokenIndex;
    if (this.resultMappings !== null) {
      this.resultMappings[tokenIndex] = this.resultCodeLength + 1;
    }
    this.tokenIndex = tokenIndex + 1;
  }

  removeBalancedCode(): void {
    let braceDepth = 0;
    const tokenList = this.tokens;
    while (this.tokenIndex < tokenList.length) {
      const tokenType = tokenList[this.tokenIndex].type;
      if (tokenType === tt.braceL) {
        braceDepth++;
      } else if (tokenType === tt.braceR) {
        if (braceDepth === 0) {
          return;
        }
        braceDepth--;
      }
      this.removeToken();
    }
  }

  copyExpectedToken(tokenType: TokenType): void {
    if (this.tokens[this.tokenIndex].type !== tokenType) {
      throw new Error(`Expected token ${tokenType}`);
    }
    this.copyToken();
  }

  copyToken(): void {
    if (!this.isFlowEnabled && this.resultMappings === null) {
      const tokenIndex = this.tokenIndex;
      const start = tokenIndex > 0 ? this.tokens[tokenIndex - 1].end : 0;
      const end = this.tokens[tokenIndex].end;
      this.appendResultCode(this.code.slice(start, end));
      this.tokenIndex = tokenIndex + 1;
      return;
    }
    this.appendPreviousWhitespaceAndComments();
    const tokenIndex = this.tokenIndex;
    const token = this.tokens[tokenIndex];
    if (this.resultMappings !== null) {
      this.resultMappings[tokenIndex] = this.resultCodeLength + 1;
    }
    this.appendResultCode(this.code.slice(token.start, token.end));
    this.tokenIndex = tokenIndex + 1;
  }

  copyTokenWithPrefix(prefix: string): void {
    this.appendPreviousWhitespaceAndComments();
    this.appendResultCode(prefix);
    const tokenIndex = this.tokenIndex;
    const token = this.tokens[tokenIndex];
    if (this.resultMappings !== null) {
      this.resultMappings[tokenIndex] = this.resultCodeLength + 1;
    }
    this.appendResultCode(this.code.slice(token.start, token.end));
    this.tokenIndex = tokenIndex + 1;
  }

  appendCode(code: string): void {
    this.appendResultCode(code);
  }

  currentToken(): Token {
    return this.tokens[this.tokenIndex];
  }

  currentTokenCode(): string {
    const token = this.currentToken();
    return this.code.slice(token.start, token.end);
  }

  tokenAtRelativeIndex(relativeIndex: number): Token {
    return this.tokens[this.tokenIndex + relativeIndex];
  }

  currentIndex(): number {
    return this.tokenIndex;
  }

  nextToken(): void {
    if (this.tokenIndex === this.tokens.length) {
      throw new Error("Unexpectedly reached end of input.");
    }
    this.tokenIndex++;
  }

  previousToken(): void {
    this.tokenIndex--;
  }

  finish(): TokenProcessorResult {
    if (this.tokenIndex !== this.tokens.length) {
      throw new Error("Tried to finish processing tokens before reaching the end.");
    }
    this.appendPreviousWhitespaceAndComments();
    return {code: this.resultCode, mappings: this.resultMappings};
  }

  isAtEnd(): boolean {
    return this.tokenIndex === this.tokens.length;
  }

  private appendResultCode(code: string): void {
    if (code.length === 0) {
      return;
    }
    this.resultCode += code;
    this.resultCodeLength += code.length;
  }

  private appendPreviousWhitespaceAndComments(): void {
    const start = this.tokenIndex > 0 ? this.tokens[this.tokenIndex - 1].end : 0;
    const end = this.tokenIndex < this.tokens.length
      ? this.tokens[this.tokenIndex].start
      : this.code.length;
    if (start === end) {
      return;
    }
    if (this.isFlowEnabled) {
      this.appendCodeWithoutFlowPragma(start, end);
      return;
    }
    this.appendResultCode(this.code.slice(start, end));
  }

  private appendPreviousWhitespaceAndCommentsTrimmingLeft(): void {
    const start = this.tokenIndex > 0 ? this.tokens[this.tokenIndex - 1].end : 0;
    const end = this.tokenIndex < this.tokens.length
      ? this.tokens[this.tokenIndex].start
      : this.code.length;
    if (start === end) {
      return;
    }
    this.appendLineBreaks(start, end);
  }

  private appendCodeWithoutFlowPragma(start: number, end: number): void {
    let chunkStart = start;
    while (chunkStart < end) {
      const flowIndex = this.code.indexOf("@flow", chunkStart);
      if (flowIndex === -1 || flowIndex + 5 > end) {
        break;
      }
      this.appendResultCode(this.code.slice(chunkStart, flowIndex));
      chunkStart = flowIndex + 5;
    }
    this.appendResultCode(this.code.slice(chunkStart, end));
  }

  private appendLineBreaks(start: number, end: number): void {
    const code = this.code;
    const carriageReturnIndex = code.indexOf("\r", start);
    if (carriageReturnIndex === -1 || carriageReturnIndex >= end) {
      this.appendLineFeedsOnly(start, end);
      return;
    }
    let i = nextLineBreakIndex(code, start, end);
    while (i !== -1) {
      const newlineStart = i;
      do {
        i++;
      } while (i < end && (code.charCodeAt(i) === 10 || code.charCodeAt(i) === 13));
      this.appendResultCode(code.slice(newlineStart, i));
      i = nextLineBreakIndex(code, i, end);
    }
  }

  private appendLineFeedsOnly(start: number, end: number): void {
    const code = this.code;
    let lineFeedCount = 0;
    let i = code.indexOf("\n", start);
    while (i !== -1 && i < end) {
      lineFeedCount++;
      i = code.indexOf("\n", i + 1);
    }
    if (lineFeedCount > 0) {
      this.appendResultCode("\n".repeat(lineFeedCount));
    }
  }
}

function nextLineBreakIndex(code: string, start: number, end: number): number {
  const lineFeedIndex = code.indexOf("\n", start);
  const carriageReturnIndex = code.indexOf("\r", start);
  let index: number;
  if (lineFeedIndex === -1) {
    index = carriageReturnIndex;
  } else if (carriageReturnIndex === -1) {
    index = lineFeedIndex;
  } else {
    index = lineFeedIndex < carriageReturnIndex ? lineFeedIndex : carriageReturnIndex;
  }
  return index !== -1 && index < end ? index : -1;
}
