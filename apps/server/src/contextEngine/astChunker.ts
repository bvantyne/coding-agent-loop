import { createHash } from "node:crypto";
import path from "node:path";

import ts from "typescript";

import type { CodeChunk, CodeChunkType } from "./types.ts";

const MIN_CHUNK_TOKENS = 50;
const MAX_CHUNK_TOKENS = 1_500;

interface ImportDependency {
  readonly modulePath: string;
  readonly statementText: string;
  readonly localNames: ReadonlySet<string>;
  readonly isSideEffectOnly: boolean;
}

interface SourceCandidate {
  readonly filePath: string;
  readonly orderStart: number;
  readonly sourceEnd: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly code: string;
  readonly chunkType: CodeChunkType;
  readonly exports: ReadonlyArray<string>;
  readonly importDependencies: ReadonlyArray<ImportDependency>;
  readonly identifiers: ReadonlySet<string>;
  readonly explicitImportModules: ReadonlySet<string>;
  readonly coalescible: boolean;
  readonly splitKind: "class" | "object" | null;
  readonly classNode?: ts.ClassDeclaration;
  readonly objectNode?: ts.ObjectLiteralExpression;
}

interface MaterializedCandidate {
  readonly filePath: string;
  readonly orderStart: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly code: string;
  readonly chunkType: CodeChunkType;
  readonly exports: ReadonlyArray<string>;
  readonly imports: ReadonlyArray<string>;
  readonly importStatements: ReadonlyArray<string>;
  readonly coalescible: boolean;
  readonly tokenCount: number;
}

interface BuildChunkContentInput {
  readonly filePath: string;
  readonly importStatements: ReadonlyArray<string>;
  readonly code: string;
}

function countTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return ts.getLineAndCharacterOfPosition(sourceFile, position).line + 1;
}

function toUnique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function buildChunkId(filePath: string, startLine: number, endLine: number): string {
  return createHash("sha256").update(`${filePath}:${startLine}:${endLine}`).digest("hex");
}

function buildChunkContent({ filePath, importStatements, code }: BuildChunkContentInput): string {
  const header = [`// file: ${filePath}`];
  if (importStatements.length > 0) {
    header.push(...importStatements);
  }
  return `${header.join("\n")}\n\n${code.trim()}`;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(modifiers?.some((modifier) => modifier.kind === kind));
}

function getNodeContentStart(node: ts.Node, sourceFile: ts.SourceFile): number {
  const commentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  if (commentRanges.length > 0) {
    return commentRanges[0]?.pos ?? node.getStart(sourceFile);
  }
  return node.getStart(sourceFile);
}

function collectBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  const names: string[] = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }
    names.push(...collectBindingNames(element.name));
  }
  return names;
}

function collectIdentifiers(node: ts.Node): Set<string> {
  const identifiers = new Set<string>();

  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current)) {
      identifiers.add(current.text);
    }
    current.forEachChild(visit);
  };

  visit(node);
  return identifiers;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function expressionHasPropertyAccess(
  expression: ts.Node,
  rootName: string,
  propertyName?: string,
): boolean {
  const visit = (current: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(current)) {
      if (ts.isIdentifier(current.expression) && current.expression.text === rootName) {
        if (!propertyName || current.name.text === propertyName) {
          return true;
        }
      }
      if (visit(current.expression) || visit(current.name)) {
        return true;
      }
    }

    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      if (visit(current.expression)) {
        return true;
      }
      return current.arguments?.some(visit) ?? false;
    }

    let found = false;
    current.forEachChild((child) => {
      if (!found && visit(child)) {
        found = true;
      }
    });
    return found;
  };

  return visit(expression);
}

function isLayerExpression(expression: ts.Node): boolean {
  return expressionHasPropertyAccess(expression, "Layer");
}

function isServiceExpression(expression: ts.Node): boolean {
  return (
    expressionHasPropertyAccess(expression, "Effect", "Service") ||
    expressionHasPropertyAccess(expression, "ServiceMap", "Service")
  );
}

function hasJsxDescendant(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current)
    ) {
      found = true;
      return;
    }
    current.forEachChild((child) => {
      if (!found) {
        visit(child);
      }
    });
  };
  visit(node);
  return found;
}

function isFunctionLikeInitializer(initializer: ts.Expression): boolean {
  const unwrapped = unwrapExpression(initializer);
  return (
    ts.isArrowFunction(unwrapped) ||
    ts.isFunctionExpression(unwrapped) ||
    ts.isClassExpression(unwrapped) ||
    hasJsxDescendant(unwrapped)
  );
}

function findSplitObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped.properties.length > 0 ? unwrapped : undefined;
  }

  if (ts.isCallExpression(unwrapped) || ts.isNewExpression(unwrapped)) {
    for (const argument of unwrapped.arguments ?? []) {
      const fromArgument = findSplitObjectLiteral(argument);
      if (fromArgument) {
        return fromArgument;
      }
    }
    return findSplitObjectLiteral(unwrapped.expression as ts.Expression);
  }

  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return findSplitObjectLiteral(unwrapped.expression);
  }

  if (ts.isBinaryExpression(unwrapped)) {
    return findSplitObjectLiteral(unwrapped.right);
  }

  if (ts.isConditionalExpression(unwrapped)) {
    return (
      findSplitObjectLiteral(unwrapped.whenTrue) ?? findSplitObjectLiteral(unwrapped.whenFalse)
    );
  }

  return undefined;
}

function classifyVariableStatement(statement: ts.VariableStatement): {
  readonly chunkType: CodeChunkType;
  readonly splitKind: "object" | null;
  readonly objectNode?: ts.ObjectLiteralExpression;
} {
  const declarations = statement.declarationList.declarations;
  const initializers = declarations
    .map((declaration) => declaration.initializer)
    .filter((initializer): initializer is ts.Expression => initializer !== undefined);

  for (const initializer of initializers) {
    if (isLayerExpression(initializer)) {
      const objectNode = findSplitObjectLiteral(initializer);
      return {
        chunkType: "layer",
        splitKind: objectNode ? "object" : null,
        ...(objectNode ? { objectNode } : {}),
      };
    }
  }

  for (const initializer of initializers) {
    if (isServiceExpression(initializer)) {
      const objectNode = findSplitObjectLiteral(initializer);
      return {
        chunkType: "service",
        splitKind: objectNode ? "object" : null,
        ...(objectNode ? { objectNode } : {}),
      };
    }
  }

  const splitObject =
    initializers
      .map((initializer) => findSplitObjectLiteral(initializer))
      .find(
        (objectLiteral): objectLiteral is ts.ObjectLiteralExpression => objectLiteral !== undefined,
      ) ?? undefined;

  if (initializers.some((initializer) => isFunctionLikeInitializer(initializer))) {
    return {
      chunkType: "function",
      splitKind: null,
    };
  }

  return {
    chunkType: "const",
    splitKind: splitObject ? "object" : null,
    ...(splitObject ? { objectNode: splitObject } : {}),
  };
}

function classifyStatement(statement: ts.Statement): {
  readonly chunkType: CodeChunkType;
  readonly splitKind: "class" | "object" | null;
  readonly classNode?: ts.ClassDeclaration;
  readonly objectNode?: ts.ObjectLiteralExpression;
} {
  if (ts.isFunctionDeclaration(statement)) {
    return { chunkType: "function", splitKind: null };
  }

  if (ts.isClassDeclaration(statement)) {
    return {
      chunkType:
        (statement.heritageClauses?.some((clause) =>
          clause.types.some((typeNode) => isServiceExpression(typeNode.expression)),
        ) ?? false)
          ? "service"
          : "class",
      splitKind: statement.members.length > 0 ? "class" : null,
      classNode: statement,
    };
  }

  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return { chunkType: "type", splitKind: null };
  }

  if (ts.isVariableStatement(statement)) {
    return classifyVariableStatement(statement);
  }

  return { chunkType: "other", splitKind: null };
}

function collectImportDependencies(
  sourceFile: ts.SourceFile,
  sourceText: string,
): ReadonlyArray<ImportDependency> {
  const dependencies: ImportDependency[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const modulePath = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : statement.moduleSpecifier.getText(sourceFile).slice(1, -1);
    const clause = statement.importClause;
    const localNames = new Set<string>();
    if (clause?.name) {
      localNames.add(clause.name.text);
    }
    if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        localNames.add(clause.namedBindings.name.text);
      } else {
        for (const element of clause.namedBindings.elements) {
          localNames.add(element.name.text);
        }
      }
    }

    dependencies.push({
      modulePath,
      statementText: sourceText.slice(statement.getStart(sourceFile), statement.getEnd()).trim(),
      localNames,
      isSideEffectOnly: !clause,
    });
  }

  return dependencies;
}

function collectExportNames(statement: ts.Statement): ReadonlyArray<string> {
  const exportedNames = new Set<string>();
  const isDefaultExport = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
  if (isDefaultExport) {
    exportedNames.add("default");
  }

  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && statement.name) {
      exportedNames.add(statement.name.text);
    }
    return [...exportedNames];
  }

  if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    for (const declaration of statement.declarationList.declarations) {
      for (const name of collectBindingNames(declaration.name)) {
        exportedNames.add(name);
      }
    }
    return [...exportedNames];
  }

  if (ts.isExportAssignment(statement)) {
    exportedNames.add("default");
    return [...exportedNames];
  }

  if (ts.isExportDeclaration(statement)) {
    if (!statement.exportClause) {
      exportedNames.add("*");
      return [...exportedNames];
    }
    if (ts.isNamespaceExport(statement.exportClause)) {
      exportedNames.add(statement.exportClause.name.text);
      return [...exportedNames];
    }
    for (const element of statement.exportClause.elements) {
      exportedNames.add(element.name.text);
    }
  }

  return [...exportedNames];
}

function resolveCandidateImports(
  dependencies: ReadonlyArray<ImportDependency>,
  identifiers: ReadonlySet<string>,
  explicitImportModules: ReadonlySet<string>,
): {
  readonly imports: ReadonlyArray<string>;
  readonly importStatements: ReadonlyArray<string>;
} {
  const imports = [...explicitImportModules];
  const importStatements: string[] = [];

  for (const dependency of dependencies) {
    const shouldInclude =
      dependency.isSideEffectOnly ||
      explicitImportModules.has(dependency.modulePath) ||
      [...dependency.localNames].some((name) => identifiers.has(name));

    if (!shouldInclude) {
      continue;
    }

    if (!imports.includes(dependency.modulePath)) {
      imports.push(dependency.modulePath);
    }
    importStatements.push(dependency.statementText);
  }

  return { imports, importStatements };
}

function buildMaterializedCandidate(
  filePath: string,
  orderStart: number,
  startLine: number,
  endLine: number,
  code: string,
  chunkType: CodeChunkType,
  exports: ReadonlyArray<string>,
  dependencies: ReadonlyArray<ImportDependency>,
  identifiers: ReadonlySet<string>,
  explicitImportModules: ReadonlySet<string>,
  coalescible: boolean,
): MaterializedCandidate {
  const { imports, importStatements } = resolveCandidateImports(
    dependencies,
    identifiers,
    explicitImportModules,
  );
  const content = buildChunkContent({ filePath, importStatements, code });
  return {
    filePath,
    orderStart,
    startLine,
    endLine,
    code: code.trim(),
    chunkType,
    exports,
    imports,
    importStatements,
    coalescible,
    tokenCount: countTokens(content),
  };
}

function splitClassCandidate(
  candidate: SourceCandidate,
  sourceFile: ts.SourceFile,
): ReadonlyArray<SourceCandidate> {
  const classNode = candidate.classNode;
  if (!classNode || classNode.members.length <= 1) {
    return [candidate];
  }

  const [firstMember] = classNode.members;
  const lastMember = classNode.members[classNode.members.length - 1];
  if (!firstMember || !lastMember) {
    return [candidate];
  }

  const prefix = sourceFile.text.slice(candidate.orderStart, firstMember.getFullStart());
  const suffix = sourceFile.text.slice(lastMember.getEnd(), classNode.getEnd());
  const classIdentifiers = collectIdentifiers(classNode);
  const chunks: SourceCandidate[] = [];
  let groupStartIndex = 0;

  while (groupStartIndex < classNode.members.length) {
    let groupEndIndex = groupStartIndex;
    let acceptedCode = "";

    while (groupEndIndex < classNode.members.length) {
      const startMember = classNode.members[groupStartIndex];
      const endMember = classNode.members[groupEndIndex];
      if (!startMember || !endMember) {
        break;
      }

      const code = `${prefix}${sourceFile.text.slice(startMember.getFullStart(), endMember.getEnd())}${suffix}`;
      const materialized = buildMaterializedCandidate(
        candidate.filePath,
        startMember.getStart(sourceFile),
        groupStartIndex === 0
          ? candidate.startLine
          : lineOf(sourceFile, startMember.getStart(sourceFile)),
        lineOf(sourceFile, endMember.getEnd()),
        code,
        candidate.chunkType,
        candidate.exports,
        candidate.importDependencies,
        classIdentifiers,
        candidate.explicitImportModules,
        false,
      );

      if (materialized.tokenCount > MAX_CHUNK_TOKENS && groupEndIndex > groupStartIndex) {
        break;
      }

      acceptedCode = code;
      groupEndIndex += 1;

      if (materialized.tokenCount > MAX_CHUNK_TOKENS) {
        break;
      }
    }

    const endIndexExclusive =
      groupEndIndex === groupStartIndex ? groupStartIndex + 1 : groupEndIndex;
    const startMember = classNode.members[groupStartIndex];
    const endMember = classNode.members[endIndexExclusive - 1];
    if (!startMember || !endMember) {
      break;
    }

    chunks.push({
      ...candidate,
      orderStart: startMember.getStart(sourceFile),
      sourceEnd: endMember.getEnd(),
      startLine:
        groupStartIndex === 0
          ? candidate.startLine
          : lineOf(sourceFile, startMember.getStart(sourceFile)),
      endLine: lineOf(sourceFile, endMember.getEnd()),
      code: acceptedCode,
      coalescible: false,
      splitKind: null,
    });

    groupStartIndex = endIndexExclusive;
  }

  return chunks.length > 0 ? chunks : [candidate];
}

function splitObjectCandidate(
  candidate: SourceCandidate,
  sourceFile: ts.SourceFile,
): ReadonlyArray<SourceCandidate> {
  const objectNode = candidate.objectNode;
  if (!objectNode || objectNode.properties.length <= 1) {
    return [candidate];
  }

  const [firstProperty] = objectNode.properties;
  const lastProperty = objectNode.properties[objectNode.properties.length - 1];
  if (!firstProperty || !lastProperty) {
    return [candidate];
  }

  const prefix = sourceFile.text.slice(candidate.orderStart, firstProperty.getFullStart());
  const suffix = sourceFile.text.slice(lastProperty.getEnd(), candidate.sourceEnd);
  const chunks: SourceCandidate[] = [];
  let groupStartIndex = 0;

  while (groupStartIndex < objectNode.properties.length) {
    let groupEndIndex = groupStartIndex;
    let acceptedCode = "";

    while (groupEndIndex < objectNode.properties.length) {
      const startProperty = objectNode.properties[groupStartIndex];
      const endProperty = objectNode.properties[groupEndIndex];
      if (!startProperty || !endProperty) {
        break;
      }

      const code = `${prefix}${sourceFile.text.slice(startProperty.getFullStart(), endProperty.getEnd())}${suffix}`;
      const materialized = buildMaterializedCandidate(
        candidate.filePath,
        startProperty.getStart(sourceFile),
        groupStartIndex === 0
          ? candidate.startLine
          : lineOf(sourceFile, startProperty.getStart(sourceFile)),
        lineOf(sourceFile, endProperty.getEnd()),
        code,
        candidate.chunkType,
        candidate.exports,
        candidate.importDependencies,
        candidate.identifiers,
        candidate.explicitImportModules,
        false,
      );

      if (materialized.tokenCount > MAX_CHUNK_TOKENS && groupEndIndex > groupStartIndex) {
        break;
      }

      acceptedCode = code;
      groupEndIndex += 1;

      if (materialized.tokenCount > MAX_CHUNK_TOKENS) {
        break;
      }
    }

    const endIndexExclusive =
      groupEndIndex === groupStartIndex ? groupStartIndex + 1 : groupEndIndex;
    const startProperty = objectNode.properties[groupStartIndex];
    const endProperty = objectNode.properties[endIndexExclusive - 1];
    if (!startProperty || !endProperty) {
      break;
    }

    chunks.push({
      ...candidate,
      orderStart: startProperty.getStart(sourceFile),
      sourceEnd: endProperty.getEnd(),
      startLine:
        groupStartIndex === 0
          ? candidate.startLine
          : lineOf(sourceFile, startProperty.getStart(sourceFile)),
      endLine: lineOf(sourceFile, endProperty.getEnd()),
      code: acceptedCode,
      coalescible: false,
      splitKind: null,
    });

    groupStartIndex = endIndexExclusive;
  }

  return chunks.length > 0 ? chunks : [candidate];
}

function splitOversizedCandidates(
  candidates: ReadonlyArray<SourceCandidate>,
  sourceFile: ts.SourceFile,
): ReadonlyArray<SourceCandidate> {
  const split: SourceCandidate[] = [];

  for (const candidate of candidates) {
    const materialized = buildMaterializedCandidate(
      candidate.filePath,
      candidate.orderStart,
      candidate.startLine,
      candidate.endLine,
      candidate.code,
      candidate.chunkType,
      candidate.exports,
      candidate.importDependencies,
      candidate.identifiers,
      candidate.explicitImportModules,
      candidate.coalescible,
    );

    if (materialized.tokenCount <= MAX_CHUNK_TOKENS) {
      split.push(candidate);
      continue;
    }

    if (candidate.splitKind === "class") {
      split.push(...splitClassCandidate(candidate, sourceFile));
      continue;
    }

    if (candidate.splitKind === "object") {
      split.push(...splitObjectCandidate(candidate, sourceFile));
      continue;
    }

    split.push(candidate);
  }

  return split;
}

function materializeCandidates(
  _sourceFile: ts.SourceFile,
  candidates: ReadonlyArray<SourceCandidate>,
): ReadonlyArray<MaterializedCandidate> {
  return candidates.map((candidate) => {
    return buildMaterializedCandidate(
      candidate.filePath,
      candidate.orderStart,
      candidate.startLine,
      candidate.endLine,
      candidate.code,
      candidate.chunkType,
      candidate.exports,
      candidate.importDependencies,
      candidate.identifiers,
      candidate.explicitImportModules,
      candidate.coalescible,
    );
  });
}

function coalesceTinyCandidates(
  candidates: ReadonlyArray<MaterializedCandidate>,
): ReadonlyArray<MaterializedCandidate> {
  const merged: MaterializedCandidate[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    let current = candidates[index];
    if (!current) {
      continue;
    }

    if (current.tokenCount >= MIN_CHUNK_TOKENS || !current.coalescible) {
      merged.push(current);
      continue;
    }

    let nextIndex = index + 1;
    while (current.tokenCount < MIN_CHUNK_TOKENS && nextIndex < candidates.length) {
      const next = candidates[nextIndex];
      if (!next || !next.coalescible || next.filePath !== current.filePath) {
        break;
      }

      const chunkType: CodeChunkType =
        current.chunkType === next.chunkType ? current.chunkType : "other";
      const importStatements = toUnique([...current.importStatements, ...next.importStatements]);
      const imports = toUnique([...current.imports, ...next.imports]);
      const content = buildChunkContent({
        filePath: current.filePath,
        importStatements,
        code: `${current.code}\n\n${next.code}`,
      });

      current = {
        filePath: current.filePath,
        orderStart: current.orderStart,
        startLine: current.startLine,
        endLine: next.endLine,
        code: `${current.code}\n\n${next.code}`,
        chunkType,
        exports: toUnique([...current.exports, ...next.exports]),
        imports,
        importStatements,
        coalescible: true,
        tokenCount: countTokens(content),
      };
      nextIndex += 1;
    }

    merged.push(current);
    index = nextIndex - 1;
  }

  return merged;
}

function toCodeChunk(candidate: MaterializedCandidate): CodeChunk {
  const content = buildChunkContent({
    filePath: candidate.filePath,
    importStatements: candidate.importStatements,
    code: candidate.code,
  });

  return {
    id: buildChunkId(candidate.filePath, candidate.startLine, candidate.endLine),
    filePath: candidate.filePath,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    content,
    chunkType: candidate.chunkType,
    exports: candidate.exports,
    imports: candidate.imports,
    tokenCount: countTokens(content),
  };
}

function buildSourceCandidates(
  sourceFile: ts.SourceFile,
  sourceText: string,
  filePath: string,
): ReadonlyArray<SourceCandidate> {
  const dependencies = collectImportDependencies(sourceFile, sourceText);
  const candidates: SourceCandidate[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      continue;
    }

    const contentStart = getNodeContentStart(statement, sourceFile);
    const code = sourceText.slice(contentStart, statement.getEnd()).trim();
    if (code.length === 0) {
      continue;
    }

    const classification = classifyStatement(statement);
    candidates.push({
      filePath,
      orderStart: contentStart,
      sourceEnd: statement.getEnd(),
      startLine: lineOf(sourceFile, contentStart),
      endLine: lineOf(sourceFile, statement.getEnd()),
      code,
      chunkType: classification.chunkType,
      exports: collectExportNames(statement),
      importDependencies: dependencies,
      identifiers: collectIdentifiers(statement),
      explicitImportModules:
        ts.isExportDeclaration(statement) && statement.moduleSpecifier
          ? new Set([statement.moduleSpecifier.getText(sourceFile).slice(1, -1)])
          : new Set<string>(),
      coalescible:
        classification.splitKind === null &&
        (classification.chunkType === "type" ||
          classification.chunkType === "const" ||
          classification.chunkType === "other"),
      splitKind: classification.splitKind,
      ...(classification.classNode ? { classNode: classification.classNode } : {}),
      ...(classification.objectNode ? { objectNode: classification.objectNode } : {}),
    });
  }

  return candidates;
}

export function chunkTypeScriptFile(input: {
  readonly filePath: string;
  readonly content: string;
}): ReadonlyArray<CodeChunk> {
  const filePath = toPosixPath(input.filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const sourceCandidates = buildSourceCandidates(sourceFile, input.content, filePath);
  const splitCandidates = splitOversizedCandidates(sourceCandidates, sourceFile);
  const materialized = materializeCandidates(sourceFile, splitCandidates)
    .toSorted((left, right) => left.orderStart - right.orderStart)
    .filter((candidate) => candidate.code.length > 0);
  return coalesceTinyCandidates(materialized).map(toCodeChunk);
}

export const CHUNK_TOKEN_LIMITS = {
  min: MIN_CHUNK_TOKENS,
  max: MAX_CHUNK_TOKENS,
} as const;
