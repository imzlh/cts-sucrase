import {IdentifierRole} from "../parser/tokenizer";
import {TokenType as tt} from "../parser/tokenizer/types";
import type TokenProcessor from "../TokenProcessor";

export type DeclarationNameMap = {
  __proto__: null;
  [name: string]: true | null | undefined;
};

export interface DeclarationInfo {
  typeDeclarations: DeclarationNameMap;
  valueDeclarations: DeclarationNameMap;
  /** Names from `export interface Foo` / `export type Foo = ...` that will
   *  receive a placeholder `export const Foo = undefined` from the transformer.
   *  Used by shouldElideExportedName to NOT elide `export { Foo }` for these. */
  exportedTypeNames: DeclarationNameMap;
}

const EMPTY_DECLARATION_NAMES: DeclarationNameMap = {__proto__: null};

export const EMPTY_DECLARATION_INFO: DeclarationInfo = {
  typeDeclarations: EMPTY_DECLARATION_NAMES,
  valueDeclarations: EMPTY_DECLARATION_NAMES,
  exportedTypeNames: EMPTY_DECLARATION_NAMES,
};

export function hasDeclarationName(map: DeclarationNameMap, name: string): boolean {
  return map[name] === true;
}

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
 *   appendPlaceholder:       skips if hasDeclarationName(valueDeclarations, name)
 *   shouldElideExportedName: elides if typeDeclarations && !valueDeclarations && !exportedTypeNames
 */
export default function getDeclarationInfo(tokens: TokenProcessor): DeclarationInfo {
  let typeDeclarations: DeclarationNameMap | null = null;
  let valueDeclarations: DeclarationNameMap | null = null;
  let exportedTypeNames: DeclarationNameMap | null = null;
  const tokenList = tokens.tokens;
  for (let i = 0; i < tokenList.length; i++) {
    const token = tokenList[i];
    if (token.type === tt.name) {
      const role = token.identifierRole;
      if (
        role !== IdentifierRole.TopLevelDeclaration &&
        role !== IdentifierRole.ObjectShorthandTopLevelDeclaration &&
        role !== IdentifierRole.ImportDeclaration
      ) {
        continue;
      }
      const name = tokens.identifierNameForToken(token);
      if (token.isType) {
        (typeDeclarations ??= {__proto__: null})[name] = true;
        // `export interface Foo`        -> i-2 = export (tt._export)
        // `export declare interface Foo` -> i-3 = export, i-2 = declare (tt._declare)
        if (
          (i >= 2 && tokenList[i - 2].type === tt._export) ||
          (i >= 3 && tokenList[i - 3].type === tt._export)
        ) {
          (exportedTypeNames ??= {__proto__: null})[name] = true;
        }
      } else {
        (valueDeclarations ??= {__proto__: null})[name] = true;
      }
    }
  }
  return {
    typeDeclarations: typeDeclarations ?? EMPTY_DECLARATION_INFO.typeDeclarations,
    valueDeclarations: valueDeclarations ?? EMPTY_DECLARATION_INFO.valueDeclarations,
    exportedTypeNames: exportedTypeNames ?? EMPTY_DECLARATION_INFO.exportedTypeNames,
  };
}
