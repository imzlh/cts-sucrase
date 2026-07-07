import * as assert from "assert";
import {transform, type Options} from "../src";

function assertResult(
  code: string,
  expectedResult: string,
  transforms: Array<"jsx" | "typescript" | "flow"> = ["typescript"],
  extraOptions: Partial<Options> = {},
): void {
  const result = transform(code, {transforms, ...extraOptions});
  assert.strictEqual(result.code.trim(), expectedResult.trim());
}

describe("using declarations", () => {
  it("preserves using declarations", () => {
    assertResult(
      `using resource = getResource();`,
      `using resource = getResource();`,
    );
  });

  it("preserves await using declarations", () => {
    assertResult(
      `await using resource = getResource();`,
      `await using resource = getResource();`,
    );
  });

  it("preserves multiple using declarations", () => {
    assertResult(
      `using a = getA(); using b = getB();`,
      `using a = getA(); using b = getB();`,
    );
  });

  it("preserves using in a block", () => {
    assertResult(
      `function test() { using resource = getResource(); }`,
      `function test() { using resource = getResource(); }`,
    );
  });

  it("strips TypeScript annotations without lowering using", () => {
    assertResult(
      `using resource: Resource = getResource();`,
      `using resource = getResource();`,
    );
  });

  it("strips TypeScript annotations without lowering await using", () => {
    assertResult(
      `await using resource: Resource = getResource();`,
      `await using resource = getResource();`,
    );
  });

  it("preserves using declarations in for-of loops", () => {
    assertResult(
      `for (using resource: Resource of resources) { consume(resource); }`,
      `for (using resource of resources) { consume(resource); }`,
    );
  });

  it("preserves await using declarations in for-of loops", () => {
    assertResult(
      `for (await using resource: Resource of resources) { consume(resource); }`,
      `for (await using resource of resources) { consume(resource); }`,
    );
  });

  it("preserves using declarations in for-await-of loops", () => {
    assertResult(
      `async function f() { for await (using resource: Resource of resources) { consume(resource); } }`,
      `async function f() { for await (using resource of resources) { consume(resource); } }`,
    );
  });
});

describe("native class fields", () => {
  const nativeOptions = {disableESTransforms: true};

  it("preserves uninitialized class fields", () => {
    assertResult(
      `class A { x: number; }`,
      `class A { x; }`,
      ["typescript"],
      nativeOptions,
    );
  });

  it("preserves class fields after removing TypeScript modifiers", () => {
    assertResult(
      `class A { public x: number; readonly y: string; protected z: boolean; }`,
      `class A {  x;  y;  z; }`,
      ["typescript"],
      nativeOptions,
    );
  });

  it("preserves static class fields", () => {
    assertResult(
      `class A { static x: number; static y: string = "y"; }`,
      `class A { static x; static y = "y"; }`,
      ["typescript"],
      nativeOptions,
    );
  });

  it("lowers unsupported auto-accessors to native class fields", () => {
    assertResult(
      `class A { accessor x: number = 1; static accessor y: string = "y"; }`,
      `class A {  x = 1; static  y = "y"; }`,
      ["typescript"],
      nativeOptions,
    );
  });

  it("removes TypeScript-only declare and abstract fields", () => {
    assertResult(
      `class A { declare x: number; abstract y: string; declare accessor a: number; z: boolean; }`,
      `class A { ; ; ; z; }`,
      ["typescript"],
      nativeOptions,
    );
  });
});

describe("modern enum output", () => {
  it("uses in-place assignments for simple numeric enums", () => {
    assertResult(
      `enum E { A, B = 3, C }`,
      `var E = E || {}; E["A"] = 0; E[0] = "A"; E["B"] = 3; E[3] = "B"; E["C"] = 4; E[4] = "C";`,
    );
  });

  it("uses in-place assignments for simple string enums", () => {
    assertResult(
      `enum E { A = "a", B = "b" }`,
      `var E = E || {}; E["A"] = "a"; E["B"] = "b";`,
    );
  });

  it("keeps the legacy enum path for exported enums", () => {
    const result = transform(`export enum E { A, B = 3 }`, {transforms: ["typescript"]});
    assert.ok(result.code.includes("(function (E)"));
  });

  it("keeps the legacy enum path for computed enums", () => {
    const result = transform(`enum E { A, B = A + 1 }`, {transforms: ["typescript"]});
    assert.ok(result.code.includes("(function (E)"));
  });
});

describe("type export to undefined", () => {
  it("transforms export interface to export const undefined", () => {
    assertResult(
      `export interface IAction { type: string; }`,
      `export const IAction = undefined;`,
    );
  });

  it("removes non-exported interface", () => {
    assertResult(
      `interface IAction { type: string; }`,
      ``,
    );
  });

  it("transforms export type alias to export const undefined", () => {
    assertResult(
      `export type ID = string | number;`,
      `export const ID = undefined;`,
    );
  });

  it("removes non-exported type alias", () => {
    assertResult(
      `type ID = string | number;`,
      ``,
    );
  });

  it("transforms export type with multiple names", () => {
    assertResult(
      `export type { User, Admin };`,
      `export const User = undefined;export const Admin = undefined;`,
    );
  });

  it("removes export type from", () => {
    assertResult(
      `export type { User } from './types';`,
      ``,
    );
  });
});
