import type {HelperManager} from "../HelperManager";
import type {Options, SucraseContext, TransformFeatureFlags} from "../index";
import type NameManager from "../NameManager";
import type {Token} from "../parser/tokenizer";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import getClassInfo, {type ClassInfo} from "../util/getClassInfo";
import ESMImportTransformer from "./ESMImportTransformer";
import FlowTransformer from "./FlowTransformer";
import JSXTransformer from "./JSXTransformer";
import ReactDisplayNameTransformer from "./ReactDisplayNameTransformer";
import TypeScriptTransformer from "./TypeScriptTransformer";

export interface RootTransformerResult {
  code: string;
  mappings: Int32Array | null;
}

export default class RootTransformer {
  private jsxTransformer: JSXTransformer | null = null;
  private reactDisplayNameTransformer: ReactDisplayNameTransformer | null = null;
  private typeScriptTransformer: TypeScriptTransformer | null = null;
  private esmImportTransformer: ESMImportTransformer | null = null;
  private flowTransformer: FlowTransformer | null = null;
  private nameManager: NameManager;
  private tokens: TokenProcessor;
  private generatedVariables: Array<string> | null = null;
  private helperManager: HelperManager;

  constructor(
    sucraseContext: SucraseContext,
    flags: TransformFeatureFlags,
    options: Options,
  ) {
    this.nameManager = sucraseContext.nameManager;
    this.helperManager = sucraseContext.helperManager;
    this.tokens = sucraseContext.tokenProcessor;
    const isJSXTransformEnabled = flags.isJSXEnabled;
    const isTypeScriptTransformEnabled = flags.isTypeScriptEnabled;
    const isFlowTransformEnabled = flags.isFlowEnabled;

    if (isJSXTransformEnabled) {
      if (options.jsxRuntime !== "preserve") {
        const jsxTransformer = new JSXTransformer(this, this.tokens, null, this.nameManager, options);
        this.jsxTransformer = jsxTransformer;
      }
      const reactDisplayNameTransformer = new ReactDisplayNameTransformer(
        this,
        this.tokens,
        null,
        options,
      );
      this.reactDisplayNameTransformer = reactDisplayNameTransformer;
    }

    if (isTypeScriptTransformEnabled) {
      const typeScriptTransformer = new TypeScriptTransformer(this, this.tokens, false, options);
      this.typeScriptTransformer = typeScriptTransformer;
    }

    if (isTypeScriptTransformEnabled || isFlowTransformEnabled) {
      const esmImportTransformer = new ESMImportTransformer(
        this.tokens,
        this.nameManager,
        this.helperManager,
        null,
        isTypeScriptTransformEnabled,
        isFlowTransformEnabled,
        Boolean(options.keepUnusedImports),
        options,
      );
      this.esmImportTransformer = esmImportTransformer;
    }

    if (isFlowTransformEnabled) {
      const flowTransformer = new FlowTransformer(this, this.tokens, false);
      this.flowTransformer = flowTransformer;
    }
  }

  transform(): RootTransformerResult {
    this.tokens.reset();
    this.processBalancedCode();
    let prefix = "";
    if (this.jsxTransformer !== null) {
      prefix += this.jsxTransformer.getPrefixCode();
    }
    prefix += this.helperManager.emitHelpers();
    const generatedVariables = this.generatedVariables;
    if (generatedVariables !== null) {
      for (let i = 0; i < generatedVariables.length; i++) {
        prefix += ` var ${generatedVariables[i]};`;
      }
    }
    const result = this.tokens.finish();
    let {code} = result;
    if (code.length >= 2 && code.charCodeAt(0) === 35 && code.charCodeAt(1) === 33) {
      let newlineIndex = code.indexOf("\n");
      if (newlineIndex === -1) {
        newlineIndex = code.length;
        code += "\n";
      }
      return {
        code: code.slice(0, newlineIndex + 1) + prefix + code.slice(newlineIndex + 1),
        mappings: result.mappings === null ? null : this.shiftMappings(result.mappings, prefix.length),
      };
    } else {
      return {
        code: prefix + code,
        mappings: prefix.length === 0 || result.mappings === null
          ? result.mappings
          : this.shiftMappings(result.mappings, prefix.length),
      };
    }
  }

  processBalancedCode(): void {
    let braceDepth = 0;
    let parenDepth = 0;
    const tokenList = this.tokens.tokens;
    while (!this.tokens.isAtEnd()) {
      const tokenType = tokenList[this.tokens.currentIndex()].type;
      if (tokenType === tt.braceL || tokenType === tt.dollarBraceL) {
        braceDepth++;
      } else if (tokenType === tt.braceR) {
        if (braceDepth === 0) {
          return;
        }
        braceDepth--;
      }
      if (tokenType === tt.parenL) {
        parenDepth++;
      } else if (tokenType === tt.parenR) {
        if (parenDepth === 0) {
          return;
        }
        parenDepth--;
      }
      this.processToken();
    }
  }

  processToken(): void {
    const tokenList = this.tokens.tokens;
    const token = tokenList[this.tokens.currentIndex()];
    const tokenType = token.type;
    if (tokenType === tt._class) {
      this.processClass();
      return;
    }
    const jsxTransformer = this.jsxTransformer;
    if (jsxTransformer !== null && tokenType === tt.jsxTagStart) {
      jsxTransformer.processJSXTag();
      return;
    }
    const reactDisplayNameTransformer = this.reactDisplayNameTransformer;
    if (reactDisplayNameTransformer !== null &&
        tokenType === tt.name &&
        reactDisplayNameTransformer.process()) return;
    const typeScriptTransformer = this.typeScriptTransformer;
    if (typeScriptTransformer !== null &&
        shouldTryTypeScriptTransform(token, tokenType) &&
        typeScriptTransformer.process()) return;
    const esmImportTransformer = this.esmImportTransformer;
    if (esmImportTransformer !== null &&
        (tokenType === tt._import || tokenType === tt._export) &&
        esmImportTransformer.process()) return;
    const flowTransformer = this.flowTransformer;
    if (flowTransformer !== null &&
        shouldTryFlowTransform(token, tokenType) &&
        flowTransformer.process()) return;
    this.tokens.copyToken();
  }

  processNamedClass(): string {
    const tokenList = this.tokens.tokens;
    const tokenIndex = this.tokens.currentIndex();
    const nameToken = tokenList[tokenIndex + 1];
    if (tokenList[tokenIndex].type !== tt._class || nameToken.type !== tt.name) {
      throw new Error("Expected identifier for exported class name.");
    }
    const name = this.tokens.identifierNameForToken(nameToken);
    this.processClass();
    return name;
  }

  processClass(): void {
    const classInfo = getClassInfo(this, this.tokens, this.nameManager, true);

    const needsCommaExpression =
      (classInfo.headerInfo.isExpression || !classInfo.headerInfo.className) &&
      classInfo.staticInitializerNames.length + classInfo.instanceInitializerNames.length > 0;

    let className = classInfo.headerInfo.className;
    if (needsCommaExpression) {
      className = this.nameManager.claimFreeName("_class");
      const generatedVariables = this.generatedVariables ??= [];
      generatedVariables[generatedVariables.length] = className;
      this.tokens.appendCode(` (${className} =`);
    }

    const tokenList = this.tokens.tokens;
    const classToken = tokenList[this.tokens.currentIndex()];
    const contextId = classToken.contextId;
    if (contextId == null) {
      throw new Error("Expected class to have a context ID.");
    }
    this.tokens.copyExpectedToken(tt._class);
    while (tokenList[this.tokens.currentIndex()].type !== tt.braceL ||
           tokenList[this.tokens.currentIndex()].contextId !== contextId) {
      this.processToken();
    }

    this.processClassBody(classInfo, className);

    if (needsCommaExpression) {
      let staticInitializerCode = "";
      for (let i = 0; i < classInfo.staticInitializerNames.length; i++) {
        staticInitializerCode += `${className!}.${classInfo.staticInitializerNames[i]}(), `;
      }
      this.tokens.appendCode(
        `, ${staticInitializerCode}${className!})`,
      );
    } else if (classInfo.staticInitializerNames.length > 0) {
      let staticInitializerCode = " ";
      for (let i = 0; i < classInfo.staticInitializerNames.length; i++) {
        staticInitializerCode += `${className!}.${classInfo.staticInitializerNames[i]}(); `;
      }
      this.tokens.appendCode(staticInitializerCode);
    }
  }

  processClassBody(classInfo: ClassInfo, className: string | null): void {
    const {
      headerInfo,
      constructorInsertPos,
      constructorInitializerStatements,
      fields,
      instanceInitializerNames,
      rangesToRemove,
      typeOnlyFieldEnds,
    } = classInfo;
    let fieldIndex = 0;
    let rangeToRemoveIndex = 0;
    let typeOnlyFieldEndIndex = 0;
    const tokenList = this.tokens.tokens;
    const classContextId = tokenList[this.tokens.currentIndex()].contextId;
    if (classContextId == null) {
      throw new Error("Expected non-null context ID on class.");
    }
    this.tokens.copyExpectedToken(tt.braceL);

    const needsConstructorInit =
      constructorInitializerStatements.length + instanceInitializerNames.length > 0;

    if (constructorInsertPos === null && needsConstructorInit) {
      const constructorInitializersCode = this.makeConstructorInitCode(
        constructorInitializerStatements,
        instanceInitializerNames,
        className!,
      );
      if (headerInfo.hasSuperclass) {
        const argsName = this.nameManager.claimFreeName("args");
        this.tokens.appendCode(
          `constructor(...${argsName}) { super(...${argsName}); ${constructorInitializersCode}; }`,
        );
      } else {
        this.tokens.appendCode(`constructor() { ${constructorInitializersCode}; }`);
      }
    }

    while (tokenList[this.tokens.currentIndex()].type !== tt.braceR ||
           tokenList[this.tokens.currentIndex()].contextId !== classContextId) {
      // A stripped `!`/type annotation left this position as the boundary of a bare
      // no-initializer field (see getClassInfo's typeOnlyFieldEnds). Insert the real
      // terminator here, before whatever token comes next gets processed, so the field
      // can't be parsed together with the next class element.
      if (
        typeOnlyFieldEndIndex < typeOnlyFieldEnds.length &&
        this.tokens.currentIndex() === typeOnlyFieldEnds[typeOnlyFieldEndIndex]
      ) {
        this.tokens.appendCode(";");
        typeOnlyFieldEndIndex++;
      }
      if (fieldIndex < fields.length && this.tokens.currentIndex() === fields[fieldIndex].start) {
        let needsCloseBrace = false;
        const tokenType = tokenList[this.tokens.currentIndex()].type;
        if (tokenType === tt.bracketL) {
          this.tokens.copyTokenWithPrefix(`${fields[fieldIndex].initializerName}() {this`);
        } else if (tokenType === tt.string || tokenType === tt.num) {
          this.tokens.copyTokenWithPrefix(`${fields[fieldIndex].initializerName}() {this[`);
          needsCloseBrace = true;
        } else {
          this.tokens.copyTokenWithPrefix(`${fields[fieldIndex].initializerName}() {this.`);
        }
        while (this.tokens.currentIndex() < fields[fieldIndex].end) {
          if (needsCloseBrace && this.tokens.currentIndex() === fields[fieldIndex].equalsIndex) {
            this.tokens.appendCode("]");
          }
          this.processToken();
        }
        this.tokens.appendCode("}");
        fieldIndex++;
      } else if (
        rangeToRemoveIndex < rangesToRemove.length &&
        this.tokens.currentIndex() >= rangesToRemove[rangeToRemoveIndex].start
      ) {
        if (this.tokens.currentIndex() < rangesToRemove[rangeToRemoveIndex].end) {
          this.tokens.removeInitialToken();
        }
        while (this.tokens.currentIndex() < rangesToRemove[rangeToRemoveIndex].end) {
          this.tokens.removeToken();
        }
        rangeToRemoveIndex++;
      } else if (this.tokens.currentIndex() === constructorInsertPos) {
        this.tokens.copyToken();
        if (needsConstructorInit) {
          this.tokens.appendCode(
            `;${this.makeConstructorInitCode(
              constructorInitializerStatements,
              instanceInitializerNames,
              className!,
            )};`,
          );
        }
        this.processToken();
      } else {
        this.processToken();
      }
    }
    this.tokens.copyExpectedToken(tt.braceR);
  }

  makeConstructorInitCode(
    constructorInitializerStatements: Array<string>,
    instanceInitializerNames: Array<string>,
    className: string,
  ): string {
    let result = "";
    for (let i = 0; i < constructorInitializerStatements.length; i++) {
      if (result) {
        result += ";";
      }
      result += constructorInitializerStatements[i];
    }
    for (let i = 0; i < instanceInitializerNames.length; i++) {
      if (result) {
        result += ";";
      }
      result += `${className}.prototype.${instanceInitializerNames[i]}.call(this)`;
    }
    return result;
  }

  processPossibleArrowParamEnd(): boolean {
    const tokenList = this.tokens.tokens;
    const tokenIndex = this.tokens.currentIndex();
    if (tokenList[tokenIndex].type === tt.parenR &&
        tokenList[tokenIndex + 1].type === tt.colon &&
        tokenList[tokenIndex + 1].isType) {
      let nextNonTypeIndex = tokenIndex + 1;
      while (tokenList[nextNonTypeIndex].isType) {
        nextNonTypeIndex++;
      }
      if (tokenList[nextNonTypeIndex].type === tt.arrow) {
        this.tokens.removeInitialToken();
        while (this.tokens.currentIndex() < nextNonTypeIndex) {
          this.tokens.removeToken();
        }
        this.tokens.replaceTokenTrimmingLeftWhitespace(") =>");
        return true;
      }
    }
    return false;
  }

  processPossibleAsyncArrowWithTypeParams(): boolean {
    const tokenList = this.tokens.tokens;
    const tokenIndex = this.tokens.currentIndex();
    const token = tokenList[tokenIndex];
    if (token.type !== tt._async &&
        !(token.type === tt.name && token.contextualKeyword === ContextualKeyword._async)) {
      return false;
    }
    const nextToken = tokenList[tokenIndex + 1];
    if (nextToken.type !== tt.lessThan || !nextToken.isType) {
      return false;
    }

    let nextNonTypeIndex = tokenIndex + 1;
    while (tokenList[nextNonTypeIndex].isType) {
      nextNonTypeIndex++;
    }
    if (tokenList[nextNonTypeIndex].type === tt.parenL) {
      this.tokens.replaceToken("async (");
      this.tokens.removeInitialToken();
      while (this.tokens.currentIndex() < nextNonTypeIndex) {
        this.tokens.removeToken();
      }
      this.tokens.removeToken();
      this.processBalancedCode();
      this.processToken();
      return true;
    }
    return false;
  }

  processPossibleTypeRange(): boolean {
    const tokenList = this.tokens.tokens;
    if (tokenList[this.tokens.currentIndex()].isType) {
      this.tokens.removeInitialToken();
      while (tokenList[this.tokens.currentIndex()].isType) {
        this.tokens.removeToken();
      }
      return true;
    }
    return false;
  }

  shiftMappings(
    mappings: Int32Array,
    prefixLength: number,
  ): Int32Array {
    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i];
      if (mapping !== 0) {
        mappings[i] = mapping + prefixLength;
      }
    }
    return mappings;
  }
}

function shouldTryTypeScriptTransform(token: Token, tokenType: tt): boolean {
  if (token.isType) {
    return true;
  }
  switch (tokenType) {
    case tt._export:
    case tt.parenR:
    case tt._async:
    case tt._public:
    case tt._protected:
    case tt._private:
    case tt._abstract:
    case tt._readonly:
    case tt._override:
    case tt.nonNullAssertion:
    case tt._enum:
    case tt._const:
      return true;

    case tt.name:
      return token.contextualKeyword === ContextualKeyword._interface ||
        token.contextualKeyword === ContextualKeyword._async;

    default:
      return false;
  }
}

function shouldTryFlowTransform(token: Token, tokenType: tt): boolean {
  if (token.isType) {
    return true;
  }
  switch (tokenType) {
    case tt.parenR:
    case tt._async:
    case tt._enum:
    case tt._export:
      return true;

    case tt.name:
      return token.contextualKeyword === ContextualKeyword._async;

    default:
      return false;
  }
}
