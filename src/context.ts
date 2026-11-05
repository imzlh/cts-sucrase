import {HelperManager} from "./HelperManager";
import identifyShadowedGlobals from "./identifyShadowedGlobals";
import NameManager from "./NameManager";
import type {Options} from "./Options";
import {parse} from "./parser";
import type {Scope} from "./parser/tokenizer/state";
import TokenProcessor from "./TokenProcessor";
import getTSImportedNames from "./util/getTSImportedNames";

export interface TransformFeatureFlags {
  isJSXEnabled: boolean;
  isTypeScriptEnabled: boolean;
  isFlowEnabled: boolean;
}

export interface SucraseContext {
  tokenProcessor: TokenProcessor;
  scopes: Array<Scope>;
  nameManager: NameManager;
  helperManager: HelperManager;
}

export function getSucraseContext(
  code: string,
  options: Options,
  flags: TransformFeatureFlags,
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
