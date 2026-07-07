import type {HelperManager} from "../HelperManager";
import type {Options} from "../index";
import type NameManager from "../NameManager";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import elideImportEquals from "../util/elideImportEquals";
import getDeclarationInfo, {
  hasDeclarationName,
  type DeclarationInfo,
  EMPTY_DECLARATION_INFO,
} from "../util/getDeclarationInfo";
import {
  type ImportExportSpecifierInfo,
  readImportExportSpecifierInfo,
} from "../util/getImportExportSpecifierInfo";
import {
  hasNonTypeIdentifier,
  type NonTypeIdentifierCache,
} from "../util/getNonTypeIdentifiers";
import isExportFrom from "../util/isExportFrom";
import {removeMaybeImportAttributes} from "../util/removeMaybeImportAttributes";
import shouldElideDefaultExport from "../util/shouldElideDefaultExport";
import Transformer from "./Transformer";

export default class ESMImportTransformer extends Transformer {
  private nonTypeIdentifierCache: NonTypeIdentifierCache = {__proto__: null};
  private declarationInfo: DeclarationInfo | null = null;

  constructor(
    readonly tokens: TokenProcessor,
    readonly nameManager: NameManager,
    readonly helperManager: HelperManager,
    readonly reactHotLoaderTransformer: null,
    readonly isTypeScriptTransformEnabled: boolean,
    readonly isFlowTransformEnabled: boolean,
    readonly keepUnusedImports: boolean,
    readonly options: Options,
  ) {
    super();
  }

  private removeImportAttributes(): void {
    if (!this.options.preserveImportAttributes) {
      removeMaybeImportAttributes(this.tokens);
    }
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
    if (
      tokenType === tt._import &&
      nextTokenType === tt.name &&
      thirdTokenType === tt.eq
    ) {
      return this.processImportEquals();
    }
    if (
      tokenType === tt._import &&
      nextTokenType === tt.name &&
      nextToken.contextualKeyword === ContextualKeyword._type &&
      thirdTokenType === tt.name &&
      tokenList[tokenIndex + 3]?.type === tt.eq
    ) {
      this.tokens.removeInitialToken();
      for (let i = 0; i < 7; i++) {
        this.tokens.removeToken();
      }
      return true;
    }
    if (tokenType === tt._import) {
      return this.processImport();
    }
    if (tokenType === tt._export && nextTokenType === tt._default) {
      return this.processExportDefault();
    }
    if (tokenType === tt._export && nextTokenType === tt.braceL) {
      return this.processNamedExports();
    }
    if (
      tokenType === tt._export &&
      nextTokenType === tt.name &&
      nextToken.contextualKeyword === ContextualKeyword._type
    ) {
      return this.processExportType();
    }
    // `export declare type Foo = ...`
    if (
      tokenType === tt._export &&
      nextTokenType === tt._declare &&
      thirdTokenType === tt.name &&
      thirdToken.contextualKeyword === ContextualKeyword._type
    ) {
      return this.processExportType();
    }
    return false;
  }

  private processExportType(): boolean {
    // Peek whether this is `export declare type ...`
    const tokenList = this.tokens.tokens;
    const tokenIndex = this.tokens.currentIndex();
    const hasDeclare =
      tokenList[tokenIndex].type === tt._export &&
      tokenList[tokenIndex + 1].type === tt._declare &&
      tokenList[tokenIndex + 2].type === tt.name &&
      tokenList[tokenIndex + 2].contextualKeyword === ContextualKeyword._type;
    const thirdTokenOffset = hasDeclare ? 3 : 2;
    const thirdToken = tokenList[tokenIndex + thirdTokenOffset];
    if (!thirdToken) {
      this.tokens.removeInitialToken();
      while (!this.tokens.isAtEnd()) this.tokens.removeToken();
      return true;
    }
    const isBraceL = thirdToken.type === tt.braceL;
    const typeName = (!isBraceL && thirdToken.type === tt.name)
      ? this.tokens.identifierNameForToken(thirdToken)
      : null;

    if (isBraceL) {
      const isReExport = this.isExportTypeReExport(thirdTokenOffset);
      const valueDeclarations = isReExport ? null : this.getDeclarationInfo().valueDeclarations;
      let placeholderCode = "";
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken();        // type
      this.tokens.removeToken();        // {
      const specifierInfo = makeSpecifierInfo();
      while (!this.tokens.isAtEnd() && tokenList[this.tokens.currentIndex()].type !== tt.braceR) {
        readImportExportSpecifierInfo(this.tokens, specifierInfo);
        const rightName = specifierInfo.rightName;
        if (!isReExport &&
            valueDeclarations !== null &&
            !specifierInfo.isType &&
            rightName != null &&
            !hasDeclarationName(valueDeclarations, rightName)) {
          placeholderCode += `export const ${rightName} = undefined;`;
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
        this.removeImportAttributes(); // BUG FIX: handle `with { ... }`
      }
      if (tokenList[this.tokens.currentIndex()].type === tt.semi) this.tokens.removeToken();
      if (placeholderCode) {
        this.tokens.appendCode(placeholderCode);
      }
    } else if (typeName) {
      // `export [declare] type Foo = <type-expr>;`
      // Use depth tracking to avoid stopping at semicolons inside type bodies.
      this.tokens.removeInitialToken(); // export
      if (hasDeclare) this.tokens.removeToken(); // declare
      this.tokens.removeToken(); // type
      this.tokens.removeToken(); // Foo
      let depth = 0;
      const tokenList = this.tokens.tokens;
      while (!this.tokens.isAtEnd()) {
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
      if (!hasDeclarationName(this.getDeclarationInfo().valueDeclarations, typeName)) {
        this.tokens.appendCode(`export const ${typeName} = undefined;`);
      }
    } else {
      // `export [declare] type * [as Foo] from '...'` or unrecognized - erase
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

  private processImportEquals(): boolean {
    const tokenList = this.tokens.tokens;
    const importName = this.tokens.identifierNameForToken(tokenList[this.tokens.currentIndex() + 1]);
    if (this.shouldAutomaticallyElideImportedName(importName)) {
      elideImportEquals(this.tokens);
    } else {
      this.tokens.replaceToken("const");
    }
    return true;
  }

  private processImport(): boolean {
    const tokenList = this.tokens.tokens;
    if (tokenList[this.tokens.currentIndex() + 1].type === tt.parenL) {
      return false;
    }

    const savedResultCodeLength = this.tokens.currentResultCodeLength();
    const savedTokenIndex = this.tokens.currentIndex();
    const allImportsRemoved = this.removeImportTypeBindings();
    if (allImportsRemoved) {
      this.tokens.restoreToState(savedResultCodeLength, savedTokenIndex);
      while (tokenList[this.tokens.currentIndex()].type !== tt.string) {
        this.tokens.removeToken();
      }
      this.tokens.removeToken();
      this.removeImportAttributes();
      if (tokenList[this.tokens.currentIndex()].type === tt.semi) {
        this.tokens.removeToken();
      }
    } else {
      const currentToken = tokenList[this.tokens.currentIndex()];
      if (
        currentToken.type === tt.name &&
        currentToken.contextualKeyword === ContextualKeyword._from &&
        tokenList[this.tokens.currentIndex() + 1].type === tt.string
      ) {
        this.tokens.copyToken();
        this.tokens.copyToken();
      }
      this.removeImportAttributes();
    }
    return true;
  }

  private removeImportTypeBindings(): boolean {
    this.tokens.copyExpectedToken(tt._import);
    const tokenIndex = this.tokens.currentIndex();
    const tokenList = this.tokens.tokens;
    const token = tokenList[tokenIndex];
    const nextToken = tokenList[tokenIndex + 1];
    if (
      token.type === tt.name &&
      token.contextualKeyword === ContextualKeyword._type &&
      nextToken.type !== tt.comma &&
      !(nextToken.type === tt.name && nextToken.contextualKeyword === ContextualKeyword._from)
    ) {
      return true;
    }

    if (token.type === tt.string) {
      this.tokens.copyToken();
      return false;
    }

    if (
      token.type === tt.name &&
      token.contextualKeyword === ContextualKeyword._module &&
      tokenList[tokenIndex + 2].type === tt.name &&
      tokenList[tokenIndex + 2].contextualKeyword === ContextualKeyword._from
    ) {
      this.tokens.copyToken();
    }

    let foundNonTypeImport = false;
    let foundAnyNamedImport = false;
    let needsComma = false;

    if (token.type === tt.name) {
      if (this.shouldAutomaticallyElideImportedName(this.tokens.identifierNameForToken(token))) {
        this.tokens.removeToken();
        if (tokenList[this.tokens.currentIndex()].type === tt.comma) {
          this.tokens.removeToken();
        }
      } else {
        foundNonTypeImport = true;
        this.tokens.copyToken();
        if (tokenList[this.tokens.currentIndex()].type === tt.comma) {
          needsComma = true;
          this.tokens.removeToken();
        }
      }
    }

    const currentIndex = this.tokens.currentIndex();
    if (tokenList[currentIndex].type === tt.star) {
      if (
        this.shouldAutomaticallyElideImportedName(this.tokens.identifierNameForToken(tokenList[currentIndex + 2]))
      ) {
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
    } else if (tokenList[currentIndex].type === tt.braceL) {
      if (needsComma) {
        this.tokens.appendCode(",");
      }
      this.tokens.copyToken();
      const specifierInfo = makeSpecifierInfo();
      while (tokenList[this.tokens.currentIndex()].type !== tt.braceR) {
        foundAnyNamedImport = true;
        readImportExportSpecifierInfo(this.tokens, specifierInfo);
        const rightName = specifierInfo.rightName;
        if (
          specifierInfo.isType ||
          rightName == null ||
          this.shouldAutomaticallyElideImportedName(rightName)
        ) {
          while (this.tokens.currentIndex() < specifierInfo.endIndex) {
            this.tokens.removeToken();
          }
          if (tokenList[this.tokens.currentIndex()].type === tt.comma) {
            this.tokens.removeToken();
          }
        } else {
          foundNonTypeImport = true;
          while (this.tokens.currentIndex() < specifierInfo.endIndex) {
            this.tokens.copyToken();
          }
          if (tokenList[this.tokens.currentIndex()].type === tt.comma) {
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
      !hasNonTypeIdentifier(this.tokens, this.options, this.nonTypeIdentifierCache, name)
    );
  }

  private processExportDefault(): boolean {
    if (
      shouldElideDefaultExport(
        this.isTypeScriptTransformEnabled,
        this.keepUnusedImports,
        this.tokens,
        this.getDeclarationInfo(),
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
    const tokenList = this.tokens.tokens;
    this.tokens.copyExpectedToken(tt._export);
    this.tokens.copyExpectedToken(tt.braceL);

    const isReExport = isExportFrom(this.tokens);
    let foundNonTypeExport = false;
    const specifierInfo = makeSpecifierInfo();
    while (tokenList[this.tokens.currentIndex()].type !== tt.braceR) {
      readImportExportSpecifierInfo(this.tokens, specifierInfo);
      const leftName = specifierInfo.leftName;
      if (
        specifierInfo.isType ||
        leftName == null ||
        (!isReExport && this.shouldElideExportedName(leftName))
      ) {
        while (this.tokens.currentIndex() < specifierInfo.endIndex) {
          this.tokens.removeToken();
        }
        if (tokenList[this.tokens.currentIndex()].type === tt.comma) {
          this.tokens.removeToken();
        }
      } else {
        foundNonTypeExport = true;
        while (this.tokens.currentIndex() < specifierInfo.endIndex) {
          this.tokens.copyToken();
        }
        if (tokenList[this.tokens.currentIndex()].type === tt.comma) {
          this.tokens.copyToken();
        }
      }
    }
    this.tokens.copyExpectedToken(tt.braceR);

    if (!this.keepUnusedImports && isReExport && !foundNonTypeExport) {
      this.tokens.removeToken();
      this.tokens.removeToken();
      this.removeImportAttributes();
    }

    return true;
  }

  private shouldElideExportedName(name: string): boolean {
    const declarationInfo = this.getDeclarationInfo();
    return (
      this.isTypeScriptTransformEnabled &&
      !this.keepUnusedImports &&
      hasDeclarationName(declarationInfo.typeDeclarations, name) &&
      !hasDeclarationName(declarationInfo.valueDeclarations, name) &&
      !hasDeclarationName(declarationInfo.exportedTypeNames, name)
    );
  }

  private getDeclarationInfo(): DeclarationInfo {
    if (!this.isTypeScriptTransformEnabled || this.keepUnusedImports) {
      return EMPTY_DECLARATION_INFO;
    }
    if (this.declarationInfo === null) {
      this.declarationInfo = getDeclarationInfo(this.tokens);
    }
    return this.declarationInfo;
  }
}

function makeSpecifierInfo(): ImportExportSpecifierInfo {
  return {isType: false, leftName: null, rightName: null, endIndex: 0};
}
