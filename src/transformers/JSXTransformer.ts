import type {Options} from "../index";
import type NameManager from "../NameManager";
import XHTMLEntities from "../parser/plugins/jsx/xhtml";
import {JSXRole, type Token} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
import {charCodes} from "../parser/util/charcodes";
import {IS_WHITESPACE} from "../parser/util/whitespace";
import type TokenProcessor from "../TokenProcessor";
import getJSXPragmaInfo, {type JSXPragmaInfo} from "../util/getJSXPragmaInfo";
import type RootTransformer from "./RootTransformer";
import Transformer from "./Transformer";

export default class JSXTransformer extends Transformer {
  jsxPragmaInfo: JSXPragmaInfo;
  jsxImportSource: string;
  isAutomaticRuntime: boolean;

  lastLineNumber: number = 1;
  lastIndex: number = 0;

  filenameVarName: string | null = null;
  autoCreateElementName: string | null = null;
  autoFragmentName: string | null = null;
  autoJSXName: string | null = null;
  autoJSXSName: string | null = null;
  autoJSXDEVName: string | null = null;

  constructor(
    readonly rootTransformer: RootTransformer,
    readonly tokens: TokenProcessor,
    readonly importProcessor: null,
    readonly nameManager: NameManager,
    readonly options: Options,
  ) {
    super();
    this.jsxPragmaInfo = getJSXPragmaInfo(options);
    this.isAutomaticRuntime = options.jsxRuntime === "automatic";
    this.jsxImportSource = options.jsxImportSource || "react";
  }

  process(): boolean {
    if (this.tokens.tokens[this.tokens.currentIndex()].type === tt.jsxTagStart) {
      this.processJSXTag();
      return true;
    }
    return false;
  }

  getPrefixCode(): string {
    let prefix = "";
    if (this.filenameVarName) {
      prefix += `const ${this.filenameVarName} = ${stringLiteralForJSXValue(this.options.filePath || "")};`;
    }
    if (this.isAutomaticRuntime) {
      const createElementResolution = this.autoCreateElementName;
      if (createElementResolution) {
        prefix += `import {createElement as ${createElementResolution}} from "${this.jsxImportSource}";`;
      }
      let importSpecifiers = "";
      if (this.autoFragmentName !== null) {
        importSpecifiers = `Fragment as ${this.autoFragmentName}`;
      }
      if (this.autoJSXName !== null) {
        importSpecifiers += importSpecifiers === "" ? "" : ", ";
        importSpecifiers += `jsx as ${this.autoJSXName}`;
      }
      if (this.autoJSXSName !== null) {
        importSpecifiers += importSpecifiers === "" ? "" : ", ";
        importSpecifiers += `jsxs as ${this.autoJSXSName}`;
      }
      if (this.autoJSXDEVName !== null) {
        importSpecifiers += importSpecifiers === "" ? "" : ", ";
        importSpecifiers += `jsxDEV as ${this.autoJSXDEVName}`;
      }
      if (importSpecifiers) {
        const importPath =
          this.jsxImportSource + (this.options.production ? "/jsx-runtime" : "/jsx-dev-runtime");
        prefix += `import {${importSpecifiers}} from "${importPath}";`;
      }
    }
    return prefix;
  }

  processJSXTag(): void {
    const token = this.tokens.tokens[this.tokens.currentIndex()];
    const {jsxRole, start} = token;
    // Calculate line number information at the very start (if in development
    // mode) so that the information is guaranteed to be queried in token order.
    const elementLocationCode = this.options.production ? null : this.getElementLocationCode(start);
    if (this.isAutomaticRuntime && jsxRole !== JSXRole.KeyAfterPropSpread) {
      this.transformTagToJSXFunc(elementLocationCode, jsxRole!);
    } else {
      this.transformTagToCreateElement(elementLocationCode);
    }
  }

  getElementLocationCode(firstTokenStart: number): string {
    const lineNumber = this.getLineNumberForIndex(firstTokenStart);
    return `lineNumber: ${lineNumber}`;
  }

  /**
   * Get the line number for this source position. This is calculated lazily and
   * must be called in increasing order by index.
   */
  getLineNumberForIndex(index: number): number {
    const code = this.tokens.code;
    const end = index < code.length ? index : code.length;
    let newlineIndex = code.indexOf("\n", this.lastIndex);
    while (newlineIndex !== -1 && newlineIndex < end) {
      this.lastLineNumber++;
      this.lastIndex = newlineIndex + 1;
      newlineIndex = code.indexOf("\n", this.lastIndex);
    }
    if (this.lastIndex < end) {
      this.lastIndex = end;
    }
    return this.lastLineNumber;
  }

  /**
   * Convert the current JSX element to a call to jsx, jsxs, or jsxDEV. This is
   * the primary transformation for the automatic transform.
   *
   * Example:
   * <div a={1} key={2}>Hello{x}</div>
   * becomes
   * jsxs('div', {a: 1, children: ["Hello", x]}, 2)
   */
  transformTagToJSXFunc(elementLocationCode: string | null, jsxRole: JSXRole): void {
    const isStatic = jsxRole === JSXRole.StaticChildren;
    // First tag is always jsxTagStart.
    this.tokens.replaceToken(this.getJSXFuncInvocationCode(isStatic));

    let keyCode = null;
    const tokenList = this.tokens.tokens;
    if (tokenList[this.tokens.currentIndex()].type === tt.jsxTagEnd) {
      // Fragment syntax.
      this.tokens.replaceToken(`${this.getFragmentCode()}, {`);
      this.processAutomaticChildrenAndEndProps(jsxRole);
    } else {
      // Normal open tag or self-closing tag.
      this.processTagIntro();
      this.tokens.appendCode(", {");
      keyCode = this.processProps(true);

      const tokenIndex = this.tokens.currentIndex();
      const tokenType = tokenList[tokenIndex].type;
      if (tokenType === tt.slash && tokenList[tokenIndex + 1].type === tt.jsxTagEnd) {
        // Self-closing tag, no children to add, so close the props.
        this.tokens.appendCode("}");
      } else if (tokenType === tt.jsxTagEnd) {
        // Tag with children.
        this.tokens.removeToken();
        this.processAutomaticChildrenAndEndProps(jsxRole);
      } else {
        throw new Error("Expected either /> or > at the end of the tag.");
      }
      // If a key was present, move it to its own arg. Note that moving code
      // like this will cause line numbers to get out of sync within the JSX
      // element if the key expression has a newline in it. This is unfortunate,
      // but hopefully should be rare.
      if (keyCode) {
        this.tokens.appendCode(`, ${keyCode}`);
      }
    }
    if (!this.options.production) {
      // If the key wasn't already added, add it now so we can correctly set
      // positional args for jsxDEV.
      if (keyCode === null) {
        this.tokens.appendCode(", void 0");
      }
      this.tokens.appendCode(`, ${isStatic}, ${this.getDevSource(elementLocationCode!)}, this`);
    }
    // We're at the close-tag or the end of a self-closing tag, so remove
    // everything else and close the function call.
    this.tokens.removeInitialToken();
    while (tokenList[this.tokens.currentIndex()].type !== tt.jsxTagEnd) {
      this.tokens.removeToken();
    }
    this.tokens.replaceToken(")");
  }

  /**
   * Convert the current JSX element to a createElement call. In the classic
   * runtime, this is the only case. In the automatic runtime, this is called
   * as a fallback in some situations.
   *
   * Example:
   * <div a={1} key={2}>Hello{x}</div>
   * becomes
   * React.createElement('div', {a: 1, key: 2}, "Hello", x)
   */
  transformTagToCreateElement(elementLocationCode: string | null): void {
    // First tag is always jsxTagStart.
    this.tokens.replaceToken(this.getCreateElementInvocationCode());

    const tokenList = this.tokens.tokens;
    if (tokenList[this.tokens.currentIndex()].type === tt.jsxTagEnd) {
      // Fragment syntax.
      this.tokens.replaceToken(`${this.getFragmentCode()}, null`);
      this.processChildren(true);
    } else {
      // Normal open tag or self-closing tag.
      this.processTagIntro();
      this.processPropsObjectWithDevInfo(elementLocationCode);

      const tokenIndex = this.tokens.currentIndex();
      const tokenType = tokenList[tokenIndex].type;
      if (tokenType === tt.slash && tokenList[tokenIndex + 1].type === tt.jsxTagEnd) {
        // Self-closing tag; no children to process.
      } else if (tokenType === tt.jsxTagEnd) {
        // Tag with children and a close-tag; process the children as args.
        this.tokens.removeToken();
        this.processChildren(true);
      } else {
        throw new Error("Expected either /> or > at the end of the tag.");
      }
    }
    // We're at the close-tag or the end of a self-closing tag, so remove
    // everything else and close the function call.
    this.tokens.removeInitialToken();
    while (tokenList[this.tokens.currentIndex()].type !== tt.jsxTagEnd) {
      this.tokens.removeToken();
    }
    this.tokens.replaceToken(")");
  }

  /**
   * Get the code for the relevant function for this context: jsx, jsxs,
   * or jsxDEV. The following open-paren is included as well.
   *
   * These functions are only used for the automatic runtime, so they are always
   * auto-imported, but the auto-import will be either CJS or ESM based on the
   * target module format.
   */
  getJSXFuncInvocationCode(isStatic: boolean): string {
    if (this.options.production) {
      if (isStatic) {
        return this.claimAutoImportedFuncInvocation("jsxs");
      } else {
        return this.claimAutoImportedFuncInvocation("jsx");
      }
    } else {
      return this.claimAutoImportedFuncInvocation("jsxDEV");
    }
  }

  /**
   * Return the code to use for the createElement function, e.g.
   * `React.createElement`, including the following open-paren.
   *
   * This is the main function to use for the classic runtime. For the
   * automatic runtime, this function is used as a fallback function to
   * preserve behavior when there is a prop spread followed by an explicit
   * key. In that automatic runtime case, the function should be automatically
   * imported.
   */
  getCreateElementInvocationCode(): string {
    if (this.isAutomaticRuntime) {
      return this.claimAutoImportedFuncInvocation("createElement");
    } else {
      const {jsxPragmaInfo} = this;
      return `${jsxPragmaInfo.base}${jsxPragmaInfo.suffix}(`;
    }
  }

  getFragmentCode(): string {
    if (this.isAutomaticRuntime) {
      return this.claimAutoImportedName("Fragment");
    } else {
      const {jsxPragmaInfo} = this;
      return jsxPragmaInfo.fragmentBase + jsxPragmaInfo.fragmentSuffix;
    }
  }

  claimAutoImportedFuncInvocation(funcName: string): string {
    const funcCode = this.claimAutoImportedName(funcName);
    return `${funcCode}(`;
  }

  claimAutoImportedName(funcName: string): string {
    switch (funcName) {
      case "createElement":
        return this.autoCreateElementName ??= this.nameManager.claimFreeName("_createElement");
      case "Fragment":
        return this.autoFragmentName ??= this.nameManager.claimFreeName("_Fragment");
      case "jsx":
        return this.autoJSXName ??= this.nameManager.claimFreeName("_jsx");
      case "jsxs":
        return this.autoJSXSName ??= this.nameManager.claimFreeName("_jsxs");
      case "jsxDEV":
        return this.autoJSXDEVName ??= this.nameManager.claimFreeName("_jsxDEV");
      default:
        throw new Error(`Unexpected JSX automatic import ${funcName}.`);
    }
  }

  /**
   * Process the first part of a tag, before any props.
   */
  processTagIntro(): void {
    // Walk forward until we see one of these patterns:
    // jsxName to start the first prop, preceded by another jsxName to end the tag name.
    // jsxName to start the first prop, preceded by greaterThan to end the type argument.
    // [open brace] to start the first prop.
    // [jsxTagEnd] to end the open-tag.
    // [slash, jsxTagEnd] to end the self-closing tag.
    const tokenList = this.tokens.tokens;
    const startIndex = this.tokens.currentIndex();
    let introEnd = startIndex + 1;
    while (true) {
      const token = tokenList[introEnd];
      const prevType = tokenList[introEnd - 1].type;
      const tokenType = token.type;
      if (!token.isType &&
          (tokenType === tt.braceL ||
            tokenType === tt.jsxTagEnd ||
            (prevType === tt.jsxName && tokenType === tt.jsxName) ||
            (prevType === tt.greaterThan && tokenType === tt.jsxName) ||
            (tokenType === tt.slash && tokenList[introEnd + 1].type === tt.jsxTagEnd))) {
        break;
      }
      introEnd++;
    }
    if (introEnd === startIndex + 1) {
      const tagToken = tokenList[startIndex];
      if (startsWithLowerCaseAt(this.tokens.code, tagToken.start)) {
        const tagName = this.tokens.identifierNameForToken(tagToken);
        this.tokens.replaceToken(`'${tagName}'`);
      }
    }
    while (this.tokens.currentIndex() < introEnd) {
      this.rootTransformer.processToken();
    }
  }

  /**
   * Starting at the beginning of the props, add the props argument to
   * React.createElement, including the comma before it.
   */
  processPropsObjectWithDevInfo(elementLocationCode: string | null): void {
    const devProps = this.options.production
      ? ""
      : `__self: this, __source: ${this.getDevSource(elementLocationCode!)}`;
    const tokenType = this.tokens.tokens[this.tokens.currentIndex()].type;
    if (tokenType !== tt.jsxName && tokenType !== tt.braceL) {
      if (devProps) {
        this.tokens.appendCode(`, {${devProps}}`);
      } else {
        this.tokens.appendCode(`, null`);
      }
      return;
    }
    this.tokens.appendCode(`, {`);
    this.processProps(false);
    if (devProps) {
      this.tokens.appendCode(` ${devProps}}`);
    } else {
      this.tokens.appendCode("}");
    }
  }

  /**
   * Transform the core part of the props, assuming that a { has already been
   * inserted before us and that a } will be inserted after us.
   *
   * If extractKeyCode is true (i.e. when using any jsx... function), any prop
   * named "key" has its code captured and returned rather than being emitted to
   * the output code. This shifts line numbers, and emitting the code later will
   * correct line numbers again. If no key is found or if extractKeyCode is
   * false, this function returns null.
   */
  processProps(extractKeyCode: boolean): string | null {
    let keyCode = null;
    const tokenList = this.tokens.tokens;
    while (true) {
      const tokenIndex = this.tokens.currentIndex();
      const token = tokenList[tokenIndex];
      const tokenType = token.type;
      if (tokenType === tt.jsxName && tokenList[tokenIndex + 1].type === tt.eq) {
        // This is a regular key={value} or key="value" prop.
        if (extractKeyCode && tokenMatchesCode(this.tokens.code, token, "key")) {
          if (keyCode !== null) {
            // The props list has multiple keys. Different implementations are
            // inconsistent about what to do here: as of this writing, Babel and
            // swc keep the *last* key and completely remove the rest, while
            // TypeScript uses the *first* key and leaves the others as regular
            // props. The React team collaborated with Babel on the
            // implementation of this behavior, so presumably the Babel behavior
            // is the one to use.
            // Since we won't ever be emitting the previous key code, we need to
            // at least emit its newlines here so that the line numbers match up
            // in the long run.
            this.tokens.appendCode(keepLineFeeds(keyCode));
          }
          // key
          this.tokens.removeToken();
          // =
          this.tokens.removeToken();
          const savedResultCodeLength = this.tokens.currentResultCodeLength();
          this.processPropValue();
          keyCode = this.tokens.dangerouslyGetAndRemoveCodeSince(savedResultCodeLength);
          // Don't add a comma
          continue;
        } else {
          this.processPropName(token);
          this.tokens.replaceToken(": ");
          this.processPropValue();
        }
      } else if (tokenType === tt.jsxName) {
        // This is a shorthand prop like <input disabled />.
        this.processPropName(token);
        this.tokens.appendCode(": true");
      } else if (tokenType === tt.braceL) {
        // This is prop spread, like <div {...getProps()}>, which we can pass
        // through fairly directly as an object spread.
        this.tokens.replaceToken("");
        this.rootTransformer.processBalancedCode();
        this.tokens.replaceToken("");
      } else {
        break;
      }
      this.tokens.appendCode(",");
    }
    return keyCode;
  }

  processPropName(token: Token): void {
    if (tokenHasHyphen(this.tokens.code, token)) {
      const propName = this.tokens.identifierNameForToken(token);
      this.tokens.replaceToken(`'${propName}'`);
    } else {
      this.tokens.copyToken();
    }
  }

  processPropValue(): void {
    const tokenType = this.tokens.tokens[this.tokens.currentIndex()].type;
    if (tokenType === tt.braceL) {
      this.tokens.replaceToken("");
      this.rootTransformer.processBalancedCode();
      this.tokens.replaceToken("");
    } else if (tokenType === tt.jsxTagStart) {
      this.processJSXTag();
    } else {
      this.processStringPropValue();
    }
  }

  processStringPropValue(): void {
    const token = this.tokens.tokens[this.tokens.currentIndex()];
    const valueCode = this.tokens.code.slice(token.start + 1, token.end - 1);
    const formatted = formatJSXStringValue(valueCode);
    this.tokens.replaceToken(formatted.literal + formatted.replacement);
  }

  /**
   * Starting in the middle of the props object literal, produce an additional
   * prop for the children and close the object literal.
   */
  processAutomaticChildrenAndEndProps(jsxRole: JSXRole): void {
    if (jsxRole === JSXRole.StaticChildren) {
      this.tokens.appendCode(" children: [");
      this.processChildren(false);
      this.tokens.appendCode("]}");
    } else {
      // The parser information tells us whether we will see a real child or if
      // all remaining children (if any) will resolve to empty. If there are no
      // non-empty children, don't emit a children prop at all, but still
      // process children so that we properly transform the code into nothing.
      if (jsxRole === JSXRole.OneChild) {
        this.tokens.appendCode(" children: ");
      }
      this.processChildren(false);
      this.tokens.appendCode("}");
    }
  }

  /**
   * Transform children into a comma-separated list, which will be either
   * arguments to createElement or array elements of a children prop.
   */
  processChildren(needsInitialComma: boolean): void {
    let needsComma = needsInitialComma;
    const tokenList = this.tokens.tokens;
    while (true) {
      const tokenIndex = this.tokens.currentIndex();
      const tokenType = tokenList[tokenIndex].type;
      if (tokenType === tt.jsxTagStart && tokenList[tokenIndex + 1].type === tt.slash) {
        // Closing tag, so no more children.
        return;
      }
      let didEmitElement = false;
      if (tokenType === tt.braceL) {
        if (tokenList[tokenIndex + 1].type === tt.braceR) {
          // Empty interpolations and comment-only interpolations are allowed
          // and don't create an extra child arg.
          this.tokens.replaceToken("");
          this.tokens.replaceToken("");
        } else {
          // Interpolated expression.
          this.tokens.replaceToken(needsComma ? ", " : "");
          this.rootTransformer.processBalancedCode();
          this.tokens.replaceToken("");
          didEmitElement = true;
        }
      } else if (tokenType === tt.jsxTagStart) {
        // Child JSX element
        this.tokens.appendCode(needsComma ? ", " : "");
        this.processJSXTag();
        didEmitElement = true;
      } else if (tokenType === tt.jsxText || tokenType === tt.jsxEmptyText) {
        didEmitElement = this.processChildTextElement(needsComma);
      } else {
        throw new Error("Unexpected token when processing JSX children.");
      }
      if (didEmitElement) {
        needsComma = true;
      }
    }
  }

  /**
   * Turn a JSX text element into a string literal, or nothing at all if the JSX
   * text resolves to the empty string.
   *
   * Returns true if a string literal is emitted, false otherwise.
   */
  processChildTextElement(needsComma: boolean): boolean {
    const token = this.tokens.tokens[this.tokens.currentIndex()];
    const valueCode = this.tokens.code.slice(token.start, token.end);
    const formatted = formatJSXText(valueCode);
    if (formatted.literal === '""') {
      this.tokens.replaceToken(formatted.replacement);
      return false;
    } else {
      this.tokens.replaceToken(`${needsComma ? ", " : ""}${formatted.literal}${formatted.replacement}`);
      return true;
    }
  }

  getDevSource(elementLocationCode: string): string {
    return `{fileName: ${this.getFilenameVarName()}, ${elementLocationCode}}`;
  }

  getFilenameVarName(): string {
    if (!this.filenameVarName) {
      this.filenameVarName = this.nameManager.claimFreeName("_jsxFileName");
    }
    return this.filenameVarName;
  }
}

/**
 * Spec for identifiers: https://tc39.github.io/ecma262/#prod-IdentifierStart.
 *
 * Really only treat anything starting with a-z as tag names.  `_`, `$`, `é`
 * should be treated as component names
 */
export function startsWithLowerCase(s: string): boolean {
  const firstChar = s.charCodeAt(0);
  return firstChar >= charCodes.lowercaseA && firstChar <= charCodes.lowercaseZ;
}

function startsWithLowerCaseAt(code: string, index: number): boolean {
  const firstChar = code.charCodeAt(index);
  return firstChar >= charCodes.lowercaseA && firstChar <= charCodes.lowercaseZ;
}

function tokenHasHyphen(code: string, token: Token): boolean {
  for (let i = token.start; i < token.end; i++) {
    if (code.charCodeAt(i) === charCodes.dash) {
      return true;
    }
  }
  return false;
}

function tokenMatchesCode(code: string, token: Token, expected: string): boolean {
  const length = token.end - token.start;
  if (length !== expected.length) {
    return false;
  }
  for (let i = 0; i < length; i++) {
    if (code.charCodeAt(token.start + i) !== expected.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

/**
 * Turn the given jsxText string into a JS string literal. Leading and trailing
 * whitespace on lines is removed, except immediately after the open-tag and
 * before the close-tag. Empty lines are completely removed, and spaces are
 * added between lines after that.
 *
 * Trim the start and end of each line and remove blank lines.
 */
const textFormatResult = {literal: "", replacement: ""};
const simpleJSXValueResult = {spaceCount: 0, literal: ""};
const whitespaceCacheLimit = 128;
const spaceRepeatCache = [""];
const lineFeedRepeatCache = [""];

function formatJSXText(text: string): {literal: string; replacement: string} {
  const simpleResult = analyzeSimpleJSXValue(text);
  if (simpleResult !== null) {
    textFormatResult.literal = simpleResult.literal;
    textFormatResult.replacement = repeatSpaces(simpleResult.spaceCount);
    return textFormatResult;
  }
  let result = "";
  let whitespace = "";
  let numNewlines = 0;
  let numSpaces = 0;

  let isInInitialLineWhitespace = false;
  let seenNonWhitespace = false;
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    if (charCode === charCodes.lineFeed) {
      numNewlines++;
      numSpaces = 0;
    } else if (charCode === charCodes.space) {
      numSpaces++;
    }
    if (charCode === charCodes.space ||
        charCode === charCodes.tab ||
        charCode === charCodes.carriageReturn) {
      if (!isInInitialLineWhitespace) {
        whitespace += text[i];
      }
    } else if (charCode === charCodes.lineFeed) {
      whitespace = "";
      isInInitialLineWhitespace = true;
    } else {
      if (seenNonWhitespace && isInInitialLineWhitespace) {
        result += " ";
      }
      result += whitespace;
      whitespace = "";
      if (charCode === charCodes.ampersand) {
        const entityInfo = processEntity(text, i + 1);
        for (let skipped = i + 1; skipped < entityInfo.newI; skipped++) {
          const skippedCharCode = text.charCodeAt(skipped);
          if (skippedCharCode === charCodes.lineFeed) {
            numNewlines++;
            numSpaces = 0;
          } else if (skippedCharCode === charCodes.space) {
            numSpaces++;
          }
        }
        i = entityInfo.newI - 1;
        result += entityInfo.entity;
      } else {
        result += text[i];
      }
      seenNonWhitespace = true;
      isInInitialLineWhitespace = false;
    }
  }
  if (!isInInitialLineWhitespace) {
    result += whitespace;
  }
  textFormatResult.literal = stringLiteralForJSXValue(result);
  textFormatResult.replacement = trailingWhitespaceReplacement(numNewlines, numSpaces);
  return textFormatResult;
}

/**
 * Format a string in the value position of a JSX prop.
 *
 * Use the same implementation as convertAttribute from
 * babel-helper-builder-react-jsx.
 */
function formatJSXStringValue(text: string): {literal: string; replacement: string} {
  const simpleResult = analyzeSimpleJSXValue(text);
  if (simpleResult !== null) {
    textFormatResult.literal = simpleResult.literal;
    textFormatResult.replacement = repeatSpaces(simpleResult.spaceCount);
    return textFormatResult;
  }
  let result = "";
  let numNewlines = 0;
  let numSpaces = 0;
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    if (charCode === charCodes.lineFeed) {
      numNewlines++;
      numSpaces = 0;
    } else if (charCode === charCodes.space) {
      numSpaces++;
    }
    if (charCode === charCodes.lineFeed) {
      if (isJSXStringWhitespace(text.charCodeAt(i + 1))) {
        result += " ";
        while (i < text.length && isJSXStringWhitespace(text.charCodeAt(i + 1))) {
          i++;
          const skippedCharCode = text.charCodeAt(i);
          if (skippedCharCode === charCodes.lineFeed) {
            numNewlines++;
            numSpaces = 0;
          } else if (skippedCharCode === charCodes.space) {
            numSpaces++;
          }
        }
      } else {
        result += "\n";
      }
    } else if (charCode === charCodes.ampersand) {
      const entityInfo = processEntity(text, i + 1);
      for (let skipped = i + 1; skipped < entityInfo.newI; skipped++) {
        const skippedCharCode = text.charCodeAt(skipped);
        if (skippedCharCode === charCodes.lineFeed) {
          numNewlines++;
          numSpaces = 0;
        } else if (skippedCharCode === charCodes.space) {
          numSpaces++;
        }
      }
      result += entityInfo.entity;
      i = entityInfo.newI - 1;
    } else {
      result += text[i];
    }
  }
  textFormatResult.literal = stringLiteralForJSXValue(result);
  textFormatResult.replacement = trailingWhitespaceReplacement(numNewlines, numSpaces);
  return textFormatResult;
}

function trailingWhitespaceReplacement(numNewlines: number, numSpaces: number): string {
  if (numNewlines === 0) {
    return repeatSpaces(numSpaces);
  }
  if (numSpaces === 0) {
    return repeatLineFeeds(numNewlines);
  }
  return repeatLineFeeds(numNewlines) + repeatSpaces(numSpaces);
}

function repeatSpaces(count: number): string {
  return repeatCached(spaceRepeatCache, " ", count);
}

function repeatLineFeeds(count: number): string {
  return repeatCached(lineFeedRepeatCache, "\n", count);
}

function repeatCached(cache: string[], unit: string, count: number): string {
  if (count > whitespaceCacheLimit) {
    return unit.repeat(count);
  }
  const cached = cache[count];
  if (cached !== undefined) {
    return cached;
  }
  let value = cache[cache.length - 1];
  for (let i = cache.length; i <= count; i++) {
    value += unit;
    cache[i] = value;
  }
  return value;
}

function stringLiteralForJSXValue(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i);
    if (
      charCode < 32 ||
      charCode === charCodes.quotationMark ||
      charCode === charCodes.backslash ||
      charCode === charCodes.lineSeparator ||
      charCode === charCodes.paragraphSeparator
    ) {
      return JSON.stringify(value);
    }
  }
  return `"${value}"`;
}

function analyzeSimpleJSXValue(value: string): {spaceCount: number; literal: string} | null {
  let spaceCount = 0;
  let needsStringify = false;
  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i);
    if (charCode === charCodes.lineFeed || charCode === charCodes.ampersand) {
      return null;
    }
    if (charCode === charCodes.space) {
      spaceCount++;
    }
    if (
      charCode < 32 ||
      charCode === charCodes.quotationMark ||
      charCode === charCodes.backslash ||
      charCode === charCodes.lineSeparator ||
      charCode === charCodes.paragraphSeparator
    ) {
      needsStringify = true;
    }
  }
  simpleJSXValueResult.spaceCount = spaceCount;
  simpleJSXValueResult.literal = needsStringify ? JSON.stringify(value) : `"${value}"`;
  return simpleJSXValueResult;
}

function isJSXStringWhitespace(charCode: number): boolean {
  return charCode === charCodes.lineFeed ||
    charCode === charCodes.carriageReturn ||
    IS_WHITESPACE[charCode] === 1;
}

function keepLineFeeds(code: string): string {
  let lineFeedCount = 0;
  let lineFeedIndex = code.indexOf("\n");
  while (lineFeedIndex !== -1) {
    lineFeedCount++;
    lineFeedIndex = code.indexOf("\n", lineFeedIndex + 1);
  }
  return repeatLineFeeds(lineFeedCount);
}

/**
 * Starting at a &, see if there's an HTML entity (specified by name, decimal
 * char code, or hex char code) and return it if so.
 *
 * Modified from jsxReadString in babel-parser.
 */
const entityResult = {entity: "", newI: 0};

function processEntity(text: string, indexAfterAmpersand: number): {entity: string; newI: number} {
  let count = 0;
  let entity;
  let i = indexAfterAmpersand;

  if (text.charCodeAt(i) === charCodes.numberSign) {
    let value = 0;
    let hasDigit = false;
    i++;
    if (text.charCodeAt(i) === charCodes.lowercaseX) {
      i++;
      while (i < text.length && isHexDigit(text.charCodeAt(i))) {
        value = value * 16 + hexValue(text.charCodeAt(i));
        hasDigit = true;
        i++;
      }
    } else {
      while (i < text.length && isDecimalDigit(text.charCodeAt(i))) {
        value = value * 10 + text.charCodeAt(i) - charCodes.digit0;
        hasDigit = true;
        i++;
      }
    }
    if (hasDigit && text.charCodeAt(i) === charCodes.semicolon) {
      i++;
      entity = String.fromCodePoint(value);
    }
  } else {
    if (processCommonEntity(text, indexAfterAmpersand)) {
      return entityResult;
    }
    const entityStart = i;
    while (i < text.length && count++ < 10) {
      if (text.charCodeAt(i) === charCodes.semicolon) {
        entity = XHTMLEntities[text.slice(entityStart, i)];
        i++;
        break;
      }
      i++;
    }
  }

  if (!entity) {
    entityResult.entity = "&";
    entityResult.newI = indexAfterAmpersand;
    return entityResult;
  }
  entityResult.entity = entity;
  entityResult.newI = i;
  return entityResult;
}

function processCommonEntity(text: string, start: number): boolean {
  switch (text.charCodeAt(start)) {
    case charCodes.lowercaseA:
      if (
        text.charCodeAt(start + 1) === charCodes.lowercaseM &&
        text.charCodeAt(start + 2) === charCodes.lowercaseP &&
        text.charCodeAt(start + 3) === charCodes.semicolon
      ) {
        entityResult.entity = "&";
        entityResult.newI = start + 4;
        return true;
      }
      if (
        text.charCodeAt(start + 1) === charCodes.lowercaseP &&
        text.charCodeAt(start + 2) === charCodes.lowercaseO &&
        text.charCodeAt(start + 3) === charCodes.lowercaseS &&
        text.charCodeAt(start + 4) === charCodes.semicolon
      ) {
        entityResult.entity = "'";
        entityResult.newI = start + 5;
        return true;
      }
      return false;

    case charCodes.lowercaseG:
      if (
        text.charCodeAt(start + 1) === charCodes.lowercaseT &&
        text.charCodeAt(start + 2) === charCodes.semicolon
      ) {
        entityResult.entity = ">";
        entityResult.newI = start + 3;
        return true;
      }
      return false;

    case charCodes.lowercaseL:
      if (
        text.charCodeAt(start + 1) === charCodes.lowercaseT &&
        text.charCodeAt(start + 2) === charCodes.semicolon
      ) {
        entityResult.entity = "<";
        entityResult.newI = start + 3;
        return true;
      }
      return false;

    case charCodes.lowercaseN:
      if (
        text.charCodeAt(start + 1) === charCodes.lowercaseB &&
        text.charCodeAt(start + 2) === charCodes.lowercaseS &&
        text.charCodeAt(start + 3) === charCodes.lowercaseP &&
        text.charCodeAt(start + 4) === charCodes.semicolon
      ) {
        entityResult.entity = "\u00A0";
        entityResult.newI = start + 5;
        return true;
      }
      return false;

    case charCodes.lowercaseQ:
      if (
        text.charCodeAt(start + 1) === charCodes.lowercaseU &&
        text.charCodeAt(start + 2) === charCodes.lowercaseO &&
        text.charCodeAt(start + 3) === charCodes.lowercaseT &&
        text.charCodeAt(start + 4) === charCodes.semicolon
      ) {
        entityResult.entity = '"';
        entityResult.newI = start + 5;
        return true;
      }
      return false;

    default:
      return false;
  }
}

function isDecimalDigit(code: number): boolean {
  return code >= charCodes.digit0 && code <= charCodes.digit9;
}

function isHexDigit(code: number): boolean {
  return (
    (code >= charCodes.digit0 && code <= charCodes.digit9) ||
    (code >= charCodes.lowercaseA && code <= charCodes.lowercaseF) ||
    (code >= charCodes.uppercaseA && code <= charCodes.uppercaseF)
  );
}

function hexValue(code: number): number {
  if (code <= charCodes.digit9) {
    return code - charCodes.digit0;
  }
  if (code <= charCodes.uppercaseF) {
    return code - charCodes.uppercaseA + 10;
  }
  return code - charCodes.lowercaseA + 10;
}
