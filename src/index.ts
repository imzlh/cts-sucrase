import computeSourceMap, {type RawSourceMap} from "./computeSourceMap";
import {getSucraseContext, type TransformFeatureFlags} from "./context";
import {validateOptions} from "./Options";
import type {Options, SourceMapOptions, Transform} from "./Options";
import RootTransformer from "./transformers/RootTransformer";
import formatTokens from "./util/formatTokens";

export {transformCno, transformCnoCode} from "./cno";
export type {SucraseContext, TransformFeatureFlags} from "./context";

export interface TransformResult {
  code: string;
  sourceMap?: RawSourceMap;
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
  const tokens = getSucraseContext(
    code,
    options,
    getTransformFeatureFlags(options.transforms),
  ).tokenProcessor.tokens;
  return formatTokens(code, tokens);
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
