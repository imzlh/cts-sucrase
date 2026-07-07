import {input, state} from "../traverser/base";
import {charCodes} from "../util/charcodes";
import {IS_IDENTIFIER_CHAR} from "../util/identifier";
import {finishToken} from "./index";
import {READ_WORD_TREE} from "./readWordTree";
import {TokenType as tt} from "./types";

/**
 * Read an identifier, producing either a name token or matching on one of the existing keywords.
 * For performance, we pre-generate big decision tree that we traverse. Each node represents a
 * prefix and has 27 values, where the first value is the token or contextual token, if any (-1 if
 * not), and the other 26 values are the transitions to other nodes, or -1 to stop.
 */
export default function readWord(): void {
  let treePos = 0;
  let code = 0;
  let pos = state.pos;
  const inputLength = input.length;
  while (pos < inputLength) {
    code = input.charCodeAt(pos);
    if (code < charCodes.lowercaseA || code > charCodes.lowercaseZ) {
      break;
    }
    const next = READ_WORD_TREE[treePos + (code - charCodes.lowercaseA) + 1];
    if (next === -1) {
      break;
    } else {
      treePos = next;
      pos++;
    }
  }

  const keywordValue = READ_WORD_TREE[treePos];
  if (keywordValue > -1 && (
    pos >= inputLength ||
    IS_IDENTIFIER_CHAR[code] !== 1
  )) {
    state.pos = pos;
    if (keywordValue & 1) {
      finishToken(keywordValue >>> 1);
    } else {
      finishToken(tt.name, keywordValue >>> 1);
    }
    return;
  }

  while (pos < inputLength) {
    const ch = input.charCodeAt(pos);
    if (IS_IDENTIFIER_CHAR[ch] === 1) {
      pos++;
    } else if (ch === charCodes.backslash) {
      // \u
      pos += 2;
      if (input.charCodeAt(pos) === charCodes.leftCurlyBrace) {
        while (pos < inputLength && input.charCodeAt(pos) !== charCodes.rightCurlyBrace) {
          pos++;
        }
        pos++;
      }
    } else if (ch === charCodes.atSign && input.charCodeAt(pos + 1) === charCodes.atSign) {
      pos += 2;
    } else {
      break;
    }
  }
  state.pos = pos;
  finishToken(tt.name);
}
