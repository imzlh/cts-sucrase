import {IS_IDENTIFIER_CHAR, IS_IDENTIFIER_START} from "../parser/util/identifier";

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar
// Hard-code a list of reserved words rather than trying to use keywords or contextual keywords
// from the parser, since currently there are various exceptions, like `package` being reserved
// but unused and various contextual keywords being reserved. Note that we assume that all code
// compiled by Sucrase is in a module, so strict mode words and await are all considered reserved
// here.
function isReservedWord(name: string): boolean {
  switch (name.length) {
    case 2:
      return name === "do" || name === "if" || name === "in";
    case 3:
      return name === "for" || name === "let" || name === "new" ||
        name === "try" || name === "var";
    case 4:
      return name === "case" || name === "else" || name === "enum" ||
        name === "null" || name === "this" || name === "true" ||
        name === "void" || name === "with";
    case 5:
      return name === "await" || name === "break" || name === "catch" ||
        name === "class" || name === "const" || name === "false" ||
        name === "super" || name === "throw" || name === "while" ||
        name === "yield";
    case 6:
      return name === "delete" || name === "export" || name === "import" ||
        name === "public" || name === "return" || name === "static" ||
        name === "switch" || name === "typeof";
    case 7:
      return name === "default" || name === "extends" || name === "finally" ||
        name === "package" || name === "private";
    case 8:
      return name === "continue" || name === "debugger" || name === "function";
    case 9:
      return name === "interface" || name === "protected";
    case 10:
      return name === "implements" || name === "instanceof";
  }
  return false;
}

/**
 * Determine if the given name is a legal variable name.
 *
 * This is needed when transforming TypeScript enums; if an enum key is a valid
 * variable name, it might be referenced later in the enum, so we need to
 * declare a variable.
 */
export default function isIdentifier(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  if (!IS_IDENTIFIER_START[name.charCodeAt(0)]) {
    return false;
  }
  for (let i = 1; i < name.length; i++) {
    if (!IS_IDENTIFIER_CHAR[name.charCodeAt(i)]) {
      return false;
    }
  }
  return !isReservedWord(name);
}
