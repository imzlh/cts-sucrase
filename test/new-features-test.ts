import * as assert from "assert";
import {transform} from "../src";

function assertResult(
  code: string,
  expectedResult: string,
  transforms: Array<"jsx" | "typescript" | "flow"> = ["typescript"],
): void {
  const result = transform(code, {transforms});
  assert.strictEqual(result.code.trim(), expectedResult.trim());
}

describe("using keyword transform", () => {
  it("transforms using to const", () => {
    assertResult(
      `using resource = getResource();`,
      `const resource = getResource();`,
    );
  });

  it("transforms await using to const", () => {
    assertResult(
      `await using resource = getResource();`,
      `const resource = getResource();`,
    );
  });

  it("transforms multiple using declarations", () => {
    assertResult(
      `using a = getA(); using b = getB();`,
      `const a = getA(); const b = getB();`,
    );
  });

  it("transforms using in a block", () => {
    assertResult(
      `function test() { using resource = getResource(); }`,
      `function test() { const resource = getResource(); }`,
    );
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
