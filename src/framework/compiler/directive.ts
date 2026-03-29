import {
  createSourceFile,
  isExpressionStatement,
  isStringLiteral,
  ScriptTarget,
} from "typescript";

type Directive = "use client" | "use server";

const VALID_DIRECTIVES = new Set<string>(["use client", "use server"]);

export function detectDirective(source: string): Directive | null {
  const sourceFile = createSourceFile(
    "file.tsx",
    source,
    ScriptTarget.Latest,
    true,
  );

  const firstStatement = sourceFile.statements[0];
  if (!firstStatement) return null;

  if (
    isExpressionStatement(firstStatement) &&
    isStringLiteral(firstStatement.expression) &&
    VALID_DIRECTIVES.has(firstStatement.expression.text)
  ) {
    return firstStatement.expression.text as Directive;
  }

  return null;
}

export function hasUseClientDirective(source: string): boolean {
  return detectDirective(source) === "use client";
}

export function hasUseServerDirective(source: string): boolean {
  return detectDirective(source) === "use server";
}
