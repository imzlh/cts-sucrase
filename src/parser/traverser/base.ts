import State from "../tokenizer/state";
import {ContextualKeyword} from "../tokenizer/keywords";
import {type TokenType} from "../tokenizer/types";
import {charCodes} from "../util/charcodes";

export let isJSXEnabled: boolean;
export let isTypeScriptEnabled: boolean;
export let isFlowEnabled: boolean;
export let state: State;
export let input: string;
export let nextContextId: number;

export function getNextContextId(): number {
  return nextContextId++;
}

export function restoreParserState(
  potentialArrowAt: number,
  noAnonFunctionType: boolean,
  inDisallowConditionalTypesContext: boolean,
  tokensLength: number,
  scopesLength: number,
  pos: number,
  type: TokenType,
  contextualKeyword: ContextualKeyword,
  start: number,
  end: number,
  isType: boolean,
  scopeDepth: number,
  error: Error | null,
): void {
  state.potentialArrowAt = potentialArrowAt;
  state.noAnonFunctionType = noAnonFunctionType;
  state.inDisallowConditionalTypesContext = inDisallowConditionalTypesContext;
  state.tokens.length = tokensLength;
  state.scopes.length = scopesLength;
  state.pos = pos;
  state.type = type;
  state.contextualKeyword = contextualKeyword;
  state.start = start;
  state.end = end;
  state.isType = isType;
  state.scopeDepth = scopeDepth;
  state.error = error;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function augmentError(error: any): any {
  if ("pos" in error) {
    const loc = locationForIndex(error.pos);
    error.message += ` (${loc.line}:${loc.column})`;
    error.loc = loc;
  }
  return error;
}

export class Loc {
  line: number;
  column: number;
  constructor(line: number, column: number) {
    this.line = line;
    this.column = column;
  }
}

export function locationForIndex(pos: number): Loc {
  let line = 1;
  let column = 1;
  for (let i = 0; i < pos; i++) {
    if (input.charCodeAt(i) === charCodes.lineFeed) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return new Loc(line, column);
}

export function initParser(
  inputCode: string,
  isJSXEnabledArg: boolean,
  isTypeScriptEnabledArg: boolean,
  isFlowEnabledArg: boolean,
): void {
  input = inputCode;
  state = new State();
  nextContextId = 1;
  isJSXEnabled = isJSXEnabledArg;
  isTypeScriptEnabled = isTypeScriptEnabledArg;
  isFlowEnabled = isFlowEnabledArg;
}
