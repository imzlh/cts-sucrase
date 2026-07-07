import type {Token} from "./index";
import {ContextualKeyword} from "./keywords";
import {type TokenType, TokenType as tt} from "./types";

export interface Scope {
  startTokenIndex: number;
  endTokenIndex: number;
  isFunctionScope: boolean;
}

export function appendScope(
  scopes: Array<Scope>,
  startTokenIndex: number,
  endTokenIndex: number,
  isFunctionScope: boolean,
): void {
  scopes[scopes.length] = {startTokenIndex, endTokenIndex, isFunctionScope};
}

export interface StateSnapshot {
  potentialArrowAt: number;
  noAnonFunctionType: boolean;
  inDisallowConditionalTypesContext: boolean;
  tokensLength: number;
  scopesLength: number;
  pos: number;
  type: TokenType;
  contextualKeyword: ContextualKeyword;
  start: number;
  end: number;
  isType: boolean;
  scopeDepth: number;
  error: Error | null;
}

export default class State {
  // Used to signify the start of a potential arrow function
  potentialArrowAt: number = -1;

  // Used by Flow to handle an edge case involving function type parsing.
  noAnonFunctionType: boolean = false;

  // Used by TypeScript to handle ambiguities when parsing conditional types.
  inDisallowConditionalTypesContext: boolean = false;

  // Token store.
  tokens: Array<Token> = [];

  // Array of all observed scopes, ordered by their ending position.
  scopes: Array<Scope> = [];

  // The current position of the tokenizer in the input.
  pos: number = 0;

  // Information about the current token.
  type: TokenType = tt.eof;
  contextualKeyword: ContextualKeyword = ContextualKeyword.NONE;
  start: number = 0;
  end: number = 0;

  isType: boolean = false;
  scopeDepth: number = 0;

  /**
   * If the parser is in an error state, then the token is always tt.eof and all functions can
   * keep executing but should be written so they don't get into an infinite loop in this situation.
   *
   * This approach, combined with the ability to snapshot and restore state, allows us to implement
   * backtracking without exceptions and without needing to explicitly propagate error states
   * everywhere.
   */
  error: Error | null = null;

  snapshot(): StateSnapshot {
    return {
      potentialArrowAt: this.potentialArrowAt,
      noAnonFunctionType: this.noAnonFunctionType,
      inDisallowConditionalTypesContext: this.inDisallowConditionalTypesContext,
      tokensLength: this.tokens.length,
      scopesLength: this.scopes.length,
      pos: this.pos,
      type: this.type,
      contextualKeyword: this.contextualKeyword,
      start: this.start,
      end: this.end,
      isType: this.isType,
      scopeDepth: this.scopeDepth,
      error: this.error,
    };
  }

  restoreFromSnapshot(snapshot: StateSnapshot): void {
    this.potentialArrowAt = snapshot.potentialArrowAt;
    this.noAnonFunctionType = snapshot.noAnonFunctionType;
    this.inDisallowConditionalTypesContext = snapshot.inDisallowConditionalTypesContext;
    this.tokens.length = snapshot.tokensLength;
    this.scopes.length = snapshot.scopesLength;
    this.pos = snapshot.pos;
    this.type = snapshot.type;
    this.contextualKeyword = snapshot.contextualKeyword;
    this.start = snapshot.start;
    this.end = snapshot.end;
    this.isType = snapshot.isType;
    this.scopeDepth = snapshot.scopeDepth;
    this.error = snapshot.error;
  }
}
