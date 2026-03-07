import {isTopLevelDeclaration} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
import {ContextualKeyword} from "../parser/tokenizer/keywords";
import type TokenProcessor from "../TokenProcessor";

export interface DeclarationInfo {
  typeDeclarations: Set<string>;
  valueDeclarations: Set<string>;
}

export const EMPTY_DECLARATION_INFO: DeclarationInfo = {
  typeDeclarations: new Set(),
  valueDeclarations: new Set(),
};

/**
 * Get all top-level identifiers that should be preserved when exported in TypeScript.
 *
 * - `const x` -> valueDeclarations, `export {x}` preserved.
 * - `type x` -> typeDeclarations only, `export {x}` elided.
 * - `export interface Foo` / `export type Foo = ...` -> BOTH sets, because the
 *   transformer generates `export const Foo = undefined` placeholders, so
 *   `export { Foo }` in the same file must NOT be elided.
 */
export default function getDeclarationInfo(tokens: TokenProcessor): DeclarationInfo {
  const typeDeclarations: Set<string> = new Set();
  const valueDeclarations: Set<string> = new Set();
  for (let i = 0; i < tokens.tokens.length; i++) {
    const token = tokens.tokens[i];
    if (token.type === tt.name && isTopLevelDeclaration(token)) {
      const identifierName = tokens.identifierNameForToken(token);
      
      // Check for export interface or export type
      if (i >= 2 && tokens.tokens[i - 2].type === tt._export) {
        const prevToken = tokens.tokens[i - 1];
        if (prevToken.type === tt.name && 
            (prevToken.contextualKeyword === ContextualKeyword._interface || 
             prevToken.contextualKeyword === ContextualKeyword._type)) {
          // For export interface and export type, add to both sets
          typeDeclarations.add(identifierName);
          valueDeclarations.add(identifierName);
          continue;
        }
      }
      
      if (token.isType) {
        typeDeclarations.add(identifierName);
      } else {
        valueDeclarations.add(identifierName);
      }
    }
  }
  return {typeDeclarations, valueDeclarations};
}