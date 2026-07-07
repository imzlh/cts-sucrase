import computeSourceMap, {type RawSourceMap} from "./computeSourceMap";
import {HelperManager} from "./HelperManager";
import identifyShadowedGlobals from "./identifyShadowedGlobals";
import NameManager from "./NameManager";
import {validateOptions} from "./Options";
import type {Options, SourceMapOptions, Transform} from "./Options";
import {parse} from "./parser";
import type {Scope} from "./parser/tokenizer/state";
import TokenProcessor from "./TokenProcessor";
import RootTransformer from "./transformers/RootTransformer";
import formatTokens from "./util/formatTokens";
import getTSImportedNames from "./util/getTSImportedNames";

export interface TransformFeatureFlags {
  isJSXEnabled: boolean;
  isTypeScriptEnabled: boolean;
  isFlowEnabled: boolean;
}

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
const CNO_TRANSFORMS: Array<Transform> = [];
const CNO_OPTIONS: Options = {
  transforms: CNO_TRANSFORMS,
  disableESTransforms: true,
  production: false,
  jsxPragma: "React.createElement",
  jsxFragmentPragma: "React.Fragment",
  filePath: "",
};

export interface TransformResult {
  code: string;
  sourceMap?: RawSourceMap;
}

export interface SucraseContext {
  tokenProcessor: TokenProcessor;
  scopes: Array<Scope>;
  nameManager: NameManager;
  helperManager: HelperManager;
}

export type {Options, SourceMapOptions, Transform};

export function getVersion(): string {
  return "3.35.1";
}

export function transform(code: string, options: Options): TransformResult {
  validateOptions(options);
  return transformTrusted(code, options);
}

export function transformTrusted(code: string, options: Options): TransformResult {
  return transformTrustedWithFlags(code, options, getTransformFeatureFlags(options.transforms));
}

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
  const flags = getCnoFeatureFlags(isTypeScriptEnabled, isJSXEnabled);
  const options = CNO_OPTIONS;
  options.filePath = filePath;
  options.jsxPragma = jsxPragma;
  options.jsxFragmentPragma = jsxFragmentPragma;
  options.keepUnusedImports = keepUnusedImports ? true : undefined;
  options.preserveImportAttributes = true;
  try {
    const sucraseContext = getSucraseContext(
      code,
      options,
      flags,
    );
    const transformer = new RootTransformer(
      sucraseContext,
      flags,
      options,
    );
    return transformer.transform().code;
  } catch (e: any) {
    e.message = `Error transforming ${filePath}: ${e.message}`;
    throw e;
  }
}

function transformTrustedWithFlags(
  code: string,
  options: Options,
  flags: TransformFeatureFlags,
): TransformResult {
  try {
    const sucraseContext = getSucraseContext(code, options, flags);
    const transformer = new RootTransformer(
      sucraseContext,
      flags,
      options,
    );
    const transformerResult = transformer.transform();
    const result: TransformResult = {code: transformerResult.code};
    if (options.sourceMapOptions) {
      if (!options.filePath) {
        throw new Error("filePath must be specified when generating a source map.");
      }
      if (transformerResult.mappings === null) {
        throw new Error("Expected source map mappings to be enabled.");
      }
      result.sourceMap = computeSourceMap(
        {code: transformerResult.code, mappings: transformerResult.mappings},
        options.filePath,
        options.sourceMapOptions,
        code,
        sucraseContext.tokenProcessor.tokens,
      );
    }
    return result;
  } catch (e: any) {
    if (options.filePath) {
      e.message = `Error transforming ${options.filePath}: ${e.message}`;
    }
    throw e;
  }
}

export function getFormattedTokens(code: string, options: Options): string {
  const tokens = getSucraseContext(code, options).tokenProcessor.tokens;
  return formatTokens(code, tokens);
}

function getSucraseContext(
  code: string,
  options: Options,
  flags: TransformFeatureFlags = getTransformFeatureFlags(options.transforms),
): SucraseContext {
  const {isJSXEnabled, isTypeScriptEnabled, isFlowEnabled} = flags;
  const file = parse(code, isJSXEnabled, isTypeScriptEnabled, isFlowEnabled);
  const tokens = file.tokens;
  const scopes = file.scopes;

  const nameManager = new NameManager(code, tokens);
  const helperManager = new HelperManager(nameManager);
  const tokenProcessor = new TokenProcessor(
    code,
    tokens,
    isFlowEnabled,
    helperManager,
    Boolean(options.sourceMapOptions),
  );

  if (isTypeScriptEnabled && !options.keepUnusedImports && code.indexOf("import") !== -1) {
    const tsImportedNames = getTSImportedNames(tokenProcessor);
    if (tsImportedNames.length > 0) {
      identifyShadowedGlobals(tokenProcessor, scopes, tsImportedNames);
    }
  }
  return {tokenProcessor, scopes, nameManager, helperManager};
}

function getTransformFeatureFlags(transforms: Array<Transform>): TransformFeatureFlags {
  let isJSXEnabled = false;
  let isTypeScriptEnabled = false;
  let isFlowEnabled = false;
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    switch (transform) {
      case "jsx":
        isJSXEnabled = true;
        break;
      case "typescript":
        isTypeScriptEnabled = true;
        break;
      case "flow":
        isFlowEnabled = true;
        break;
    }
  }
  return {isJSXEnabled, isTypeScriptEnabled, isFlowEnabled};
}

function getCnoFeatureFlags(
  isTypeScriptEnabled: boolean,
  isJSXEnabled: boolean,
): TransformFeatureFlags {
  return isTypeScriptEnabled
    ? isJSXEnabled ? CNO_TSX_FLAGS : CNO_TS_FLAGS
    : isJSXEnabled ? CNO_JSX_FLAGS : CNO_JS_FLAGS;
}
