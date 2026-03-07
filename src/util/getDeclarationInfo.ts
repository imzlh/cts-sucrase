import {isTopLevelDeclaration} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
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
      if (token.isType) {
        typeDeclarations.add(tokens.identifierNameForToken(token));
        // `export interface Foo` or `export type Foo = ...`:
        // token at i-2 is `export`, token at i-1 is `interface`/`type`.
        // The transformer emits `export const Foo = undefined` for these,
        // so also add to valueDeclarations to prevent `export { Foo }` elision.
        if (i >= 2 && tokens.tokens[i - 2].type === tt._export) {
          valueDeclarations.add(tokens.identifierNameForToken(token));
        }
      } else {
        valueDeclarations.add(tokens.identifierNameForToken(token));
      }
    }
  }
  return {typeDeclarations, valueDeclarations};
}