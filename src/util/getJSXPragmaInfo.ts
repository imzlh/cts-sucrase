import type {Options} from "../index";

export interface JSXPragmaInfo {
  base: string;
  suffix: string;
  fragmentBase: string;
  fragmentSuffix: string;
}

const DEFAULT_JSX_PRAGMA = "React.createElement";
const DEFAULT_JSX_FRAGMENT_PRAGMA = "React.Fragment";
const DEFAULT_JSX_PRAGMA_INFO: JSXPragmaInfo = {
  base: "React",
  suffix: ".createElement",
  fragmentBase: "React",
  fragmentSuffix: ".Fragment",
};

export default function getJSXPragmaInfo(options: Options): JSXPragmaInfo {
  const pragma = options.jsxPragma || DEFAULT_JSX_PRAGMA;
  const fragmentPragma = options.jsxFragmentPragma || DEFAULT_JSX_FRAGMENT_PRAGMA;
  if (pragma === DEFAULT_JSX_PRAGMA && fragmentPragma === DEFAULT_JSX_FRAGMENT_PRAGMA) {
    return DEFAULT_JSX_PRAGMA_INFO;
  }
  let dotIndex = pragma.indexOf(".");
  if (dotIndex < 0) {
    dotIndex = pragma.length;
  }
  let fragmentDotIndex = fragmentPragma.indexOf(".");
  if (fragmentDotIndex < 0) {
    fragmentDotIndex = fragmentPragma.length;
  }
  return {
    base: pragma.slice(0, dotIndex),
    suffix: pragma.slice(dotIndex),
    fragmentBase: fragmentPragma.slice(0, fragmentDotIndex),
    fragmentSuffix: fragmentPragma.slice(fragmentDotIndex),
  };
}
