import {charCodes} from "./charcodes";
import {WHITESPACE_CHARS} from "./whitespace";

export const IS_IDENTIFIER_CHAR = new Uint8Array(65536);
IS_IDENTIFIER_CHAR[charCodes.dollarSign] = 1;
IS_IDENTIFIER_CHAR.fill(1, charCodes.digit0, charCodes.digit9 + 1);
IS_IDENTIFIER_CHAR.fill(1, charCodes.uppercaseA, charCodes.uppercaseZ + 1);
IS_IDENTIFIER_CHAR[charCodes.underscore] = 1;
IS_IDENTIFIER_CHAR.fill(1, charCodes.lowercaseA, charCodes.lowercaseZ + 1);
// Aside from whitespace and newlines, all characters outside the ASCII space are either
// identifier characters or invalid. Since we're not performing code validation, we can just
// treat all invalid characters as identifier characters.
IS_IDENTIFIER_CHAR.fill(1, 128);
for (let i = 0; i < WHITESPACE_CHARS.length; i++) {
  IS_IDENTIFIER_CHAR[WHITESPACE_CHARS[i]] = 0;
}
IS_IDENTIFIER_CHAR[0x2028] = 0;
IS_IDENTIFIER_CHAR[0x2029] = 0;

export const IS_IDENTIFIER_START = IS_IDENTIFIER_CHAR.slice();
for (let numChar = charCodes.digit0; numChar <= charCodes.digit9; numChar++) {
  IS_IDENTIFIER_START[numChar] = 0;
}
