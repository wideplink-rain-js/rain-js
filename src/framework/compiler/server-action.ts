import {
  type Block,
  createSourceFile,
  isArrowFunction,
  isBlock,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isStringLiteral,
  isVariableStatement,
  type Node,
  ScriptTarget,
  SyntaxKind,
} from "typescript";

export interface ServerFunction {
  readonly name: string;
  readonly isExported: boolean;
  readonly isAsync: boolean;
}

function hasModifier(
  node: Node & { modifiers?: readonly Node[] },
  kind: SyntaxKind,
): boolean {
  return node.modifiers?.some((m) => m.kind === kind) ?? false;
}

function hasUseServerInBody(body: Block | undefined): boolean {
  if (!body || body.statements.length === 0) return false;
  const first = body.statements[0];
  if (!first) return false;
  return (
    isExpressionStatement(first) &&
    isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function isFileUseServer(source: string): boolean {
  const sf = createSourceFile("check.tsx", source, ScriptTarget.Latest, true);
  const first = sf.statements[0];
  if (!first) return false;
  return (
    isExpressionStatement(first) &&
    isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function isServerFunctionDecl(
  stmt: import("typescript").FunctionDeclaration,
  fileLevel: boolean,
): boolean {
  if (fileLevel && hasModifier(stmt, SyntaxKind.ExportKeyword)) {
    return true;
  }
  return hasUseServerInBody(stmt.body);
}

function extractFromFunctionDecl(
  stmt: import("typescript").FunctionDeclaration,
  fileLevel: boolean,
): ServerFunction | null {
  if (!stmt.name) return null;
  if (!isServerFunctionDecl(stmt, fileLevel)) return null;
  return {
    name: stmt.name.text,
    isExported: hasModifier(stmt, SyntaxKind.ExportKeyword),
    isAsync: hasModifier(stmt, SyntaxKind.AsyncKeyword),
  };
}

function isServerVarInit(
  init:
    | import("typescript").ArrowFunction
    | import("typescript").FunctionExpression,
  stmtExported: boolean,
  fileLevel: boolean,
): boolean {
  if (fileLevel && stmtExported) return true;
  const body = init.body;
  return isBlock(body) && hasUseServerInBody(body);
}

function extractFromVariableStatement(
  stmt: import("typescript").VariableStatement,
  fileLevel: boolean,
): ServerFunction[] {
  const stmtExported = hasModifier(stmt, SyntaxKind.ExportKeyword);
  const results: ServerFunction[] = [];

  for (const decl of stmt.declarationList.declarations) {
    if (!(decl.name && isIdentifier(decl.name))) continue;
    const init = decl.initializer;
    if (!init) continue;
    if (!(isArrowFunction(init) || isFunctionExpression(init))) continue;
    if (!isServerVarInit(init, stmtExported, fileLevel)) continue;

    results.push({
      name: decl.name.text,
      isExported: stmtExported,
      isAsync: hasModifier(init, SyntaxKind.AsyncKeyword),
    });
  }

  return results;
}

export function extractServerFunctions(source: string): ServerFunction[] {
  const sf = createSourceFile("file.tsx", source, ScriptTarget.Latest, true);

  const fileLevel = isFileUseServer(source);
  const results: ServerFunction[] = [];

  for (const stmt of sf.statements) {
    if (isFunctionDeclaration(stmt)) {
      const fn = extractFromFunctionDecl(stmt, fileLevel);
      if (fn) results.push(fn);
    }

    if (isVariableStatement(stmt)) {
      results.push(...extractFromVariableStatement(stmt, fileLevel));
    }
  }

  return results;
}

export function generateActionId(
  filePath: string,
  functionName: string,
): string {
  const input = `${filePath.replace(/\\/g, "/")}:${functionName}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function generateClientProxy(actionId: string): string {
  const escaped = actionId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return (
    `((formData) => fetch("/_rain/action/${escaped}",` +
    ` { method: "POST", body: formData }))`
  );
}
