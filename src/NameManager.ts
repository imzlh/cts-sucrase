import type {Token} from "./parser/tokenizer";
import {TokenType as tt} from "./parser/tokenizer/types";

type NameMap = {__proto__: null; [name: string]: true | null | undefined};

export default class NameManager {
  private readonly claimedNames: NameMap = {__proto__: null};

  constructor(readonly code: string, readonly tokens: Array<Token>) {}

  claimFreeName(name: string): string {
    const newName = this.findFreeName(name);
    this.claimedNames[newName] = true;
    return newName;
  }

  findFreeName(name: string): string {
    if (!this.hasName(name)) {
      return name;
    }
    let suffixNum = 2;
    let newName = name + String(suffixNum);
    while (this.hasName(newName)) {
      suffixNum++;
      newName = name + String(suffixNum);
    }
    return newName;
  }

  private hasName(name: string): boolean {
    return this.claimedNames[name] === true || this.sourceHasName(name);
  }

  private sourceHasName(name: string): boolean {
    const {code, tokens} = this;
    if (code.indexOf(name) === -1) {
      return false;
    }
    const length = name.length;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === tt.name &&
          token.end - token.start === length &&
          tokenMatchesName(code, token.start, name, length)) {
        return true;
      }
    }
    return false;
  }
}

function tokenMatchesName(code: string, start: number, name: string, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (code.charCodeAt(start + i) !== name.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
