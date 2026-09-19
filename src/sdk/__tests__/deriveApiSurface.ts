import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import {
  EXTENSION_ID_PATTERN,
  HOTKEY_KEYS,
  HOTKEY_MODIFIER_REQUIRED_KEYS,
  REGISTRY_LIMITS,
  RESERVED_IDS,
} from '../../core/RegistryContext';
import { canonicalSurface } from '../apiSurface';
import type { ApiSurface } from '../apiSurface';
import { HOST_API_VERSION } from '../index';
import * as sharedJsxRuntime from '../shared/react-jsx-runtime';
import * as sharedReact from '../shared/react';

/**
 * ============================================================================
 * THE CONTRACT, DERIVED FROM THE SOURCE AS IT STANDS.
 * ============================================================================
 * The other half of `../apiSurface.ts`: that file compares two descriptions;
 * this one produces the current one. Names and keys come from the TypeScript
 * checker over the real source — the SDK barrel's exports, and the members of
 * `LEAPExtensionBlueprintInput` and `IShellAPI` — because types erase and no
 * runtime reflection can see them. The shared modules' names are read from the
 * modules' namespaces, which is what a plugin's `import` receives. The allowlists, the pattern and the bounds are
 * read from the running modules, because they are values and the value is what
 * the registry enforces.
 *
 * A helper, not a test file: it lives under `__tests__/` so it is outside the
 * coverage gate and outside every build input, since it imports the compiler.
 * ============================================================================
 */

const SDK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK_INDEX = join(SDK_DIR, 'index.ts');
const CORE_TYPES = join(SDK_DIR, '..', 'core', 'types.ts');

/** The compiler options the checker needs to resolve the SDK's imports; nothing is emitted. */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  exactOptionalPropertyTypes: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

function moduleExports(checker: ts.TypeChecker, file: ts.SourceFile): ts.Symbol[] {
  const symbol = checker.getSymbolAtLocation(file);
  if (symbol === undefined) throw new Error(`the checker found no module symbol for ${file.fileName}`);
  return checker.getExportsOfModule(symbol);
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * The top-level keys of the type `name` declares in `core/types.ts`, split by
 * whether a property is optional. A union's keys are the ones every member has,
 * and a key optional in any member counts as optional — which is how
 * `LEAPExtensionBlueprintInput`'s "exactly one of `commands` and `ribbonActions`"
 * reads here: both optional. The exclusivity is not in the description, and a
 * key that only SOME members of a union carry is not in it at all — today no
 * such key exists on either type.
 */
function keysOf(checker: ts.TypeChecker, types: ts.SourceFile, name: string): { required: string[]; optional: string[] } {
  const symbol = moduleExports(checker, types).find((candidate) => candidate.name === name);
  if (symbol === undefined) throw new Error(`core/types.ts exports no ${name}`);
  const required: string[] = [];
  const optional: string[] = [];
  for (const property of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))) {
    ((property.flags & ts.SymbolFlags.Optional) !== 0 ? optional : required).push(property.name);
  }
  return { required, optional };
}

/** The current contract, in canonical form. */
export function deriveApiSurface(): ApiSurface {
  const program = ts.createProgram([SDK_INDEX, CORE_TYPES], OPTIONS);
  const checker = program.getTypeChecker();
  const sdk = program.getSourceFile(SDK_INDEX);
  const types = program.getSourceFile(CORE_TYPES);
  if (sdk === undefined || types === undefined) throw new Error('the program did not load the SDK or core/types.ts');
  // An import the checker cannot resolve does not throw: its symbol becomes
  // `any`-shaped and would be filed as a type or dropped. Any diagnostic in the
  // two files means the description below would be of a different program.
  const diagnostics = [...ts.getPreEmitDiagnostics(program, sdk), ...ts.getPreEmitDiagnostics(program, types)];
  if (diagnostics.length > 0) {
    const text = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
    throw new Error(`the checker reported ${diagnostics.length} diagnostic(s) over the SDK:\n${text}`);
  }

  const values: string[] = [];
  const typeNames: string[] = [];
  for (const exported of moduleExports(checker, sdk)) {
    const isValue = (resolveAlias(checker, exported).flags & ts.SymbolFlags.Value) !== 0;
    (isValue ? values : typeNames).push(exported.name);
  }

  return canonicalSurface({
    version: HOST_API_VERSION,
    exports: { values, types: typeNames },
    blueprint: keysOf(checker, types, 'LEAPExtensionBlueprintInput'),
    shellApi: keysOf(checker, types, 'IShellAPI'),
    // Read off the modules themselves, as a plugin's import sees them.
    sharedModules: {
      react: Object.keys(sharedReact),
      'react-jsx-runtime': Object.keys(sharedJsxRuntime),
      reactMajor: Number(sharedReact.version.split('.')[0]),
    },
    hotkeyKeys: [...HOTKEY_KEYS],
    hotkeyModifierRequiredKeys: [...HOTKEY_MODIFIER_REQUIRED_KEYS],
    extensionIdPattern: EXTENSION_ID_PATTERN.source,
    reservedIds: [...RESERVED_IDS],
    registryLimits: { ...REGISTRY_LIMITS },
  });
}
