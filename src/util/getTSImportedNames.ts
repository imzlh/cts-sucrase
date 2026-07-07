import type {Token} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

const EMPTY_IMPORTED_NAMES: Array<string> = [];

/**
 * Special case code to scan for imported names in ESM TypeScript. We need to do this so we can
 * properly get globals so we can compute shadowed globals.
 *
 * This is similar to logic in CJSImportProcessor, but trimmed down to avoid logic with CJS
 * replacement and flow type imports.
 */
export default function getTSImportedNames(tokens: TokenProcessor): Array<string> {
  let importedNames: Array<string> | null = null;
  const tokenList = tokens.tokens;
  for (let i = 0; i < tokenList.length; i++) {
    if (
      tokenList[i].type === tt._import &&
      !(tokenList[i + 1].type === tt.name && tokenList[i + 2].type === tt.eq)
    ) {
      importedNames = collectNamesForImport(tokens, tokenList, i, importedNames);
    }
  }
  return importedNames ?? EMPTY_IMPORTED_NAMES;
}

function collectNamesForImport(
  tokens: TokenProcessor,
  tokenList: Token[],
  index: number,
  importedNames: Array<string> | null,
): Array<string> | null {
  index++;

  if (tokenList[index].type === tt.parenL) {
    // Dynamic import, so nothing to do
    return importedNames;
  }

  if (tokenList[index].type === tt.name) {
    importedNames = appendImportedName(importedNames, tokens.identifierNameForToken(tokenList[index]));
    index++;
    if (tokenList[index].type === tt.comma) {
      index++;
    }
  }

  if (tokenList[index].type === tt.star) {
    // * as
    index += 2;
    importedNames = appendImportedName(importedNames, tokens.identifierNameForToken(tokenList[index]));
    index++;
  }

  if (tokenList[index].type === tt.braceL) {
    index++;
    importedNames = collectNamesForNamedImport(tokens, tokenList, index, importedNames);
  }
  return importedNames;
}

function collectNamesForNamedImport(
  tokens: TokenProcessor,
  tokenList: Token[],
  index: number,
  importedNames: Array<string> | null,
): Array<string> | null {
  while (true) {
    if (tokenList[index].type === tt.braceR) {
      return importedNames;
    }

    let endIndex = index + 1;
    let endTokenType = tokenList[endIndex].type;
    if (endTokenType === tt.braceR || endTokenType === tt.comma) {
      importedNames = appendImportedName(importedNames, tokens.identifierNameForToken(tokenList[index]));
    } else {
      endIndex++;
      endTokenType = tokenList[endIndex].type;
      if (endTokenType !== tt.braceR && endTokenType !== tt.comma) {
        endIndex++;
        endTokenType = tokenList[endIndex].type;
        if (endTokenType === tt.braceR || endTokenType === tt.comma) {
          importedNames = appendImportedName(
            importedNames,
            tokens.identifierNameForToken(tokenList[index + 2]),
          );
        } else {
          endIndex++;
          endTokenType = tokenList[endIndex].type;
          if (endTokenType !== tt.braceR && endTokenType !== tt.comma) {
            throw new Error(`Unexpected import specifier at ${index}`);
          }
        }
      }
    }
    index = endIndex;

    const separatorType = tokenList[index].type;
    if (separatorType === tt.comma && tokenList[index + 1].type === tt.braceR) {
      return importedNames;
    } else if (separatorType === tt.braceR) {
      return importedNames;
    } else if (separatorType === tt.comma) {
      index++;
    } else {
      throw new Error(`Unexpected token: ${JSON.stringify(tokenList[index])}`);
    }
  }
}

function appendImportedName(importedNames: Array<string> | null, name: string): Array<string> {
  const names = importedNames ?? [];
  names[names.length] = name;
  return names;
}
