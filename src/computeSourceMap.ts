import type {SourceMapOptions} from "./index";
import type {Token} from "./parser/tokenizer";

const algorithm = import.meta.use("algorithm");

export interface RawSourceMap {
  version: number;
  file: string;
  sources: Array<string>;
  sourceRoot?: string;
  sourcesContent?: Array<string>;
  mappings: string;
  names: Array<string>;
}

/**
 * Generate a source map indicating that each line maps directly to the original line,
 * with the tokens in their new positions.
 */
export default function computeSourceMap(
  {code: generatedCode, mappings: rawMappings}: {code: string; mappings: Int32Array},
  filePath: string,
  options: SourceMapOptions,
  source: string,
  tokens: Array<Token>,
): RawSourceMap {
  let segments = new Int32Array((rawMappings.length + 8) << 2);
  let segmentValueCount = 0;
  const rawMappingCount = rawMappings.length;
  const generatedLength = generatedCode.length;
  let tokenIndex = 0;
  let sourceIndex = 0;
  let sourceLineStart = 0;
  // currentMapping is the output source index for the current input token being
  // considered.
  let currentMapping = rawMappingCount === 0 ? -1 : rawMappings[0] - 1;
  while (currentMapping < 0 && tokenIndex < rawMappingCount - 1) {
    tokenIndex++;
    currentMapping = rawMappings[tokenIndex] - 1;
  }
  let line = 0;
  let lineStart = 0;
  if (currentMapping !== lineStart) {
    segments[0] = line;
    segments[1] = 0;
    segments[2] = line;
    segments[3] = 0;
    segmentValueCount = 4;
  }
  let generatedIndex = 0;
  while (generatedIndex < generatedLength) {
    while (currentMapping < generatedIndex && tokenIndex < rawMappingCount - 1) {
      tokenIndex++;
      currentMapping = rawMappings[tokenIndex] - 1;
    }

    const newlineIndex = generatedCode.indexOf("\n", generatedIndex);
    const nextNewline = newlineIndex === -1 ? generatedLength : newlineIndex;
    const nextMapping = currentMapping >= generatedIndex ? currentMapping : generatedLength;
    const nextIndex = nextMapping < nextNewline ? nextMapping : nextNewline;
    if (nextIndex > generatedIndex) {
      generatedIndex = nextIndex;
      continue;
    }

    if (generatedIndex === currentMapping) {
      const genColumn = currentMapping - lineStart;
      const tokenStart = tokens[tokenIndex].start;
      while (sourceIndex < tokenStart) {
        const newlineIndex = source.indexOf("\n", sourceIndex);
        if (newlineIndex === -1 || newlineIndex >= tokenStart) {
          break;
        }
        sourceLineStart = newlineIndex + 1;
        sourceIndex = sourceLineStart;
      }
      sourceIndex = tokenStart;
      const sourceColumn = tokenStart - sourceLineStart;
      if (segmentValueCount + 4 > segments.length) {
        const next = new Int32Array(segments.length << 1);
        next.set(segments);
        segments = next;
      }
      segments[segmentValueCount] = line;
      segments[segmentValueCount + 1] = genColumn;
      segments[segmentValueCount + 2] = line;
      segments[segmentValueCount + 3] = sourceColumn;
      segmentValueCount += 4;
      while (
        (currentMapping === generatedIndex || currentMapping < 0) &&
        tokenIndex < rawMappingCount - 1
      ) {
        tokenIndex++;
        currentMapping = rawMappings[tokenIndex] - 1;
      }
    }
    if (generatedIndex === nextNewline) {
      line++;
      lineStart = generatedIndex + 1;
      if (currentMapping !== lineStart) {
        if (segmentValueCount + 4 > segments.length) {
          const next = new Int32Array(segments.length << 1);
          next.set(segments);
          segments = next;
        }
        segments[segmentValueCount] = line;
        segments[segmentValueCount + 1] = 0;
        segments[segmentValueCount + 2] = line;
        segments[segmentValueCount + 3] = 0;
        segmentValueCount += 4;
      }
    }
    generatedIndex++;
  }
  return {
    version: 3,
    file: options.compiledFilename,
    sources: [filePath],
    names: [],
    mappings: algorithm.sourceMapMappingsEncode(segments, segmentValueCount),
  };
}
