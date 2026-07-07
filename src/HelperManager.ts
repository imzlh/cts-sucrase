import type NameManager from "./NameManager";

const REQUIRE_HELPER = "require";

export class HelperManager {
  helperNames: {require?: string} = {};
  createRequireName: string | null = null;
  private hasHelperNames = false;
  constructor(readonly nameManager: NameManager) {}

  getHelperName(baseName: typeof REQUIRE_HELPER): string {
    let helperName = this.helperNames[baseName];
    if (helperName) {
      return helperName;
    }
    helperName = this.nameManager.claimFreeName(`_${baseName}`);
    this.helperNames[baseName] = helperName;
    this.hasHelperNames = true;
    return helperName;
  }

  emitHelpers(): string {
    if (!this.hasHelperNames) {
      return "";
    }
    const requireName = this.helperNames.require;
    if (!requireName) {
      return "";
    }
    let createRequireName = this.createRequireName;
    if (createRequireName === null) {
      createRequireName = this.nameManager.claimFreeName("_createRequire");
      this.createRequireName = createRequireName;
    }
    return ` import {createRequire as ${createRequireName}} from "module"; const ${requireName} = ${createRequireName}(import.meta.url);`;
  }
}
