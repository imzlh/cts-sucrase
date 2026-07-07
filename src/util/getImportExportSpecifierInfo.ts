import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

export interface ImportExportSpecifierInfo {
  isType: boolean;
  leftName: string | null;
  rightName: string | null;
  endIndex: number;
}

/**
 * Determine information about this named import or named export specifier.
 *
 * This syntax is the `a` from statements like these:
 * import {A} from "./foo";
 * export {A};
 * export {A} from "./foo";
 *
 * As it turns out, we can exactly characterize the syntax meaning by simply
 * counting the number of tokens, which can be from 1 to 4:
 * {A}
 * {type A}
 * {A as B}
 * {type A as B}
 *
 * In the type case, we never actually need the names in practice, so don't get
 * them.
 *
 * TODO: There's some redundancy with the type detection here and the isType
 * flag that's already present on tokens in TS mode. This function could
 * potentially be simplified and/or pushed to the call sites to avoid the object
 * allocation.
 */
export default function getImportExportSpecifierInfo(
  tokens: TokenProcessor,
  index: number = tokens.currentIndex(),
): ImportExportSpecifierInfo {
  return readImportExportSpecifierInfo(tokens, {
    isType: false,
    leftName: null,
    rightName: null,
    endIndex: 0,
  }, index);
}

export function readImportExportSpecifierInfo(
  tokens: TokenProcessor,
  out: ImportExportSpecifierInfo,
  index: number = tokens.currentIndex(),
): ImportExportSpecifierInfo {
  const tokenList = tokens.tokens;
  let endIndex = index + 1;
  let endTokenType = tokenList[endIndex].type;
  if (endTokenType === tt.braceR || endTokenType === tt.comma) {
    // import {A}
    const name = tokens.identifierNameForToken(tokenList[index]);
    out.isType = false;
    out.leftName = name;
    out.rightName = name;
    out.endIndex = endIndex;
    return out;
  }
  endIndex++;
  endTokenType = tokenList[endIndex].type;
  if (endTokenType === tt.braceR || endTokenType === tt.comma) {
    // import {type A}
    out.isType = true;
    out.leftName = null;
    out.rightName = null;
    out.endIndex = endIndex;
    return out;
  }
  endIndex++;
  endTokenType = tokenList[endIndex].type;
  if (endTokenType === tt.braceR || endTokenType === tt.comma) {
    // import {A as B}
    out.isType = false;
    out.leftName = tokens.identifierNameForToken(tokenList[index]);
    out.rightName = tokens.identifierNameForToken(tokenList[index + 2]);
    out.endIndex = endIndex;
    return out;
  }
  endIndex++;
  endTokenType = tokenList[endIndex].type;
  if (endTokenType === tt.braceR || endTokenType === tt.comma) {
    // import {type A as B}
    out.isType = true;
    out.leftName = null;
    out.rightName = null;
    out.endIndex = endIndex;
    return out;
  }
  throw new Error(`Unexpected import/export specifier at ${index}`);
}
