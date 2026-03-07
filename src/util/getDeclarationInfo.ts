import {isTopLevelDeclaration} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

export interface DeclarationInfo {
  typeDeclarations: Set<string>;
  valueDeclarations: Set<string>;
  /** Names from `export interface Foo` / `export type Foo = ...` that will
   *  receive a placeholder `export const Foo = undefined` from the transformer.
   *  Used by shouldElideExportedName to NOT elide `export { Foo }` for these. */
  exportedTypeNames: Set<string>;
}

export const EMPTY_DECLARATION_INFO: DeclarationInfo = {
  typeDeclarations: new Set(),
  valueDeclarations: new Set(),
  exportedTypeNames: new Set(),
};

/**
 * Classify all top-level identifier declarations for export elision and
 * placeholder generation.
 *
 * - Real runtime values (const/let/var/function/class/enum) -> valueDeclarations
 * - Pure type declarations (interface/type without export) -> typeDeclarations
 * - `export interface Foo` / `export type Foo = ...` -> typeDeclarations +
 *   exportedTypeNames (transformer emits placeholder, so export { Foo } must not elide)
 *
 * valueDeclarations and exportedTypeNames are intentionally DISJOINT:
 *   appendPlaceholder:       skips if valueDeclarations.has(name)  (real value exists)
 *   shouldElideExportedName: elides if typeDeclarations && !valueDeclarations && !exportedTypeNames
 */
export default function getDeclarationInfo(tokens: TokenProcessor): DeclarationInfo {
  const typeDeclarations: Set<string> = new Set();
  const valueDeclarations: Set<string> = new Set();
  const exportedTypeNames: Set<string> = new Set();
  for (let i = 0; i < tokens.tokens.length; i++) {
    const token = tokens.tokens[i];
    if (token.type === tt.name && isTopLevelDeclaration(token)) {
      const name = tokens.identifierNameForToken(token);
      if (token.isType) {
        typeDeclarations.add(name);
        // `export interface Foo`        -> i-2 = export (tt._export)
        // `export declare interface Foo` -> i-3 = export, i-2 = declare (tt._declare)
        const hasExportAt = (idx: number) =>
          idx >= 0 && tokens.tokens[idx].type === tt._export;
        if (hasExportAt(i - 2) || hasExportAt(i - 3)) {
          exportedTypeNames.add(name);
        }
      } else {
        valueDeclarations.add(name);
      }
    }
  }
  return {typeDeclarations, valueDeclarations, exportedTypeNames};
}