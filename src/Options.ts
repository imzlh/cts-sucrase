import {createCheckers} from "ts-interface-checker";

import OptionsGenTypes from "./Options-gen-types";

const {Options: OptionsChecker} = createCheckers(OptionsGenTypes);

export type Transform = "jsx" | "typescript" | "flow";

export interface SourceMapOptions {
  compiledFilename: string;
}

export interface Options {
  transforms: Array<Transform>;
  disableESTransforms?: boolean;
  jsxRuntime?: "classic" | "automatic" | "preserve";
  production?: boolean;
  jsxImportSource?: string;
  jsxPragma?: string;
  jsxFragmentPragma?: string;
  keepUnusedImports?: boolean;
  preserveImportAttributes?: boolean;
  sourceMapOptions?: SourceMapOptions;
  filePath?: string;
}

export function validateOptions(options: Options): void {
  OptionsChecker.strictCheck(options);
}
