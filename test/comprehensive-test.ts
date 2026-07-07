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
    it("preserves using and handles type export in same file", () => {
      const source = `
using resource = getResource();
export type ID = string | number;
export interface IUser {
      name: string;
}
const x: number = 1;
`;
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(result.code.includes("using resource"));
      assert.ok(result.code.includes("export const ID = undefined"));
      assert.ok(result.code.includes("const x = 1"));
      assert.ok(result.code.includes("const IUser = undefined"));
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

    it("preserves await using in async function", () => {
      const source = `async function test() { await using resource = getResource(); }`;
      const result = transform(source, {transforms: ["typescript"]});
      assert.ok(result.code.includes("await using resource"));
    });

    it("preserves nested using statements", () => {
      const source = `
function outer() {
  using a = getA();
  function inner() {
    using b = getB();
  }
}
`;
      const result = transform(source, {transforms: ["typescript"]});
      assert.ok(result.code.includes("using a = getA()"));
      assert.ok(result.code.includes("using b = getB()"));
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
  await using db: Database = await connectDB();
  const user = await db.getUser(req.params.id);
  return res.json(user);
}
`;
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(result.code.includes("export const"));
      assert.ok(result.code.includes("User = undefined"));
      assert.ok(result.code.includes("UserResponse = undefined"));
      assert.ok(result.code.includes("await using db = await connectDB()"));
      assert.ok(!result.code.includes("interface"));
      assert.ok(!result.code.includes("type"));
    });

    it("handles Deno-style imports and references", () => {
      const source = `/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />


import "$std/dotenv/load.ts";


import { start } from "$fresh/server.ts";
import manifest from "./fresh.gen.ts";
import config from "./fresh.config.ts";


await start(manifest, config);`;
      
      const result = transform(source, {transforms: ["typescript"]});
      
      assert.ok(result.code.includes("import"));
      assert.ok(result.code.includes("start"));
      assert.ok(result.code.includes("manifest"));
      assert.ok(result.code.includes("config"));
      assert.ok(result.code.includes("await start"));
      // 三斜线指令作为注释保留在输出中是正常的
      assert.ok(result.code.includes("reference"));
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
