import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

async function bundleEntry(name) {
  const result = await build({
    entryPoints: [resolve(sourceDir, name)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    write: false,
    metafile: true,
    define: { 'import.meta.use': '__sucraseUse' },
    // Inspect the public source-map path's native input without a circu.js host.
    banner: { js: `const __sucraseUse = () => ({
      sourceMapMappingsEncode: (segments, length) =>
        JSON.stringify([...segments.subarray(0, length)])
    });` },
  });
  return {
    api: await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`),
    inputs: Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/')),
  };
}

const narrow = await bundleEntry('cno.ts');
const publicEntry = await bundleEntry('index.ts');

test('CNO entry excludes public validation, token formatting, and source-map modules', () => {
  for (const input of narrow.inputs) {
    assert.doesNotMatch(input,
      /ts-interface-checker|lines-and-columns|\/Options(?:-gen-types)?\.ts$|\/formatTokens\.ts$|\/computeSourceMap\.ts$/);
    assert.ok(!input.endsWith('/sucrase/src/index.ts'), input);
  }
  assert.ok(publicEntry.inputs.some(input => input.includes('ts-interface-checker')));
  assert.ok(publicEntry.inputs.some(input => input.endsWith('/computeSourceMap.ts')));
});

const fixtures = [
  ['TS exports', 'export interface Shape { value: number }\nexport const value: number = 42;', true, false],
  ['plain JS', 'export const value = 42;', false, false],
  ['JSX', 'import React from "react"; export const node = <div title="a &amp; b">x</div>;', false, true],
  ['TSX', 'import React, {type FC} from "react"; const node: FC = <>x<span /></>;', true, true],
  ['class fields', 'class A { public x: number; view = <span />; }', true, true],
  ['import attributes', 'import bytes from "./raw" with { type: "bytes" }; console.log(bytes);', true, false],
  ['unused imports', 'import { Foo } from "m"; type T = Foo;', true, false],
  ['CTS import-equals', 'import unused = require("./side-effect");', true, false],
];

for (const [label, code, typescript, jsx] of fixtures) {
  test(`CNO entry preserves public transform behavior: ${label}`, () => {
    for (const keepUnusedImports of [true, false, true]) {
      for (const [jsxPragma, jsxFragmentPragma] of [
        ['React.createElement', 'React.Fragment'],
        ['h', 'Fragment'],
      ]) {
        const filePath = `${label}.tsx`;
        const options = {
          transforms: [...(typescript ? ['typescript'] : []), ...(jsx ? ['jsx'] : [])],
          disableESTransforms: true,
          production: false,
          jsxPragma,
          jsxFragmentPragma,
          filePath,
          keepUnusedImports,
          preserveImportAttributes: true,
        };
        const args = [code, filePath, typescript, jsx, jsxPragma, jsxFragmentPragma];
        const expected = publicEntry.api.transform(code, options).code;
        assert.equal(narrow.api.transformCnoCode(...args, keepUnusedImports), expected);
        assert.equal(publicEntry.api.transformCnoCode(...args, keepUnusedImports), expected);
        if (!keepUnusedImports) {
          assert.deepEqual(narrow.api.transformCno(...args), {code: expected});
          assert.deepEqual(publicEntry.api.transformCno(...args), {code: expected});
        }
      }
    }
  });
}

test('CNO syntax errors retain filename and parser location', () => {
  const code = 'const x: number = ;';
  const args = [code, 'bad.ts', true, false, 'React.createElement', 'React.Fragment'];
  function capture(api) {
    try {
      api.transformCnoCode(...args);
      assert.fail('syntax error must throw');
    } catch (error) {
      assert.match(error.message, /^Error transforming bad\.ts:/);
      assert.equal(error.loc.line, 1);
      assert.equal(typeof error.loc.column, 'number');
      return {name: error.name, message: error.message, pos: error.pos, loc: {...error.loc}};
    }
  }
  assert.deepEqual(capture(narrow.api), capture(publicEntry.api));
  assert.equal(narrow.api.transformCnoCode('const x: number = 1;', ...args.slice(1)), 'const x = 1;');
});

test('public transform retains strict option validation and Flow support', () => {
  const {transform} = publicEntry.api;
  assert.throws(() => transform('const x = 1;', {transforms: ['unknown']}));
  assert.throws(() => transform('const x = 1;', {transforms: ['typescript'], extra: true}));
  assert.throws(() => transform('const x = 1;', {transforms: ['typescript'], jsxPragma: 42}));
  assert.equal(transform('// @flow\nconst x: number = 1;\n', {transforms: ['flow']}).code,
    '// \nconst x = 1;\n');
});

test('public diagnostics and source maps remain available', () => {
  const {transform, getFormattedTokens} = publicEntry.api;
  assert.match(getFormattedTokens('const value: number = 1;', {transforms: ['typescript']}), /Location/);
  const {sourceMap} = transform('const a: number = 1;\nconst b: string = "x";', {
    transforms: ['typescript'],
    filePath: 'input.ts',
    sourceMapOptions: {compiledFilename: 'output.js'},
  });
  assert.equal(sourceMap.version, 3);
  assert.equal(sourceMap.file, 'output.js');
  assert.deepEqual(sourceMap.sources, ['input.ts']);
  assert.deepEqual(sourceMap.names, []);
  const nativeSegments = JSON.parse(sourceMap.mappings);
  assert.ok(nativeSegments.length > 0);
  assert.equal(nativeSegments.length % 4, 0);
  assert.throws(() => transform('const a: number = 1;', {
    transforms: ['typescript'],
    sourceMapOptions: {compiledFilename: 'output.js'},
  }), /filePath must be specified/);
});
