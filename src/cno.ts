import {getSucraseContext, type TransformFeatureFlags} from "./context";
import type {TransformResult} from "./index";
import type {Options} from "./Options";
import RootTransformer from "./transformers/RootTransformer";

const CNO_TS_FLAGS: TransformFeatureFlags = {
  isJSXEnabled: false,
  isTypeScriptEnabled: true,
  isFlowEnabled: false,
};
const CNO_JSX_FLAGS: TransformFeatureFlags = {
  isJSXEnabled: true,
  isTypeScriptEnabled: false,
  isFlowEnabled: false,
};
const CNO_TSX_FLAGS: TransformFeatureFlags = {
  isJSXEnabled: true,
  isTypeScriptEnabled: true,
  isFlowEnabled: false,
};
const CNO_JS_FLAGS: TransformFeatureFlags = {
  isJSXEnabled: false,
  isTypeScriptEnabled: false,
  isFlowEnabled: false,
};
const CNO_OPTIONS: Options = {
  transforms: [],
  disableESTransforms: true,
  production: false,
  jsxPragma: "React.createElement",
  jsxFragmentPragma: "React.Fragment",
  filePath: "",
};

// This trusted entry keeps the public option checker and diagnostic tools out
// of the embedded CLI while sharing the same parser and transformers.
export function transformCno(
  code: string,
  filePath: string,
  isTypeScriptEnabled: boolean,
  isJSXEnabled: boolean,
  jsxPragma: string,
  jsxFragmentPragma: string,
): TransformResult {
  return {code: transformCnoCode(
    code,
    filePath,
    isTypeScriptEnabled,
    isJSXEnabled,
    jsxPragma,
    jsxFragmentPragma,
  )};
}

export function transformCnoCode(
  code: string,
  filePath: string,
  isTypeScriptEnabled: boolean,
  isJSXEnabled: boolean,
  jsxPragma: string,
  jsxFragmentPragma: string,
  keepUnusedImports = false,
): string {
  const flags = isTypeScriptEnabled
    ? isJSXEnabled ? CNO_TSX_FLAGS : CNO_TS_FLAGS
    : isJSXEnabled ? CNO_JSX_FLAGS : CNO_JS_FLAGS;
  const options = CNO_OPTIONS;
  options.filePath = filePath;
  options.jsxPragma = jsxPragma;
  options.jsxFragmentPragma = jsxFragmentPragma;
  options.keepUnusedImports = keepUnusedImports ? true : undefined;
  options.preserveImportAttributes = true;
  try {
    const sucraseContext = getSucraseContext(code, options, flags);
    const transformer = new RootTransformer(sucraseContext, flags, options);
    return transformer.transform().code;
  } catch (e: any) {
    e.message = `Error transforming ${filePath}: ${e.message}`;
    throw e;
  }
}
