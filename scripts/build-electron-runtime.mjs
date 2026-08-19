import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const sourceRoot = path.resolve("src");
const outputRoot = path.resolve("electron/generated");
const entry = path.resolve("src/integrations/pinterest/PinterestElectronComposition.ts");
const seen = new Set();

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  if (!candidate.endsWith(".ts")) return undefined;
  return candidate;
}

async function compile(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = await fs.readFile(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: false,
      sourceMap: false,
      removeComments: false,
    },
  });
  const outputFile = path.join(outputRoot, path.relative(sourceRoot, file).replace(/\.ts$/, ".cjs"));
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, result.outputText.replace(/(["'])([^"']+)\.ts\1/g, "$1$2.cjs$1"));
  const imports = [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)(["'])([^"']+)\1/g)].map((match) => match[2]);
  for (const specifier of imports) {
    const dependency = resolveImport(file, specifier);
    if (dependency) await compile(dependency);
  }
}

await fs.rm(outputRoot, { recursive: true, force: true });
await compile(entry);
console.log(`Electron Pinterest runtime compiled: ${seen.size} modules`);