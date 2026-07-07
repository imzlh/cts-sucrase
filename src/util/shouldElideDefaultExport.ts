import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";
import {hasDeclarationName, type DeclarationInfo} from "./getDeclarationInfo";

/**
 * Common method sharing code between CJS and ESM cases, since they're the same here.
 */
export default function shouldElideDefaultExport(
  isTypeScriptTransformEnabled: boolean,
  keepUnusedImports: boolean,
  tokens: TokenProcessor,
  declarationInfo: DeclarationInfo,
): boolean {
  if (!isTypeScriptTransformEnabled || keepUnusedImports) {
    return false;
  }
  const tokenList = tokens.tokens;
  const tokenIndex = tokens.currentIndex();
  const exportToken = tokenList[tokenIndex];
  if (exportToken.rhsEndIndex == null) {
    throw new Error("Expected non-null rhsEndIndex on export token.");
  }
  // The export must be of the form `export default a` or `export default a;`.
  const numTokens = exportToken.rhsEndIndex - tokenIndex;
  if (
    numTokens !== 3 &&
    !(numTokens === 4 && tokenList[exportToken.rhsEndIndex - 1].type === tt.semi)
  ) {
    return false;
  }
  const identifierToken = tokenList[tokenIndex + 2];
  if (identifierToken.type !== tt.name) {
    return false;
  }
  const exportedName = tokens.identifierNameForToken(identifierToken);
  return (
    hasDeclarationName(declarationInfo.typeDeclarations, exportedName) &&
    !hasDeclarationName(declarationInfo.valueDeclarations, exportedName) &&
    !hasDeclarationName(declarationInfo.exportedTypeNames, exportedName)
  );
}
