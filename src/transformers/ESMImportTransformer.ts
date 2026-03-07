import type {HelperManager} from "../HelperManager";
import type {Options} from "../index";
import type NameManager from "../NameManager";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import elideImportEquals from "../util/elideImportEquals";
import getDeclarationInfo, {
  type DeclarationInfo,
  EMPTY_DECLARATION_INFO,
} from "../util/getDeclarationInfo";
import getImportExportSpecifierInfo from "../util/getImportExportSpecifierInfo";
import {getNonTypeIdentifiers} from "../util/getNonTypeIdentifiers";
import isExportFrom from "../util/isExportFrom";
import {removeMaybeImportAttributes} from "../util/removeMaybeImportAttributes";
import shouldElideDefaultExport from "../util/shouldElideDefaultExport";
import Transformer from "./Transformer";

export default class ESMImportTransformer extends Transformer {
  private nonTypeIdentifiers: Set<string>;
  private declarationInfo: DeclarationInfo;

  constructor(
    readonly tokens: TokenProcessor,
    readonly nameManager: NameManager,
    readonly helperManager: HelperManager,
    readonly reactHotLoaderTransformer: null,
    readonly isTypeScriptTransformEnabled: boolean,
    readonly isFlowTransformEnabled: boolean,
    readonly keepUnusedImports: boolean,
    options: Options,
  ) {
    super();
    this.nonTypeIdentifiers =
      isTypeScriptTransformEnabled && !keepUnusedImports
        ? getNonTypeIdentifiers(tokens, options)
        : new Set();
    this.declarationInfo =
      isTypeScriptTransformEnabled && !keepUnusedImports
        ? getDeclarationInfo(tokens)
        : EMPTY_DECLARATION_INFO;
  }

  process(): boolean {
    if (this.tokens.matches3(tt._import, tt.name, tt.eq)) {
      return this.processImportEquals();
    }
    if (
      this.tokens.matches4(tt._import, tt.name, tt.name, tt.eq) &&
      this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._type)
    ) {
      this.tokens.removeInitialToken();
      for (let i = 0; i < 7; i++) {
        this.tokens.removeToken();
      }
      return true;
    }
    if (this.tokens.matches1(tt._import)) {
      return this.processImport();
    }
    if (this.tokens.matches2(tt._export, tt._default)) {
      return this.processExportDefault();
    }
    if (this.tokens.matches2(tt._export, tt.braceL)) {
      return this.processNamedExports();
    }
    if (
      this.tokens.matches2(tt._export, tt.name) &&
      this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._type)
    ) {
      return this.processExportType();
    }
    // `export declare type Foo = ...`
    if (
      this.tokens.matches3(tt._export, tt._declare, tt.name) &&
      this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 2, ContextualKeyword._type)
    ) {
      return this.processExportType();
    }
    return false;
  }

  private processExportType(): boolean {
    // Peek whether this is `export declare type ...`
    const hasDeclare = this.tokens.matches3(tt._export, tt._declare, tt.name) &&
      this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 2, ContextualKeyword._type);
    const thirdTokenOffset = hasDeclare ? 3 : 2;
    const thirdToken = this.tokens.tokenAtRelativeIndex(thirdTokenOffset);
    if (!thirdToken) {
      this.tokens.removeInitialToken();
      while (!this.tokens.isAtEnd()) this.tokens.removeToken();
      return true;
    }
    const isBraceL = thirdToken.type === tt.braceL;
    const typeName = (!isBraceL && thirdToken.type === tt.name)
      ? this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + thirdTokenOffset)
      : null;

    if (isBraceL) {
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
        removeMaybeImportAttributes(this.tokens); // BUG FIX: handle `with { ... }`
      }
      if (this.tokens.matches1(tt.semi)) this.tokens.removeToken();
      if (!hasFrom && typeNames.length > 0) {
        for (const name of typeNames) {
          this.tokens.appendCode(`export const ${name} = undefined;`);
        }
      }
    } else if (typeName) {
      // `export [declare] type Foo = <type-expr>;`
      // Use depth tracking to avoid stopping at semicolons inside type bodies.
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken(); // type
      this.tokens.removeToken(); // Foo
      let depth = 0;
      while (!this.tokens.isAtEnd()) {
        if (this.tokens.matches1(tt.braceL) || this.tokens.matches1(tt.parenL) ||
            this.tokens.matches1(tt.lessThan) || this.tokens.matches1(tt.bracketL)) {
          depth++;
        } else if (this.tokens.matches1(tt.braceR) || this.tokens.matches1(tt.parenR) ||
                   this.tokens.matches1(tt.greaterThan) || this.tokens.matches1(tt.bracketR)) {
          depth--;
        } else if (depth === 0 && this.tokens.matches1(tt.semi)) {
          this.tokens.removeToken();
          break;
        }
        this.tokens.removeToken();
      }
      this.tokens.appendCode(`export const ${typeName} = undefined;`);
    } else {
      // `export [declare] type * [as Foo] from '...'` or unrecognized - erase
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken(); // type
      let depth = 0;
      while (!this.tokens.isAtEnd()) {
        if (this.tokens.matches1(tt.braceL)) depth++;
        else if (this.tokens.matches1(tt.braceR)) { if (depth === 0) break; depth--; }
        else if (depth === 0 && this.tokens.matches1(tt.semi)) {
          this.tokens.removeToken();
          break;
        }
        this.tokens.removeToken();
      }
    }
    return true;
  }

  private processImportEquals(): boolean {
    const importName = this.tokens.identifierNameAtIndex(this.tokens.currentIndex() + 1);
    if (this.shouldAutomaticallyElideImportedName(importName)) {
      elideImportEquals(this.tokens);
    } else {
      this.tokens.replaceToken("const");
    }
    return true;
  }

  private processImport(): boolean {
    if (this.tokens.matches2(tt._import, tt.parenL)) {
      return false;
    }

    const snapshot = this.tokens.snapshot();
    const allImportsRemoved = this.removeImportTypeBindings();
    if (allImportsRemoved) {
      this.tokens.restoreToSnapshot(snapshot);
      while (!this.tokens.matches1(tt.string)) {
        this.tokens.removeToken();
      }
      this.tokens.removeToken();
      removeMaybeImportAttributes(this.tokens);
      if (this.tokens.matches1(tt.semi)) {
        this.tokens.removeToken();
      }
    }
    return true;
  }

  private removeImportTypeBindings(): boolean {
    this.tokens.copyExpectedToken(tt._import);
    if (
      this.tokens.matchesContextual(ContextualKeyword._type) &&
      !this.tokens.matches1AtIndex(this.tokens.currentIndex() + 1, tt.comma) &&
      !this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 1, ContextualKeyword._from)
    ) {
      return true;
    }

    if (this.tokens.matches1(tt.string)) {
      this.tokens.copyToken();
      return false;
    }

    if (
      this.tokens.matchesContextual(ContextualKeyword._module) &&
      this.tokens.matchesContextualAtIndex(this.tokens.currentIndex() + 2, ContextualKeyword._from)
    ) {
      this.tokens.copyToken();
    }

    let foundNonTypeImport = false;
    let foundAnyNamedImport = false;
    let needsComma = false;

    if (this.tokens.matches1(tt.name)) {
      if (this.shouldAutomaticallyElideImportedName(this.tokens.identifierName())) {
        this.tokens.removeToken();
        if (this.tokens.matches1(tt.comma)) {
          this.tokens.removeToken();
        }
      } else {
        foundNonTypeImport = true;
        this.tokens.copyToken();
        if (this.tokens.matches1(tt.comma)) {
          needsComma = true;
          this.tokens.removeToken();
        }
      }
    }

    if (this.tokens.matches1(tt.star)) {
      if (this.shouldAutomaticallyElideImportedName(this.tokens.identifierNameAtRelativeIndex(2))) {
        this.tokens.removeToken();
        this.tokens.removeToken();
        this.tokens.removeToken();
      } else {
        if (needsComma) {
          this.tokens.appendCode(",");
        }
        foundNonTypeImport = true;
        this.tokens.copyExpectedToken(tt.star);
        this.tokens.copyExpectedToken(tt.name);
        this.tokens.copyExpectedToken(tt.name);
      }
    } else if (this.tokens.matches1(tt.braceL)) {
      if (needsComma) {
        this.tokens.appendCode(",");
      }
      this.tokens.copyToken();
      while (!this.tokens.matches1(tt.braceR)) {
        foundAnyNamedImport = true;
        const specifierInfo = getImportExportSpecifierInfo(this.tokens);
        if (
          specifierInfo.isType ||
          this.shouldAutomaticallyElideImportedName(specifierInfo.rightName)
        ) {
          while (this.tokens.currentIndex() < specifierInfo.endIndex) {
            this.tokens.removeToken();
          }
          if (this.tokens.matches1(tt.comma)) {
            this.tokens.removeToken();
          }
        } else {
          foundNonTypeImport = true;
          while (this.tokens.currentIndex() < specifierInfo.endIndex) {
            this.tokens.copyToken();
          }
          if (this.tokens.matches1(tt.comma)) {
            this.tokens.copyToken();
          }
        }
      }
      this.tokens.copyExpectedToken(tt.braceR);
    }

    if (this.keepUnusedImports) {
      return false;
    }
    if (this.isTypeScriptTransformEnabled) {
      return !foundNonTypeImport;
    } else if (this.isFlowTransformEnabled) {
      return foundAnyNamedImport && !foundNonTypeImport;
    } else {
      return false;
    }
  }

  private shouldAutomaticallyElideImportedName(name: string): boolean {
    return (
      this.isTypeScriptTransformEnabled &&
      !this.keepUnusedImports &&
      !this.nonTypeIdentifiers.has(name)
    );
  }

  private processExportDefault(): boolean {
    if (
      shouldElideDefaultExport(
        this.isTypeScriptTransformEnabled,
        this.keepUnusedImports,
        this.tokens,
        this.declarationInfo,
      )
    ) {
      this.tokens.removeInitialToken();
      this.tokens.removeToken();
      this.tokens.removeToken();
      return true;
    }

    return false;
  }

  private processNamedExports(): boolean {
    if (!this.isTypeScriptTransformEnabled) {
      return false;
    }
    this.tokens.copyExpectedToken(tt._export);
    this.tokens.copyExpectedToken(tt.braceL);

    const isReExport = isExportFrom(this.tokens);
    let foundNonTypeExport = false;
    while (!this.tokens.matches1(tt.braceR)) {
      const specifierInfo = getImportExportSpecifierInfo(this.tokens);
      if (
        specifierInfo.isType ||
        (!isReExport && this.shouldElideExportedName(specifierInfo.leftName))
      ) {
        while (this.tokens.currentIndex() < specifierInfo.endIndex) {
          this.tokens.removeToken();
        }
        if (this.tokens.matches1(tt.comma)) {
          this.tokens.removeToken();
        }
      } else {
        foundNonTypeExport = true;
        while (this.tokens.currentIndex() < specifierInfo.endIndex) {
          this.tokens.copyToken();
        }
        if (this.tokens.matches1(tt.comma)) {
          this.tokens.copyToken();
        }
      }
    }
    this.tokens.copyExpectedToken(tt.braceR);

    if (!this.keepUnusedImports && isReExport && !foundNonTypeExport) {
      this.tokens.removeToken();
      this.tokens.removeToken();
      removeMaybeImportAttributes(this.tokens);
    }

    return true;
  }

  private shouldElideExportedName(name: string): boolean {
    return (
      this.isTypeScriptTransformEnabled &&
      !this.keepUnusedImports &&
      this.declarationInfo.typeDeclarations.has(name) &&
      !this.declarationInfo.valueDeclarations.has(name)
    );
  }
}
