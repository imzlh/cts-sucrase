import type {Options} from "../index";
import {IdentifierRole} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import getJSXPragmaInfo, {type JSXPragmaInfo} from "./getJSXPragmaInfo";

export type NonTypeIdentifierCache = {
  __proto__: null;
  [name: string]: boolean | null | undefined;
};

export function hasNonTypeIdentifier(
  tokens: TokenProcessor,
  options: Options,
  cache: NonTypeIdentifierCache,
  name: string,
): boolean {
  const cached = cache[name];
  if (cached !== undefined && cached !== null) {
    return cached;
  }
  const result = scanForNonTypeIdentifier(tokens, options, name);
  cache[name] = result;
  return result;
}

function scanForNonTypeIdentifier(tokens: TokenProcessor, options: Options, name: string): boolean {
  let jsxPragmaInfo: JSXPragmaInfo | null = null;
  const tokenList = tokens.tokens;
  const length = name.length;
  for (let i = 0; i < tokenList.length; i++) {
    const token = tokenList[i];
    const tokenType = token.type;
    if (tokenType === tt.name) {
      if (
        !token.isType &&
        !token.shadowsGlobal &&
        (token.identifierRole === IdentifierRole.Access ||
          token.identifierRole === IdentifierRole.ObjectShorthand ||
          token.identifierRole === IdentifierRole.ExportAccess)
      ) {
        if (tokenMatchesName(tokens.code, token.start, token.end, name, length)) {
          return true;
        }
      }
    } else if (tokenType === tt.jsxTagStart && options.jsxRuntime !== "automatic") {
      jsxPragmaInfo ??= getJSXPragmaInfo(options);
      if (name === jsxPragmaInfo.base) {
        return true;
      }
      if (i + 1 < tokenList.length && tokenList[i + 1].type === tt.jsxTagEnd) {
        if (name === jsxPragmaInfo.fragmentBase) {
          return true;
        }
      }
    } else if (tokenType === tt.jsxName && token.identifierRole === IdentifierRole.Access) {
      // Lower-case single-component tag names like "div" don't count.
      if (!startsWithLowerCaseAt(tokens.code, token.start) || tokenList[i + 1].type === tt.dot) {
        if (tokenMatchesName(tokens.code, token.start, token.end, name, length)) {
          return true;
        }
      }
    }
  }
  return false;
}

function startsWithLowerCaseAt(code: string, index: number): boolean {
  const firstChar = code.charCodeAt(index);
  return firstChar >= 97 && firstChar <= 122;
}

function tokenMatchesName(
  code: string,
  start: number,
  end: number,
  name: string,
  length: number,
): boolean {
  if (end - start !== length) {
    return false;
  }
  for (let i = 0; i < length; i++) {
    if (code.charCodeAt(start + i) !== name.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
