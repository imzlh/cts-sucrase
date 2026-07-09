import type NameManager from "../NameManager";
import type {Token} from "../parser/tokenizer";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import type RootTransformer from "../transformers/RootTransformer";

export interface ClassHeaderInfo {
  isExpression: boolean;
  className: string | null;
  hasSuperclass: boolean;
}

export interface TokenRange {
  start: number;
  end: number;
}

export interface FieldInfo extends TokenRange {
  equalsIndex: number;
  initializerName: string;
}

/**
 * Information about a class returned to inform the implementation of class fields and constructor
 * initializers.
 */
export interface ClassInfo {
  headerInfo: ClassHeaderInfo;
  // Array of non-semicolon-delimited code strings to go in the constructor, after super if
  // necessary.
  constructorInitializerStatements: Array<string>;
  instanceInitializerNames: Array<string>;
  // Array of static initializer statements, with the class name omitted. For example, if we need to
  // run `C.x = 3;`, an element of this array will be `.x = 3`.
  staticInitializerNames: Array<string>;
  // Token index after which we should insert initializer statements (either the start of the
  // constructor, or after the super call), or null if there was no constructor.
  constructorInsertPos: number | null;
  fields: Array<FieldInfo>;
  rangesToRemove: Array<TokenRange>;
  // Token indices right after a no-initializer field whose `!` and/or type annotation we
  // stripped while leaving the field itself as native syntax (disableESTransforms mode).
  // processClassBody must insert an explicit `;` at each of these positions -- see the
  // comment at the push site below for why.
  typeOnlyFieldEnds: Array<number>;
}

const EMPTY_STRINGS: Array<string> = [];
const EMPTY_FIELDS: Array<FieldInfo> = [];
const EMPTY_RANGES: Array<TokenRange> = [];
const EMPTY_INDICES: Array<number> = [];

/**
 * Get information about the class fields for this class, given a token processor pointing to the
 * open-brace at the start of the class.
 */
export default function getClassInfo(
  rootTransformer: RootTransformer,
  tokens: TokenProcessor,
  nameManager: NameManager,
  disableESTransforms: boolean,
): ClassInfo {
  const savedResultCodeLength = tokens.currentResultCodeLength();
  const savedTokenIndex = tokens.currentIndex();

  const headerInfo = processClassHeader(tokens);

  let constructorInitializerStatements: Array<string> = EMPTY_STRINGS;
  const instanceInitializerNames: Array<string> = disableESTransforms ? EMPTY_STRINGS : [];
  const staticInitializerNames: Array<string> = disableESTransforms ? EMPTY_STRINGS : [];
  let constructorInsertPos = null;
  const fields: Array<FieldInfo> = disableESTransforms ? EMPTY_FIELDS : [];
  let rangesToRemove: Array<TokenRange> | null = null;
  let typeOnlyFieldEnds: Array<number> | null = null;

  const tokenList = tokens.tokens;
  const classContextId = tokenList[tokens.currentIndex()].contextId;
  if (classContextId == null) {
    throw new Error("Expected non-null class context ID on class open-brace.");
  }

  tokens.nextToken();
  while (tokenList[tokens.currentIndex()].type !== tt.braceR ||
         tokenList[tokens.currentIndex()].contextId !== classContextId) {
    const currentToken = tokenList[tokens.currentIndex()];
    if (
      currentToken.type === tt.name &&
      currentToken.contextualKeyword === ContextualKeyword._constructor &&
      !currentToken.isType
    ) {
      ({constructorInitializerStatements, constructorInsertPos} = processConstructor(tokens));
    } else if (currentToken.type === tt.semi) {
      if (!disableESTransforms) {
        const ranges = rangesToRemove ??= [];
        ranges[ranges.length] = {start: tokens.currentIndex(), end: tokens.currentIndex() + 1};
      }
      tokens.nextToken();
    } else if (currentToken.isType) {
      tokens.nextToken();
    } else {
      // Either a method or a field. Skip to the identifier part.
      const statementStartIndex = tokens.currentIndex();
      let isStatic = false;
      let isESPrivate = false;
      let isDeclareOrAbstract = false;
      let token = tokenList[tokens.currentIndex()];
      while (isAccessModifier(token)) {
        const tokenType = token.type;
        if (tokenType === tt._static) {
          isStatic = true;
        }
        if (tokenType === tt.hash) {
          isESPrivate = true;
        }
        if (tokenType === tt._declare || tokenType === tt._abstract) {
          isDeclareOrAbstract = true;
        }
        tokens.nextToken();
        token = tokenList[tokens.currentIndex()];
      }
      if (isStatic && token.type === tt.braceL) {
        // This is a static block, so don't process it in any special way.
        skipToNextClassElement(tokens, classContextId);
        continue;
      }
      if (isESPrivate) {
        // Sucrase doesn't attempt to transpile private fields; just leave them as-is.
        skipToNextClassElement(tokens, classContextId);
        continue;
      }
      if (
        token.type === tt.name &&
        token.contextualKeyword === ContextualKeyword._constructor &&
        !token.isType
      ) {
        ({constructorInitializerStatements, constructorInsertPos} = processConstructor(tokens));
        continue;
      }

      if (
        token.type === tt.name &&
        token.contextualKeyword === ContextualKeyword._accessor &&
        !token.isType
      ) {
        if (!isDeclareOrAbstract) {
          const ranges = rangesToRemove ??= [];
          ranges[ranges.length] = {start: tokens.currentIndex(), end: tokens.currentIndex() + 1};
        }
        tokens.nextToken();
      }

      const nameStartIndex = tokens.currentIndex();
      skipFieldName(tokens);
      const nameEndIndex = tokens.currentIndex();
      let tokenType = tokenList[tokens.currentIndex()].type;
      if (tokenType === tt.lessThan || tokenType === tt.parenL) {
        // This is a method, so nothing to process.
        skipToNextClassElement(tokens, classContextId);
        continue;
      }
      // `field!` definite assignment assertion - purely TS, counts as declare-like
      const hasNonNull = tokenType === tt.nonNullAssertion;
      if (hasNonNull) tokens.nextToken();
      // There might be a type annotation that we need to skip.
      while (tokenList[tokens.currentIndex()].isType) {
        tokens.nextToken();
      }
      const fieldToken = tokenList[tokens.currentIndex()];
      if (fieldToken.type === tt.eq) {
        const equalsIndex = tokens.currentIndex();
        // This is an initializer, so we need to wrap in an initializer method.
        const valueEnd = fieldToken.rhsEndIndex;
        if (valueEnd == null) {
          throw new Error("Expected rhsEndIndex on class field assignment.");
        }
        tokens.nextToken();
        if (disableESTransforms) {
          while (tokens.currentIndex() < valueEnd) {
            tokens.nextToken();
          }
          continue;
        }
        while (tokens.currentIndex() < valueEnd) {
          rootTransformer.processToken();
        }
        let initializerName;
        if (isStatic) {
          initializerName = nameManager.claimFreeName("__initStatic");
          staticInitializerNames[staticInitializerNames.length] = initializerName;
        } else {
          initializerName = nameManager.claimFreeName("__init");
          instanceInitializerNames[instanceInitializerNames.length] = initializerName;
        }
        // Fields start at the name, so `static x = 1;` has a field range of `x = 1;`.
        fields[fields.length] = {
          initializerName,
          equalsIndex,
          start: nameStartIndex,
          end: tokens.currentIndex(),
        };
      } else {
        // Plain class fields are native syntax in our runtime when ES transforms are disabled.
        if (!disableESTransforms || isDeclareOrAbstract) {
          const ranges = rangesToRemove ??= [];
          ranges[ranges.length] = {start: statementStartIndex, end: tokens.currentIndex()};
        } else if (
          (hasNonNull || tokens.currentIndex() !== nameEndIndex) &&
          fieldToken.type !== tt.semi
        ) {
          // We stripped this field's `!` and/or type annotation but left the bare name as
          // native syntax, relying on ASI to terminate it. That's unsafe when the name is
          // itself a class-element keyword like `get`/`set`/`static`/`async`/`accessor`:
          // the parser's lookahead for those isn't blocked by a line break, so e.g.
          // `get!: X` next to `post!: Y` collapses to `get\npost\nput` and gets misread as
          // `get post(...)` (a getter named "post") instead of two separate fields --
          // exactly the "invalid property name" crash this fixes. Force real termination.
          const ends = typeOnlyFieldEnds ??= [];
          ends[ends.length] = tokens.currentIndex();
        }
      }
    }
  }

  tokens.restoreToState(savedResultCodeLength, savedTokenIndex);
  if (disableESTransforms) {
    // With ES transforms disabled, preserve native class fields and only remove
    // TypeScript-only declare/abstract members.
    return {
      headerInfo,
      constructorInitializerStatements,
      instanceInitializerNames: EMPTY_STRINGS,
      staticInitializerNames: EMPTY_STRINGS,
      constructorInsertPos,
      fields: EMPTY_FIELDS,
      rangesToRemove: rangesToRemove ?? EMPTY_RANGES,
      typeOnlyFieldEnds: typeOnlyFieldEnds ?? EMPTY_INDICES,
    };
  } else {
    return {
      headerInfo,
      constructorInitializerStatements,
      instanceInitializerNames,
      staticInitializerNames,
      constructorInsertPos,
      fields,
      rangesToRemove: rangesToRemove ?? EMPTY_RANGES,
      typeOnlyFieldEnds: EMPTY_INDICES,
    };
  }
}

/**
 * Move the token processor to the next method/field in the class.
 *
 * To do that, we seek forward to the next start of a class name (either an open
 * bracket or an identifier, or the closing curly brace), then seek backward to
 * include any access modifiers.
 */
function skipToNextClassElement(tokens: TokenProcessor, classContextId: number): void {
  const tokenList = tokens.tokens;
  tokens.nextToken();
  while (tokenList[tokens.currentIndex()].contextId !== classContextId) {
    tokens.nextToken();
  }
  while (isAccessModifier(tokenList[tokens.currentIndex() - 1])) {
    tokens.previousToken();
  }
}

function processClassHeader(tokens: TokenProcessor): ClassHeaderInfo {
  const tokenList = tokens.tokens;
  const classToken = tokenList[tokens.currentIndex()];
  const contextId = classToken.contextId;
  if (contextId == null) {
    throw new Error("Expected context ID on class token.");
  }
  const isExpression = classToken.isExpression;
  if (isExpression == null) {
    throw new Error("Expected isExpression on class token.");
  }
  let className = null;
  let hasSuperclass = false;
  tokens.nextToken();
  let token = tokenList[tokens.currentIndex()];
  if (token.type === tt.name) {
    className = tokens.identifierNameForToken(token);
  }
  while (token.type !== tt.braceL || token.contextId !== contextId) {
    // If this has a superclass, there will always be an `extends` token. If it doesn't have a
    // superclass, only type parameters and `implements` clauses can show up here, all of which
    // consist only of type tokens. A declaration like `class A<B extends C> {` should *not* count
    // as having a superclass.
    if (token.type === tt._extends && !token.isType) {
      hasSuperclass = true;
    }
    tokens.nextToken();
    token = tokenList[tokens.currentIndex()];
  }
  return {isExpression, className, hasSuperclass};
}

/**
 * Extract useful information out of a constructor, starting at the "constructor" name.
 */
function processConstructor(tokens: TokenProcessor): {
  constructorInitializerStatements: Array<string>;
  constructorInsertPos: number;
} {
  let constructorInitializerStatements: Array<string> = EMPTY_STRINGS;
  const tokenList = tokens.tokens;

  tokens.nextToken();
  const constructorContextId = tokenList[tokens.currentIndex()].contextId;
  if (constructorContextId == null) {
    throw new Error("Expected context ID on open-paren starting constructor params.");
  }
  // Advance through parameters looking for access modifiers.
  while (tokenList[tokens.currentIndex()].type !== tt.parenR ||
         tokenList[tokens.currentIndex()].contextId !== constructorContextId) {
    let token = tokenList[tokens.currentIndex()];
    if (token.contextId === constructorContextId) {
      // Current token is an open paren or comma just before a param, so check
      // that param for access modifiers.
      tokens.nextToken();
      token = tokenList[tokens.currentIndex()];
      if (isAccessModifier(token)) {
        tokens.nextToken();
        token = tokenList[tokens.currentIndex()];
        while (isAccessModifier(token)) {
          tokens.nextToken();
          token = tokenList[tokens.currentIndex()];
        }
        if (token.type !== tt.name) {
          throw new Error("Expected identifier after access modifiers in constructor arg.");
        }
        const name = tokens.identifierNameForToken(token);
        if (constructorInitializerStatements === EMPTY_STRINGS) {
          constructorInitializerStatements = [];
        }
        constructorInitializerStatements[constructorInitializerStatements.length] = `this.${name} = ${name}`;
      }
    } else {
      tokens.nextToken();
    }
  }
  // )
  tokens.nextToken();
  // Constructor type annotations are invalid, but skip them anyway since
  // they're easy to skip.
  while (tokenList[tokens.currentIndex()].isType) {
    tokens.nextToken();
  }
  let constructorInsertPos = tokens.currentIndex();

  // Advance through body looking for a super call.
  let foundSuperCall = false;
  while (tokenList[tokens.currentIndex()].type !== tt.braceR ||
         tokenList[tokens.currentIndex()].contextId !== constructorContextId) {
    const tokenIndex = tokens.currentIndex();
    if (
      !foundSuperCall &&
      tokenList[tokenIndex].type === tt._super &&
      tokenList[tokenIndex + 1].type === tt.parenL
    ) {
      tokens.nextToken();
      const superCallContextId = tokenList[tokens.currentIndex()].contextId;
      if (superCallContextId == null) {
        throw new Error("Expected a context ID on the super call");
      }
      while (tokenList[tokens.currentIndex()].type !== tt.parenR ||
             tokenList[tokens.currentIndex()].contextId !== superCallContextId) {
        tokens.nextToken();
      }
      constructorInsertPos = tokens.currentIndex();
      foundSuperCall = true;
    }
    tokens.nextToken();
  }
  // }
  tokens.nextToken();

  return {constructorInitializerStatements, constructorInsertPos};
}

/**
 * Determine if this is any token that can go before the name in a method/field.
 */
function isAccessModifier(token: Token): boolean {
  switch (token.type) {
    case tt._async:
    case tt._get:
    case tt._set:
    case tt.plus:
    case tt.minus:
    case tt._readonly:
    case tt._static:
    case tt._public:
    case tt._private:
    case tt._protected:
    case tt._override:
    case tt._abstract:
    case tt.star:
    case tt._declare:
    case tt.hash:
      return true;
    default:
      return false;
  }
}

/**
 * The next token or set of tokens is either an identifier or an expression in square brackets, for
 * a method or field name.
 */
function skipFieldName(tokens: TokenProcessor): void {
  const tokenList = tokens.tokens;
  const startToken = tokenList[tokens.currentIndex()];
  if (startToken.type === tt.bracketL) {
    const classContextId = startToken.contextId;
    if (classContextId == null) {
      throw new Error("Expected class context ID on computed name open bracket.");
    }
    while (tokenList[tokens.currentIndex()].type !== tt.bracketR ||
           tokenList[tokens.currentIndex()].contextId !== classContextId) {
      tokens.nextToken();
    }
    tokens.nextToken();
  } else {
    tokens.nextToken();
  }
}
