import type {Token} from "../parser/tokenizer";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import getDeclarationInfo, {type DeclarationInfo} from "../util/getDeclarationInfo";
import getImportExportSpecifierInfo from "../util/getImportExportSpecifierInfo";
import isIdentifier from "../util/isIdentifier";
import {removeMaybeImportAttributes} from "../util/removeMaybeImportAttributes";
import type RootTransformer from "./RootTransformer";
import Transformer from "./Transformer";

export default class TypeScriptTransformer extends Transformer {
  private declarationInfo: DeclarationInfo;

  constructor(
    readonly rootTransformer: RootTransformer,
    readonly tokens: TokenProcessor,
    readonly isImportsTransformEnabled: boolean,
  ) {
    super();
    this.declarationInfo = getDeclarationInfo(tokens);
  }

  /** Only emit a placeholder if no runtime value with this name already exists. */
  private appendPlaceholder(name: string): void {
    if (!this.declarationInfo.valueDeclarations.has(name)) {
      this.tokens.appendCode(`export const ${name} = undefined;`);
    }
  }

  process(): boolean {
    // `export interface Foo` or `export declare interface Foo`
    if (this.tokens.matches2(tt._export, tt.name) &&
        this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._interface)) {
      return this.processExportInterface();
    }
    if (this.tokens.matches3(tt._export, tt._declare, tt.name) &&
        this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 2, ContextualKeyword._interface)) {
      return this.processExportInterface(/* hasDeclare */ true);
    }
    // `export type Foo = ...` or `export declare type Foo = ...`
    if (this.tokens.matches2(tt._export, tt.name) &&
        this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._type)) {
      return this.processExportType();
    }
    if (this.tokens.matches3(tt._export, tt._declare, tt.name) &&
        this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 2, ContextualKeyword._type)) {
      return this.processExportType(/* hasDeclare */ true);
    }
    if (this.tokens.matchesContextual(ContextualKeyword._interface)) {
      return this.processInterface();
    }
    if (
      this.rootTransformer.processPossibleArrowParamEnd() ||
      this.rootTransformer.processPossibleAsyncArrowWithTypeParams() ||
      this.rootTransformer.processPossibleTypeRange()
    ) {
      return true;
    }
    if (
      this.tokens.matches1(tt._public) ||
      this.tokens.matches1(tt._protected) ||
      this.tokens.matches1(tt._private) ||
      this.tokens.matches1(tt._abstract) ||
      this.tokens.matches1(tt._readonly) ||
      this.tokens.matches1(tt._override) ||
      this.tokens.matches1(tt.nonNullAssertion)
    ) {
      this.tokens.removeInitialToken();
      return true;
    }
    if (this.tokens.matches1(tt._enum) || this.tokens.matches2(tt._const, tt._enum)) {
      this.processEnum();
      return true;
    }
    if (
      this.tokens.matches2(tt._export, tt._enum) ||
      this.tokens.matches3(tt._export, tt._const, tt._enum)
    ) {
      this.processEnum(true);
      return true;
    }
    return false;
  }

  processInterface(): boolean {
    this.tokens.removeInitialToken();
    while (!this.tokens.matches1(tt.braceL)) {
      this.tokens.removeToken();
    }
    let braceDepth = 0;
    while (true) {
      if (this.tokens.matches1(tt.braceL)) {
        braceDepth++;
        this.tokens.removeToken();
      } else if (this.tokens.matches1(tt.braceR)) {
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
    const nameToken = this.tokens.tokenAtRelativeIndex(nameOffset);
    if (!nameToken || nameToken.type !== tt.name) {
      // Malformed - just erase
      this.tokens.removeInitialToken();
      while (!this.tokens.isAtEnd()) {
        this.tokens.removeToken();
      }
      return true;
    }
    const interfaceName = this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + nameOffset);
    // Remove: export, [declare,] interface, Name, optional generics/extends clause
    this.tokens.removeInitialToken(); // export
    if (hasDeclare) this.tokens.removeToken(); // declare
    this.tokens.removeToken();        // interface
    this.tokens.removeToken();        // Name
    while (!this.tokens.isAtEnd() && !this.tokens.matches1(tt.braceL)) {
      this.tokens.removeToken();      // generics, extends, etc.
    }
    // Remove the body braces
    let braceDepth = 0;
    while (!this.tokens.isAtEnd()) {
      if (this.tokens.matches1(tt.braceL)) {
        braceDepth++;
        this.tokens.removeToken();
      } else if (this.tokens.matches1(tt.braceR)) {
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
    const typeKeywordOffset = hasDeclare ? 2 : 1;
    const thirdTokenOffset = hasDeclare ? 3 : 2;
    const thirdToken = this.tokens.tokenAtRelativeIndex(thirdTokenOffset);
    if (!thirdToken) {
      this.tokens.removeInitialToken();
      while (!this.tokens.isAtEnd()) this.tokens.removeToken();
      return true;
    }
    const isBraceL = thirdToken.type === tt.braceL;
    // Only extract typeName when the third token is an actual identifier (not `*`, `=`, etc.)
    const typeName = (!isBraceL && thirdToken.type === tt.name)
      ? this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + thirdTokenOffset)
      : null;

    if (isBraceL) {
      // `export [declare] type { ... } [from '...']` - re-export or local type group
      const typeNames: string[] = [];
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken();        // type
      this.tokens.removeToken();        // {
      while (!this.tokens.isAtEnd() && !this.tokens.matches1(tt.braceR)) {
        const specifierInfo = getImportExportSpecifierInfo(this.tokens);
        if (!specifierInfo.isType && specifierInfo.rightName) {
          typeNames.push(specifierInfo.rightName);
        }
        while (this.tokens.currentIndex() < specifierInfo.endIndex) {
          this.tokens.removeToken();
        }
        if (this.tokens.matches1(tt.comma)) this.tokens.removeToken();
      }
      if (!this.tokens.isAtEnd()) this.tokens.removeToken(); // }
      const hasFrom = this.tokens.matchesContextual(ContextualKeyword._from);
      if (hasFrom) {
        this.tokens.removeToken(); // from
        this.tokens.removeToken(); // 'module'
        removeMaybeImportAttributes(this.tokens);
      }
      if (this.tokens.matches1(tt.semi)) this.tokens.removeToken();
      if (!hasFrom && typeNames.length > 0) {
        for (const name of typeNames) {
          this.appendPlaceholder(name);
        }
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
      while (!this.tokens.isAtEnd()) {
        // Track all bracket-like pairs that can contain semicolons.
        // `<>` for generics is intentionally excluded: no bare `;` inside `<>` in types
        // that isn't already wrapped in `{}`. dollarBraceL (${ in template literal types)
        // must be tracked because its closing `}` is tt.braceR.
        if (this.tokens.matches1(tt.braceL) || this.tokens.matches1(tt.dollarBraceL) ||
            this.tokens.matches1(tt.parenL) || this.tokens.matches1(tt.bracketL)) {
          depth++;
        } else if (this.tokens.matches1(tt.braceR) || this.tokens.matches1(tt.parenR) ||
                   this.tokens.matches1(tt.bracketR)) {
          depth--;
        } else if (depth === 0 && !this.tokens.currentToken().isType) {
          if (this.tokens.matches1(tt.semi)) this.tokens.removeToken();
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
      while (!this.tokens.isAtEnd()) {
        if (this.tokens.matches1(tt.braceL) || this.tokens.matches1(tt.dollarBraceL)) depth++;
        else if (this.tokens.matches1(tt.braceR)) { if (depth === 0) break; depth--; }
        else if (depth === 0 && !this.tokens.currentToken().isType) {
          if (this.tokens.matches1(tt.semi)) this.tokens.removeToken();
          break;
        }
        this.tokens.removeToken();
      }
    }
    return true;
  }

  processEnum(isExport: boolean = false): void {
    this.tokens.removeInitialToken();
    while (this.tokens.matches1(tt._const) || this.tokens.matches1(tt._enum)) {
      this.tokens.removeToken();
    }
    const enumName = this.tokens.identifierName();
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
    while (true) {
      if (this.tokens.matches1(tt.braceR)) {
        break;
      }
      const {nameStringCode, variableName} = this.extractEnumKeyInfo(this.tokens.currentToken());
      this.tokens.removeInitialToken();

      if (
        this.tokens.matches3(tt.eq, tt.string, tt.comma) ||
        this.tokens.matches3(tt.eq, tt.string, tt.braceR)
      ) {
        this.processStringLiteralEnumMember(enumName, nameStringCode, variableName);
      } else if (this.tokens.matches1(tt.eq)) {
        this.processExplicitValueEnumMember(enumName, nameStringCode, variableName);
      } else {
        this.processImplicitValueEnumMember(
          enumName,
          nameStringCode,
          variableName,
          previousValueCode,
        );
      }
      if (this.tokens.matches1(tt.comma)) {
        this.tokens.removeToken();
      }

      if (variableName != null) {
        previousValueCode = variableName;
      } else {
        previousValueCode = `${enumName}[${nameStringCode}]`;
      }
    }
  }

  extractEnumKeyInfo(nameToken: Token): {nameStringCode: string; variableName: string | null} {
    if (nameToken.type === tt.name) {
      const name = this.tokens.identifierNameForToken(nameToken);
      return {
        nameStringCode: `"${name}"`,
        variableName: isIdentifier(name) ? name : null,
      };
    } else if (nameToken.type === tt.string) {
      const name = this.tokens.stringValueForToken(nameToken);
      return {
        nameStringCode: this.tokens.code.slice(nameToken.start, nameToken.end),
        variableName: isIdentifier(name) ? name : null,
      };
    } else {
      throw new Error("Expected name or string at beginning of enum element.");
    }
  }

  processStringLiteralEnumMember(
    enumName: string,
    nameStringCode: string,
    variableName: string | null,
  ): void {
    if (variableName != null) {
      this.tokens.appendCode(`const ${variableName}`);
      this.tokens.copyToken();
      this.tokens.copyToken();
      this.tokens.appendCode(`; ${enumName}[${nameStringCode}] = ${variableName};`);
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
    const rhsEndIndex = this.tokens.currentToken().rhsEndIndex!;
    if (rhsEndIndex == null) {
      throw new Error("Expected rhsEndIndex on enum assign.");
    }

    if (variableName != null) {
      this.tokens.appendCode(`const ${variableName}`);
      this.tokens.copyToken();
      while (this.tokens.currentIndex() < rhsEndIndex) {
        this.rootTransformer.processToken();
      }
      this.tokens.appendCode(
        `; ${enumName}[${enumName}[${nameStringCode}] = ${variableName}] = ${nameStringCode};`,
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
    if (variableName != null) {
      this.tokens.appendCode(`const ${variableName} = ${valueCode}; `);
      valueCode = variableName;
    }
    this.tokens.appendCode(
      `${enumName}[${enumName}[${nameStringCode}] = ${valueCode}] = ${nameStringCode};`,
    );
  }
}