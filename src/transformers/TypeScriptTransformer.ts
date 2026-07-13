import type {Token} from "../parser/tokenizer";
import type {Options} from "../index";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import getDeclarationInfo, {hasDeclarationName, type DeclarationInfo} from "../util/getDeclarationInfo";
import {
  type ImportExportSpecifierInfo,
  readImportExportSpecifierInfo,
} from "../util/getImportExportSpecifierInfo";
import isIdentifier from "../util/isIdentifier";
import {removeMaybeImportAttributes} from "../util/removeMaybeImportAttributes";
import type RootTransformer from "./RootTransformer";
import Transformer from "./Transformer";

/** Local const for enum members; null when unused or would shadow the IIFE param. */
function enumLocalBinding(enumName: string, variableName: string | null): string | null {
  if (variableName == null || variableName === enumName) return null;
  return variableName;
}

export default class TypeScriptTransformer extends Transformer {
  private declarationInfo: DeclarationInfo | null = null;
  private simpleEnumCode = "";
  private simpleEnumEndIndex = 0;

  constructor(
    readonly rootTransformer: RootTransformer,
    readonly tokens: TokenProcessor,
    readonly isImportsTransformEnabled: boolean,
    readonly options: Options,
  ) {
    super();
  }

  /** Only emit a placeholder if no runtime value with this name already exists. */
  private appendPlaceholder(name: string): void {
    if (!hasDeclarationName(this.getDeclarationInfo().valueDeclarations, name)) {
      this.tokens.appendCode(`export const ${name} = undefined;`);
    }
  }

  private getDeclarationInfo(): DeclarationInfo {
    if (this.declarationInfo === null) {
      this.declarationInfo = getDeclarationInfo(this.tokens);
    }
    return this.declarationInfo;
  }

  process(): boolean {
    const tokenIndex = this.tokens.currentIndex();
    const tokenList = this.tokens.tokens;
    const token = tokenList[tokenIndex];
    const nextToken = tokenList[tokenIndex + 1];
    const thirdToken = tokenList[tokenIndex + 2];
    const tokenType = token.type;
    const nextTokenType = nextToken?.type;
    const thirdTokenType = thirdToken?.type;

    if (tokenType === tt._export && nextTokenType === tt.eq) {
      this.processExportEquals();
      return true;
    }

    // `export interface Foo` or `export declare interface Foo`
    if (
      tokenType === tt._export &&
      nextTokenType === tt.name &&
      nextToken.contextualKeyword === ContextualKeyword._interface
    ) {
      return this.processExportInterface();
    }
    if (
      tokenType === tt._export &&
      nextTokenType === tt._declare &&
      thirdTokenType === tt.name &&
      thirdToken.contextualKeyword === ContextualKeyword._interface
    ) {
      return this.processExportInterface(/* hasDeclare */ true);
    }
    // `export type Foo = ...` or `export declare type Foo = ...`
    if (
      tokenType === tt._export &&
      nextTokenType === tt.name &&
      nextToken.contextualKeyword === ContextualKeyword._type
    ) {
      return this.processExportType();
    }
    if (
      tokenType === tt._export &&
      nextTokenType === tt._declare &&
      thirdTokenType === tt.name &&
      thirdToken.contextualKeyword === ContextualKeyword._type
    ) {
      return this.processExportType(/* hasDeclare */ true);
    }
    if (tokenType === tt.name && token.contextualKeyword === ContextualKeyword._interface) {
      return this.processInterface();
    }
    if (
      (tokenType === tt.parenR && this.rootTransformer.processPossibleArrowParamEnd()) ||
      ((tokenType === tt._async ||
        (tokenType === tt.name && token.contextualKeyword === ContextualKeyword._async)) &&
        this.rootTransformer.processPossibleAsyncArrowWithTypeParams()) ||
      (token.isType && this.rootTransformer.processPossibleTypeRange())
    ) {
      return true;
    }
    switch (tokenType) {
      case tt._public:
      case tt._protected:
      case tt._private:
      case tt._abstract:
      case tt._readonly:
      case tt._override:
      case tt.nonNullAssertion:
        this.tokens.removeInitialToken();
        return true;
    }
    if (tokenType === tt._enum || (tokenType === tt._const && nextTokenType === tt._enum)) {
      this.processEnum();
      return true;
    }
    if (
      tokenType === tt._export &&
      (nextTokenType === tt._enum || (nextTokenType === tt._const && thirdTokenType === tt._enum))
    ) {
      this.processEnum(true);
      return true;
    }
    return false;
  }

  processExportEquals(): void {
    this.tokens.replaceToken("module.exports");
    this.tokens.copyExpectedToken(tt.eq);
  }

  processInterface(): boolean {
    const tokenList = this.tokens.tokens;
    this.tokens.removeInitialToken();
    while (tokenList[this.tokens.currentIndex()].type !== tt.braceL) {
      this.tokens.removeToken();
    }
    let braceDepth = 0;
    while (true) {
      const tokenType = tokenList[this.tokens.currentIndex()].type;
      if (tokenType === tt.braceL) {
        braceDepth++;
        this.tokens.removeToken();
      } else if (tokenType === tt.braceR) {
        braceDepth--;
        this.tokens.removeToken();
        if (braceDepth === 0) {
          break;
        }
      } else {
        this.tokens.removeToken();
      }
    }
    return true;
  }

  processExportInterface(hasDeclare: boolean = false): boolean {
    // Offset: `export [declare] interface Name`
    // hasDeclare=false: offsets 0=export, 1=interface, 2=Name
    // hasDeclare=true:  offsets 0=export, 1=declare,   2=interface, 3=Name
    const nameOffset = hasDeclare ? 3 : 2;
    const tokenList = this.tokens.tokens;
    const nameToken = tokenList[this.tokens.currentIndex() + nameOffset];
    if (!nameToken || nameToken.type !== tt.name) {
      // Malformed - just erase
      this.tokens.removeInitialToken();
      while (!this.tokens.isAtEnd()) {
        this.tokens.removeToken();
      }
      return true;
    }
    const interfaceName = this.tokens.identifierNameForToken(nameToken);
    // Remove: export, [declare,] interface, Name, optional generics/extends clause
    this.tokens.removeInitialToken(); // export
    if (hasDeclare) this.tokens.removeToken(); // declare
    this.tokens.removeToken();        // interface
    this.tokens.removeToken();        // Name
    while (!this.tokens.isAtEnd() && tokenList[this.tokens.currentIndex()].type !== tt.braceL) {
      this.tokens.removeToken();      // generics, extends, etc.
    }
    // Remove the body braces
    let braceDepth = 0;
    while (!this.tokens.isAtEnd()) {
      const tokenType = tokenList[this.tokens.currentIndex()].type;
      if (tokenType === tt.braceL) {
        braceDepth++;
        this.tokens.removeToken();
      } else if (tokenType === tt.braceR) {
        braceDepth--;
        this.tokens.removeToken();
        if (braceDepth === 0) break;
      } else {
        this.tokens.removeToken();
      }
    }
    // Emit placeholder so the name is a real export binding at runtime
    this.appendPlaceholder(interfaceName);
    return true;
  }

  processExportType(hasDeclare: boolean = false): boolean {
    // Offset: `export [declare] type <thirdToken>`
    const thirdTokenOffset = hasDeclare ? 3 : 2;
    const tokenList = this.tokens.tokens;
    const thirdToken = tokenList[this.tokens.currentIndex() + thirdTokenOffset];
    if (!thirdToken) {
      this.tokens.removeInitialToken();
      while (!this.tokens.isAtEnd()) this.tokens.removeToken();
      return true;
    }
    const isBraceL = thirdToken.type === tt.braceL;
    // Only extract typeName when the third token is an actual identifier (not `*`, `=`, etc.)
    const typeName = (!isBraceL && thirdToken.type === tt.name)
      ? this.tokens.identifierNameForToken(thirdToken)
      : null;

    if (isBraceL) {
      // `export [declare] type { ... } [from '...']` - re-export or local type group
      const isReExport = this.isExportTypeReExport(thirdTokenOffset);
      let placeholderCode = "";
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken();        // type
      this.tokens.removeToken();        // {
      const specifierInfo = makeSpecifierInfo();
      while (!this.tokens.isAtEnd() && tokenList[this.tokens.currentIndex()].type !== tt.braceR) {
        readImportExportSpecifierInfo(this.tokens, specifierInfo);
        if (!isReExport &&
            !specifierInfo.isType &&
            specifierInfo.rightName &&
            !hasDeclarationName(this.getDeclarationInfo().valueDeclarations, specifierInfo.rightName)) {
          placeholderCode += `export const ${specifierInfo.rightName} = undefined;`;
        }
        while (this.tokens.currentIndex() < specifierInfo.endIndex) {
          this.tokens.removeToken();
        }
        if (tokenList[this.tokens.currentIndex()].type === tt.comma) this.tokens.removeToken();
      }
      if (!this.tokens.isAtEnd()) this.tokens.removeToken(); // }
      const token = tokenList[this.tokens.currentIndex()];
      const hasFrom = token.type === tt.name && token.contextualKeyword === ContextualKeyword._from;
      if (hasFrom) {
        this.tokens.removeToken(); // from
        this.tokens.removeToken(); // 'module'
        if (!this.options.preserveImportAttributes) {
          removeMaybeImportAttributes(this.tokens);
        }
      }
      if (tokenList[this.tokens.currentIndex()].type === tt.semi) this.tokens.removeToken();
      if (placeholderCode) {
        this.tokens.appendCode(placeholderCode);
      }
    } else if (typeName) {
      // `export [declare] type Foo = <type-expr>;`
      // Use brace-depth tracking so `{ a: string; b: number }` doesn't prematurely stop.
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken(); // type
      this.tokens.removeToken(); // Foo (name)
      // Remove everything up to and including the terminating semicolon,
      // tracking brace/bracket/paren depth so inner `;` are not mistaken for the end.
      let depth = 0;
      const tokenList = this.tokens.tokens;
      while (!this.tokens.isAtEnd()) {
        // Track all bracket-like pairs that can contain semicolons.
        // `<>` for generics is intentionally excluded: no bare `;` inside `<>` in types
        // that isn't already wrapped in `{}`. dollarBraceL (${ in template literal types)
        // must be tracked because its closing `}` is tt.braceR.
        const token = tokenList[this.tokens.currentIndex()];
        const tokenType = token.type;
        if (tokenType === tt.braceL || tokenType === tt.dollarBraceL ||
            tokenType === tt.parenL || tokenType === tt.bracketL) {
          depth++;
        } else if (tokenType === tt.braceR || tokenType === tt.parenR ||
                   tokenType === tt.bracketR) {
          depth--;
        } else if (depth === 0 && !token.isType) {
          if (tokenType === tt.semi) this.tokens.removeToken();
          break;
        }
        this.tokens.removeToken();
      }
      this.appendPlaceholder(typeName);
    } else {
      // `export [declare] type * [as Foo] from '...'` or other unrecognized form - just erase
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken(); // type
      let depth = 0;
      const tokenList = this.tokens.tokens;
      while (!this.tokens.isAtEnd()) {
        const token = tokenList[this.tokens.currentIndex()];
        const tokenType = token.type;
        if (tokenType === tt.braceL || tokenType === tt.dollarBraceL) depth++;
        else if (tokenType === tt.braceR) { if (depth === 0) break; depth--; }
        else if (depth === 0 && !token.isType) {
          if (tokenType === tt.semi) this.tokens.removeToken();
          break;
        }
        this.tokens.removeToken();
      }
    }
    return true;
  }

  private isExportTypeReExport(braceTokenOffset: number): boolean {
    const tokens = this.tokens.tokens;
    let index = this.tokens.currentIndex() + braceTokenOffset + 1;
    while (index < tokens.length && tokens[index].type !== tt.braceR) {
      index++;
    }
    return index + 1 < tokens.length &&
      tokens[index + 1].type === tt.name &&
      tokens[index + 1].contextualKeyword === ContextualKeyword._from;
  }

  processEnum(isExport: boolean = false): void {
    if (this.tryProcessSimpleEnum(isExport)) {
      return;
    }
    this.tokens.removeInitialToken();
    const tokenList = this.tokens.tokens;
    while (true) {
      const tokenType = tokenList[this.tokens.currentIndex()].type;
      if (tokenType !== tt._const && tokenType !== tt._enum) {
        break;
      }
      this.tokens.removeToken();
    }
    const enumName = this.tokens.identifierNameForToken(tokenList[this.tokens.currentIndex()]);
    this.tokens.removeToken();
    if (isExport && !this.isImportsTransformEnabled) {
      this.tokens.appendCode("export ");
    }
    this.tokens.appendCode(`var ${enumName}; (function (${enumName})`);
    this.tokens.copyExpectedToken(tt.braceL);
    this.processEnumBody(enumName);
    this.tokens.copyExpectedToken(tt.braceR);
    if (isExport && this.isImportsTransformEnabled) {
      this.tokens.appendCode(`)(${enumName} || (exports.${enumName} = ${enumName} = {}));`);
    } else {
      this.tokens.appendCode(`)(${enumName} || (${enumName} = {}));`);
    }
  }

  processEnumBody(enumName: string): void {
    let previousValueCode = null;
    const keyInfo = makeEnumKeyInfo();
    const tokenList = this.tokens.tokens;
    while (true) {
      if (tokenList[this.tokens.currentIndex()].type === tt.braceR) {
        break;
      }
      this.extractEnumKeyInfo(tokenList[this.tokens.currentIndex()], keyInfo);
      this.tokens.removeInitialToken();

      const tokenIndex = this.tokens.currentIndex();
      const tokenType = tokenList[tokenIndex].type;
      if (
        tokenType === tt.eq &&
        tokenList[tokenIndex + 1].type === tt.string &&
        (tokenList[tokenIndex + 2].type === tt.comma || tokenList[tokenIndex + 2].type === tt.braceR)
      ) {
        this.processStringLiteralEnumMember(enumName, keyInfo.nameStringCode, keyInfo.variableName);
      } else if (tokenType === tt.eq) {
        this.processExplicitValueEnumMember(enumName, keyInfo.nameStringCode, keyInfo.variableName);
      } else {
        this.processImplicitValueEnumMember(
          enumName,
          keyInfo.nameStringCode,
          keyInfo.variableName,
          previousValueCode,
        );
      }
      if (tokenList[this.tokens.currentIndex()].type === tt.comma) {
        this.tokens.removeToken();
      }

      // Prefer the local const name only when it was actually emitted (not
      // suppressed for shadowing the enum IIFE parameter — QuickJS rejects that).
      if (keyInfo.variableName != null && keyInfo.variableName !== enumName) {
        previousValueCode = keyInfo.variableName;
      } else {
        previousValueCode = `${enumName}[${keyInfo.nameStringCode}]`;
      }
    }
  }

  extractEnumKeyInfo(nameToken: Token, result: EnumKeyInfo): void {
    if (nameToken.type === tt.name) {
      const name = this.tokens.identifierNameForToken(nameToken);
      result.nameStringCode = `"${name}"`;
      result.variableName = isIdentifier(name) ? name : null;
    } else if (nameToken.type === tt.string) {
      const name = this.tokens.stringValueForToken(nameToken);
      result.nameStringCode = this.tokens.code.slice(nameToken.start, nameToken.end);
      result.variableName = isIdentifier(name) ? name : null;
    } else {
      throw new Error("Expected name or string at beginning of enum element.");
    }
  }

  processStringLiteralEnumMember(
    enumName: string,
    nameStringCode: string,
    variableName: string | null,
  ): void {
    // Local const must not shadow the enum IIFE param (QuickJS rejects it).
    const local = enumLocalBinding(enumName, variableName);
    if (local != null) {
      this.tokens.appendCode(`const ${local}`);
      this.tokens.copyToken();
      this.tokens.copyToken();
      this.tokens.appendCode(`; ${enumName}[${nameStringCode}] = ${local};`);
    } else {
      this.tokens.appendCode(`${enumName}[${nameStringCode}]`);
      this.tokens.copyToken();
      this.tokens.copyToken();
      this.tokens.appendCode(";");
    }
  }

  processExplicitValueEnumMember(
    enumName: string,
    nameStringCode: string,
    variableName: string | null,
  ): void {
    const rhsEndIndex = this.tokens.tokens[this.tokens.currentIndex()].rhsEndIndex!;
    if (rhsEndIndex == null) {
      throw new Error("Expected rhsEndIndex on enum assign.");
    }

    const local = enumLocalBinding(enumName, variableName);
    if (local != null) {
      this.tokens.appendCode(`const ${local}`);
      this.tokens.copyToken();
      while (this.tokens.currentIndex() < rhsEndIndex) {
        this.rootTransformer.processToken();
      }
      this.tokens.appendCode(
        `; ${enumName}[${enumName}[${nameStringCode}] = ${local}] = ${nameStringCode};`,
      );
    } else {
      this.tokens.appendCode(`${enumName}[${enumName}[${nameStringCode}]`);
      this.tokens.copyToken();
      while (this.tokens.currentIndex() < rhsEndIndex) {
        this.rootTransformer.processToken();
      }
      this.tokens.appendCode(`] = ${nameStringCode};`);
    }
  }

  processImplicitValueEnumMember(
    enumName: string,
    nameStringCode: string,
    variableName: string | null,
    previousValueCode: string | null,
  ): void {
    let valueCode = previousValueCode != null ? `${previousValueCode} + 1` : "0";
    const local = enumLocalBinding(enumName, variableName);
    if (local != null) {
      this.tokens.appendCode(`const ${local} = ${valueCode}; `);
      valueCode = local;
    }
    this.tokens.appendCode(
      `${enumName}[${enumName}[${nameStringCode}] = ${valueCode}] = ${nameStringCode};`,
    );
  }

  private tryProcessSimpleEnum(isExport: boolean): boolean {
    if (isExport) {
      return false;
    }
    const tokenList = this.tokens.tokens;
    let enumTokenIndex = this.tokens.currentIndex();
    if (tokenList[enumTokenIndex].type === tt._const) {
      enumTokenIndex++;
    }
    if (tokenList[enumTokenIndex].type !== tt._enum) {
      return false;
    }
    const nameIndex = enumTokenIndex + 1;
    const braceIndex = nameIndex + 1;
    if (tokenList[nameIndex].type !== tt.name ||
        tokenList[braceIndex].type !== tt.braceL) {
      return false;
    }
    const enumName = this.tokens.identifierNameForToken(tokenList[nameIndex]);
    if (!this.readSimpleEnumEntries(braceIndex + 1, enumName)) {
      return false;
    }
    this.tokens.replaceToken(`var ${enumName} = ${enumName} || {};`);
    while (this.tokens.currentIndex() < this.simpleEnumEndIndex) {
      this.tokens.removeToken();
    }
    if (this.simpleEnumCode) {
      this.tokens.appendCode(` ${this.simpleEnumCode}`);
    }
    return true;
  }

  private readSimpleEnumEntries(startIndex: number, enumName: string): boolean {
    let code = "";
    let index = startIndex;
    let nextNumericValue: number | null = 0;
    const tokens = this.tokens.tokens;
    let value: SimpleEnumValueResult | null = null;
    while (true) {
      const token = tokens[index];
      if (!token) {
        return false;
      }
      if (token.type === tt.braceR) {
        this.simpleEnumCode = code;
        this.simpleEnumEndIndex = index + 1;
        return true;
      }
      if (token.type === tt.comma) {
        index++;
        continue;
      }
      let nameStringCode: string;
      if (token.type === tt.name) {
        nameStringCode = `"${this.tokens.identifierNameForToken(token)}"`;
      } else if (token.type === tt.string) {
        nameStringCode = this.tokens.rawCodeForToken(token);
      } else {
        return false;
      }
      index++;

      let valueCode: string;
      let numericValue: number | null;
      if (tokens[index].type === tt.eq) {
        const rhsEndIndex = tokens[index].rhsEndIndex;
        if (rhsEndIndex == null) {
          return false;
        }
        value ??= makeSimpleEnumValueResult();
        if (!this.readSimpleEnumValue(index + 1, rhsEndIndex, value)) {
          return false;
        }
        valueCode = value.code;
        numericValue = value.numericValue;
        index = rhsEndIndex;
      } else {
        if (nextNumericValue == null) {
          return false;
        }
        valueCode = String(nextNumericValue);
        numericValue = nextNumericValue;
      }

      if (code) {
        code += " ";
      }
      code += `${enumName}[${nameStringCode}] = ${valueCode};`;
      if (numericValue == null) {
        nextNumericValue = null;
      } else {
        code += ` ${enumName}[${valueCode}] = ${nameStringCode};`;
        nextNumericValue = numericValue + 1;
      }
    }
  }

  private readSimpleEnumValue(
    startIndex: number,
    endIndex: number,
    result: SimpleEnumValueResult,
  ): boolean {
    const tokens = this.tokens.tokens;
    if (endIndex === startIndex + 1) {
      const token = tokens[startIndex];
      if (token.type === tt.string) {
        result.code = this.tokens.rawCodeForToken(token);
        result.numericValue = null;
        return true;
      }
      if (token.type === tt.num) {
        const code = this.tokens.rawCodeForToken(token);
        const numericValue = this.parseSimpleEnumNumber(code);
        if (Number.isFinite(numericValue)) {
          result.code = code;
          result.numericValue = numericValue;
          return true;
        }
      }
    }
    if (endIndex === startIndex + 2 &&
        tokens[startIndex].type === tt.minus &&
        tokens[startIndex + 1].type === tt.num) {
      const code = `-${this.tokens.rawCodeForToken(tokens[startIndex + 1])}`;
      const numericValue = this.parseSimpleEnumNumber(code);
      if (Number.isFinite(numericValue)) {
        result.code = code;
        result.numericValue = numericValue;
        return true;
      }
    }
    return false;
  }

  private parseSimpleEnumNumber(code: string): number {
    const underscoreIndex = code.indexOf("_");
    if (underscoreIndex === -1) {
      return Number(code);
    }
    let cleaned = code.slice(0, underscoreIndex);
    for (let i = underscoreIndex + 1; i < code.length; i++) {
      const charCode = code.charCodeAt(i);
      if (charCode !== 95) {
        cleaned += code[i];
      }
    }
    return Number(cleaned);
  }
}

function makeSpecifierInfo(): ImportExportSpecifierInfo {
  return {isType: false, leftName: null, rightName: null, endIndex: 0};
}

interface EnumKeyInfo {
  nameStringCode: string;
  variableName: string | null;
}

function makeEnumKeyInfo(): EnumKeyInfo {
  return {nameStringCode: "", variableName: null};
}

interface SimpleEnumValueResult {
  code: string;
  numericValue: number | null;
}

function makeSimpleEnumValueResult(): SimpleEnumValueResult {
  return {code: "", numericValue: null};
}
