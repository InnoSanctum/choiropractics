import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

// Exercise the actual audio modules in Node without adding a runtime dependency.
const cache = new Map();
export function loadTypescript(filename) {
  const path = resolve(filename);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} };
  cache.set(path, module);
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const require = createRequire(path);
  const localRequire = specifier => specifier.startsWith('.')
    ? loadTypescript(resolve(dirname(path), `${specifier}.ts`))
    : require(specifier);
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports;
}
