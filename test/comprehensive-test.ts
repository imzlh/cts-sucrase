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

describe("comprehensive transformer tests", () => {
  describe("transformer execution order", () => {
    it("handles using and type export in same file", () => {
      const source = `
using resource = getResource();
export type ID = string | number;
const x: number = 1;
`;
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(result.code.includes("const resource"));
      assert.ok(result.code.includes("export const ID = undefined"));
      assert.ok(result.code.includes("const x = 1"));
    });

    it("handles multiple type exports correctly", () => {
      const source = `
export type User = { name: string };
export type Admin = User & { role: string };
`;
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(result.code.includes("export const User = undefined"));
      assert.ok(result.code.includes("export const Admin = undefined"));
      assert.ok(!result.code.includes("type"));
    });

    it("handles mixed export types", () => {
      const source = `
export interface IAction { type: string; }
export type ID = string | number;
export const value = 1;
`;
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(result.code.includes("export const IAction = undefined"));
      assert.ok(result.code.includes("export const ID = undefined"));
      assert.ok(result.code.includes("export const value = 1"));
    });
  });

  describe("edge cases and error handling", () => {
    it("handles incomplete export type statements", () => {
      const source = `export type`;
      const result = transform(source, {transforms: ["typescript"]});
      assert.ok(result.code.length > 0);
    });

    it("handles export type with no name", () => {
      const source = `export type ;`;
      const result = transform(source, {transforms: ["typescript"]});
      assert.ok(result.code.length > 0);
    });

    it("handles using in async function", () => {
      const source = `async function test() { await using resource = getResource(); }`;
      const result = transform(source, {transforms: ["typescript"]});
      assert.ok(result.code.includes("await const resource"));
    });

    it("handles nested using statements", () => {
      const source = `
function outer() {
  using a = getA();
  function inner() {
    using b = getB();
  }
}
`;
      const result = transform(source, {transforms: ["typescript"]});
      assert.ok(result.code.includes("const a = getA()"));
      assert.ok(result.code.includes("const b = getB()"));
    });
  });

  describe("complex scenarios", () => {
    it("handles real-world TypeScript code", () => {
      const source = `
import { Request, Response } from 'express';

export interface User {
  id: number;
  name: string;
}

export type UserResponse = User & { createdAt: Date };

async function getUser(req: Request, res: Response) {
  using db = await connectDB();
  const user = await db.getUser(req.params.id);
  return res.json(user);
}
`;
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(result.code.includes("export const"));
      assert.ok(result.code.includes("User = undefined"));
      assert.ok(result.code.includes("UserResponse = undefined"));
      assert.ok(result.code.includes("const db = await connectDB()"));
      assert.ok(!result.code.includes("interface"));
      assert.ok(!result.code.includes("type"));
    });

    it("handles export type re-exports", () => {
      const source = `
export type { User, Admin } from './types';
export type { Config } from './config';
`;
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(!result.code.includes("User"));
      assert.ok(!result.code.includes("Admin"));
      assert.ok(!result.code.includes("Config"));
    });
  });
});