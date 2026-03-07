import type {Token} from "../parser/tokenizer";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import isIdentifier from "../util/isIdentifier";
import type RootTransformer from "./RootTransformer";
import Transformer from "./Transformer";

export default class TypeScriptTransformer extends Transformer {
  constructor(
    readonly rootTransformer: RootTransformer,
    readonly tokens: TokenProcessor,
    readonly isImportsTransformEnabled: boolean,
  ) {
    super();
  }

  process(): boolean {
    if (
      this.tokens.matches2(tt._export, tt.name) &&
      this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._interface)
    ) {
      return this.processExportInterface();
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

  processExportInterface(): boolean {
    const interfaceName = this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + 2);
    this.tokens.replaceToken("export const");
    this.tokens.removeToken();
    this.tokens.removeToken();
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
    this.tokens.appendCode(` ${interfaceName} = undefined;`);
    return true;
  }

  processExportType(): boolean {
    const thirdToken = this.tokens.tokenAtRelativeIndex(2);
    const isBraceL = thirdToken.type === tt.braceL;
    const typeName = isBraceL ? null : this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + 2);
    this.tokens.replaceToken("export const");
    this.tokens.removeToken();
    if (this.tokens.matches1(tt.braceL)) {
      const typeNames: string[] = [];
      this.tokens.removeToken();
      while (!this.tokens.matches1(tt.braceR)) {
        if (this.tokens.matches1(tt.name)) {
          typeNames.push(this.tokens.identifierName());
        }
        this.tokens.removeToken();
      }
      this.tokens.removeToken();
      if (this.tokens.matchesContextual(ContextualKeyword._from)) {
        this.tokens.removeToken();
        this.tokens.removeToken();
      }
      if (this.tokens.matches1(tt.semi)) {
        this.tokens.removeToken();
      }
      if (typeNames.length > 0) {
        this.tokens.appendCode(` ${typeNames[0]} = undefined;`);
        for (let i = 1; i < typeNames.length; i++) {
          this.tokens.appendCode(`export const ${typeNames[i]} = undefined;`);
        }
      }
    } else if (this.tokens.matches1(tt.name)) {
      this.tokens.removeToken();
      while (!this.tokens.matches1(tt.semi) && !this.tokens.isAtEnd()) {
        this.tokens.removeToken();
      }
      if (this.tokens.matches1(tt.semi)) {
        this.tokens.removeToken();
      }
      this.tokens.appendCode(` ${typeName} = undefined;`);
    } else if (this.tokens.matches1(tt.star)) {
      this.tokens.replaceTokenTrimmingLeftWhitespace("");
      while (!this.tokens.matches1(tt.string) && !this.tokens.isAtEnd()) {
        this.tokens.removeToken();
      }
      if (this.tokens.matches1(tt.string)) {
        this.tokens.removeToken();
      }
      if (this.tokens.matches1(tt.semi)) {
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
