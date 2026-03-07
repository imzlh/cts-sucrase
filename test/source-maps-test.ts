import {eachMapping, TraceMap, type SourceMapInput} from "@jridgewell/trace-mapping";
import * as assert from "assert";
import {transform} from "../src";

function getSourceMap(code: string, options: any = {}): any {
  const result = transform(code, {
    transforms: ["typescript"],
    sourceMapOptions: {compiledFilename: "test.js"},
    filePath: "test.ts",
    ...options,
  });
  return {
    code: result.code,
    sourceMap: result.sourceMap,
    mappings: getMappings(result.sourceMap),
  };
}

function getMappings(sourceMap: any): Array<any> {
  const traceMap = new TraceMap(sourceMap as SourceMapInput);
  const mappings: Array<any> = [];
  eachMapping(traceMap, ({generatedLine, generatedColumn, originalLine, originalColumn}) => {
    mappings.push({generatedLine, generatedColumn, originalLine, originalColumn});
  });
  return mappings;
}

describe("source maps", () => {
  describe("basic functionality", () => {
    it("generates source map for simple code", () => {
      const source = `const x: number = 1;`;
      const {sourceMap} = getSourceMap(source);
      
      assert.equal(sourceMap.version, 3);
      assert.deepEqual(sourceMap.sources, ["test.ts"]);
      assert.equal(sourceMap.file, "test.js");
    });

    it("generates source map with correct line mapping", () => {
      const source = `const x = 1;
const y = 2;`;
      const {mappings} = getSourceMap(source);
      
      assert.ok(mappings.length > 0);
      assert.equal(mappings[0].originalLine, 1);
      assert.equal(mappings[0].generatedLine, 1);
    });
  });

  describe("using keyword transform", () => {
    it("generates source map for using to const transformation", () => {
      const source = `using resource = getResource();`;
      const {code, mappings} = getSourceMap(source);
      
      assert.ok(code.includes("const resource"));
      assert.ok(mappings.length > 0);
    });

    it("generates source map for await using transformation", () => {
      const source = `await using resource = getResource();`;
      const {code, mappings} = getSourceMap(source);
      console.log(code);
      console.log(mappings);
      
      assert.ok(code.includes("const resource"));
      assert.ok(mappings.length > 0);
    });
  });

  describe("type export transform", () => {
    it("generates source map for export interface transformation", () => {
      const source = `export interface IAction { type: string; }`;
      const {code, sourceMap} = getSourceMap(source);
      
      assert.ok(code.includes("export const IAction = undefined"));
      assert.equal(sourceMap.version, 3);
    });

    it("generates source map for export type transformation", () => {
      const source = `export type ID = string | number;`;
      const {code, sourceMap} = getSourceMap(source);
      
      assert.ok(code.includes("export const ID = undefined"));
      assert.equal(sourceMap.version, 3);
    });

    it("handles export type with multiple names", () => {
      const source = `export type { User, Admin };`;
      const {code, sourceMap} = getSourceMap(source);
      
      assert.ok(code.includes("export const User = undefined"));
      assert.ok(code.includes("export const Admin = undefined"));
      assert.equal(sourceMap.version, 3);
    });

    it("removes export type from without error", () => {
      const source = `export type { User } from './types';`;
      const {code, sourceMap} = getSourceMap(source);
      
      assert.ok(!code.includes("User"));
      assert.equal(sourceMap.version, 3);
    });
  });

  describe("complex scenarios", () => {
    it("handles mixed code with using and type exports", () => {
      const source = `
using resource = getResource();
export interface IResult { value: number; }
const x: number = 1;
`;
      const {code, sourceMap, mappings} = getSourceMap(source);
      
      assert.ok(code.includes("const resource"));
      assert.ok(code.includes("export const IResult = undefined"));
      assert.ok(code.includes("const x = 1"));
      assert.equal(sourceMap.version, 3);
      assert.ok(mappings.length > 0);
    });

    it("preserves column information for simple transformations", () => {
      const source = `const x: number = 1;`;
      const {mappings} = getSourceMap(source);
      
      const firstMapping = mappings.find((m: any) => m.originalColumn === 0);
      assert.ok(firstMapping);
    });
  });
});
