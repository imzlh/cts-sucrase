import {
  isBlockScopedDeclaration,
  isFunctionScopedDeclaration,
  isNonTopLevelDeclaration,
} from "./parser/tokenizer";
import type {Scope} from "./parser/tokenizer/state";
import {TokenType as tt} from "./parser/tokenizer/types";
import type TokenProcessor from "./TokenProcessor";

/**
 * Traverse the given tokens and modify them if necessary to indicate that some names shadow global
 * variables.
 */
export default function identifyShadowedGlobals(
  tokens: TokenProcessor,
  scopes: Array<Scope>,
  globalNames: Array<string>,
): void {
  const globalNameMatcher = getGlobalNameMatcher(globalNames);
  if (!hasShadowedGlobalsWithMatcher(tokens, globalNameMatcher)) {
    return;
  }
  markShadowedGlobals(tokens, scopes, globalNameMatcher);
}

/**
 * We can do a fast up-front check to see if there are any declarations to global names. If not,
 * then there's no point in computing scope assignments.
 */
// Exported for testing.
export function hasShadowedGlobals(
  tokens: TokenProcessor,
  globalNames: Array<string>,
): boolean {
  return hasShadowedGlobalsWithMatcher(tokens, getGlobalNameMatcher(globalNames));
}

function hasShadowedGlobalsWithMatcher(
  tokens: TokenProcessor,
  globalNameMatcher: NameMatcher,
): boolean {
  const tokenList = tokens.tokens;
  const code = tokens.code;
  for (let i = 0; i < tokenList.length; i++) {
    const token = tokenList[i];
    if (
      token.type === tt.name &&
      !token.isType &&
      isNonTopLevelDeclaration(token) &&
      matchName(code, token.start, token.end, globalNameMatcher) !== null
    ) {
      return true;
    }
  }
  return false;
}

function markShadowedGlobals(
  tokens: TokenProcessor,
  scopes: Array<Scope>,
  globalNameMatcher: NameMatcher,
): void {
  const tokenList = tokens.tokens;
  const code = tokens.code;
  const scopeStack: Array<Scope> = [];
  const markedNames: Array<string> = [];
  const markedScopes: Array<Scope> = [];
  let scopeIndex = scopes.length - 1;
  // Scopes were generated at completion time, so they're sorted by end index, so we can maintain a
  // good stack by going backwards through them.
  for (let i = tokenList.length - 1; ; i--) {
    while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].startTokenIndex === i + 1) {
      scopeStack.length--;
    }
    while (scopeIndex >= 0 && scopes[scopeIndex].endTokenIndex === i + 1) {
      scopeStack[scopeStack.length] = scopes[scopeIndex];
      scopeIndex--;
    }
    // Process scopes after the last iteration so we can make sure we pop all of them.
    if (i < 0) {
      break;
    }

    const token = tokenList[i];
    if (scopeStack.length > 1 && !token.isType && token.type === tt.name) {
      const name = matchName(code, token.start, token.end, globalNameMatcher);
      if (name === null) {
        continue;
      }
      if (isBlockScopedDeclaration(token)) {
        markShadowedForScope(
          scopeStack[scopeStack.length - 1],
          tokens,
          tokenList,
          name,
          markedNames,
          markedScopes,
        );
      } else if (isFunctionScopedDeclaration(token)) {
        let stackIndex = scopeStack.length - 1;
        while (stackIndex > 0 && !scopeStack[stackIndex].isFunctionScope) {
          stackIndex--;
        }
        if (stackIndex < 0) {
          throw new Error("Did not find parent function scope.");
        }
        markShadowedForScope(
          scopeStack[stackIndex],
          tokens,
          tokenList,
          name,
          markedNames,
          markedScopes,
        );
      }
    }
  }
  if (scopeStack.length > 0) {
    throw new Error("Expected empty scope stack after processing file.");
  }
}

function markShadowedForScope(
  scope: Scope,
  tokens: TokenProcessor,
  tokenList: TokenProcessor["tokens"],
  name: string,
  markedNames: Array<string>,
  markedScopes: Array<Scope>,
): void {
  for (let i = 0; i < markedNames.length; i++) {
    if (markedScopes[i] === scope && markedNames[i] === name) {
      return;
    }
  }
  markedNames[markedNames.length] = name;
  markedScopes[markedScopes.length] = scope;
  const code = tokens.code;
  for (let i = scope.startTokenIndex; i < scope.endTokenIndex; i++) {
    const token = tokenList[i];
    if (
      (token.type === tt.name || token.type === tt.jsxName) &&
      tokenMatchesName(code, token.start, token.end, name)
    ) {
      token.shadowsGlobal = true;
    }
  }
}

interface NameMatcher {
  singleName: string | null;
  bucketsByLength: Array<Array<string> | undefined> | null;
}

function getGlobalNameMatcher(globalNames: Array<string>): NameMatcher {
  if (globalNames.length === 1) {
    return {singleName: globalNames[0], bucketsByLength: null};
  }
  const bucketsByLength: Array<Array<string> | undefined> = [];
  for (let i = 0; i < globalNames.length; i++) {
    const name = globalNames[i];
    const length = name.length;
    const bucket = bucketsByLength[length];
    if (bucket === undefined) {
      bucketsByLength[length] = [name];
    } else {
      bucket[bucket.length] = name;
    }
  }
  return {singleName: null, bucketsByLength};
}

function matchName(
  code: string,
  start: number,
  end: number,
  matcher: NameMatcher,
): string | null {
  const singleName = matcher.singleName;
  if (singleName !== null) {
    return tokenMatchesName(code, start, end, singleName) ? singleName : null;
  }
  const bucket = matcher.bucketsByLength![end - start];
  if (bucket === undefined) {
    return null;
  }
  const firstChar = code.charCodeAt(start);
  for (let i = 0; i < bucket.length; i++) {
    const name = bucket[i];
    if (name.charCodeAt(0) !== firstChar) {
      continue;
    }
    if (tokenMatchesName(code, start, end, name)) {
      return name;
    }
  }
  return null;
}

function tokenMatchesName(code: string, start: number, end: number, name: string): boolean {
  if (end - start !== name.length) {
    return false;
  }
  for (let i = 0; i < name.length; i++) {
    if (code.charCodeAt(start + i) !== name.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
