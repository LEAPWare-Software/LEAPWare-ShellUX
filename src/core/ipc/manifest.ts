import type {
  Command,
  CommandCategory,
  CommandSurface,
  ExtensionViews,
  Hotkey,
  LEAPExtensionBlueprint,
  NavigationNode,
} from '../types';
import { ShellUXError } from '../types';
import { deepFreeze } from '../ShellAPI';

/**
 * ============================================================================
 * THE BLUEPRINT SPLITS AT THE PROCESS BOUNDARY — AND THE AUTHOR NEVER SEES IT
 * ============================================================================
 * An extension author writes ONE object, exactly as they always have. What
 * changes under a process split is that half of it cannot cross: a React
 * component is a function, `isVisible` is a closure, `onExecute` is a closure,
 * and structured clone refuses every one of them. *Tests:*
 * `src/core/ipc/__tests__/portLike.test.ts` — "a port that clones refuses a
 * React component reference outright".
 *
 * So the split happens here, once, and neither end has to know about it:
 *
 * | Stays PANE-LOCAL | Crosses as `ExtensionManifest` |
 * |---|---|
 * | `views.pane2`, `views.pane3` | `id`, `name`, `version` |
 * | `Command.isVisible` | `navigationTree` |
 * | `Command.onExecute` | `id`/`label`/`icon`/`hotkey`/`category`/`surfaces`/`priority` per command |
 * | | `Command.when` |
 *
 * **`when` is what makes the right-hand column possible, and §3.5 is where the
 * reasoning lives.** `isVisible` is a synchronous render-phase boolean and
 * cannot cross a boundary; three of the four command surfaces are host chrome
 * evaluating predicates for commands whose code lives in a pane. A declarative
 * expression over `RibbonContext` can be evaluated by the host against its own
 * replica, because `ContextKeyValue` is primitives only — the constraint written
 * for render-phase-getter reasons turning out to be what makes the transport
 * free. `src/core/commands/when.ts` is that parser and it is already at 100%.
 *
 * ---------------------------------------------------------------------------
 * WHY `whenExpression` DOES NOT CROSS, THOUGH IT COULD
 * ---------------------------------------------------------------------------
 * `Command.whenExpression` is a tree of plain objects and would survive a
 * structured clone perfectly well. It is deliberately left behind, and the
 * reason is the one its own docblock gives: **it is HOST-DERIVED, and an
 * extension never declares it.** A parsed tree arriving from a renderer would be
 * a tree main did not derive, evaluated by main, against main's own context —
 * which is a wider route into the host's predicate evaluation than the string it
 * was parsed from. Main re-parses `when` with `parseWhen`, in the process that
 * evaluates it, so the only thing a renderer can influence is the 512 characters
 * the registry already validates.
 *
 * That is the same posture `AuthoritativeStore` takes towards a write: the
 * renderer's own work is not trusted, and redoing it is cheap.
 *
 * ---------------------------------------------------------------------------
 * CONSTRUCTED, NOT FILTERED
 * ---------------------------------------------------------------------------
 * The manifest is BUILT field by field from a fixed list. It is not the
 * blueprint with the dangerous parts deleted, and the difference is the one
 * `normalizeNavigationNode` makes in `RegistryContext.tsx`: a filter has to
 * anticipate everything that might be there, and a constructor only has to
 * name what is wanted. A field added to `LEAPExtensionBlueprint` tomorrow does
 * not silently start crossing.
 *
 * `assertSerializable` is therefore a SECOND line, and it is here rather than
 * left to the transport for the reason ADR-0002 gives about written rules with
 * no checker: `structuredClone` would refuse a function too, but it would do it
 * with a `DataCloneError` naming nothing, from inside a port callback, at a
 * moment when the useful information — WHICH field of WHICH command — is gone.
 * A typed `ShellUXError` with the dotted path is what a extension author can act
 * on. *Tests:* `src/core/ipc/__tests__/manifest.test.ts` — "refuses a component
 * reference smuggled onto a navigation node, and names where it was" and "the
 * transport would have refused it too, with nothing useful to say".
 * ============================================================================
 */

/**
 * One command, as it crosses to main.
 *
 * Every member is `Command`'s, minus the two functions and the derived tree.
 * Optional members are copied UNCONDITIONALLY — an absent one arrives as an own
 * property holding `undefined`, which structured clone carries and which reads
 * identically. Copying them behind a presence test would add a branch per field
 * to buy a marginally tidier object, and the coverage gate would then need a
 * test per field asserting that absence is absent.
 *
 * Each is therefore spelled `?: T | undefined` rather than `?: T`, because this
 * repository compiles with `exactOptionalPropertyTypes`, under which the two are
 * different types and only the first admits an explicitly-undefined member. That
 * is the compiler making the decision above visible in the declaration rather
 * than leaving it in a comment.
 */
export interface CommandManifestEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly isDisabled?: boolean | undefined;
  readonly hotkey?: Hotkey | undefined;
  /** The declarative predicate. Re-parsed by main; see the banner. */
  readonly when?: string | undefined;
  readonly category?: CommandCategory | undefined;
  readonly surfaces?: readonly CommandSurface[] | undefined;
  readonly priority?: number | undefined;
}

/** One extension, as main knows it. Structured-clone-safe by construction. */
export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly navigationTree: readonly NavigationNode[];
  readonly commands: readonly CommandManifestEntry[];
}

/**
 * The half of a blueprint that cannot leave the pane, and does not need to.
 *
 * `handlers` is keyed by command id because that is the only thing main can send
 * back: `onExecute` stays here and is invoked BY ID, fire-and-forget, which is
 * §3.5's third bullet. A `Map` rather than a record, for the reason the registry
 * uses `Map`s — the keys originate in a plug-in manifest.
 */
export interface PaneLocalBlueprint {
  readonly id: string;
  readonly views: ExtensionViews;
  readonly handlers: ReadonlyMap<string, Command>;
}

/** What `splitBlueprint` returns: the two halves, and nothing shared. */
export interface BlueprintSplit {
  readonly manifest: ExtensionManifest;
  readonly paneLocal: PaneLocalBlueprint;
}

/**
 * Assert that everything reachable from `value` can cross a structured-clone
 * boundary.
 *
 * Refuses a function, a symbol, and a cycle. Those are exactly what
 * `structuredClone` refuses, reported early and with a dotted path.
 *
 * The `seen` set tracks the CURRENT PATH rather than everything visited — added
 * on the way down and removed on the way back up — so a value that legitimately
 * appears twice in two different branches is not mistaken for a cycle. That
 * distinction is not pedantic: a manifest whose commands share one frozen
 * `surfaces` array is ordinary, and reporting it as a cycle would refuse a
 * perfectly serializable extension.
 *
 * @throws {ShellUXError} `INVALID_FIELD`, naming the path that cannot cross.
 */
export function assertSerializable(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === null) {
    return;
  }
  const kind = typeof value;
  if (kind === 'function' || kind === 'symbol') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `splitBlueprint: "${path}" holds a value of type "${kind}", which cannot cross a process boundary. Components and handlers stay pane-local.`,
      path,
    );
  }
  if (kind !== 'object') {
    return;
  }
  const object = value as object;
  if (seen.has(object)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `splitBlueprint: "${path}" closes a cycle. A cycle is rejected rather than truncated.`,
      path,
    );
  }
  seen.add(object);
  if (Array.isArray(object)) {
    for (let index = 0; index < object.length; index += 1) {
      assertSerializable(object[index], `${path}[${String(index)}]`, seen);
    }
  } else {
    for (const [key, held] of Object.entries(object)) {
      assertSerializable(held, `${path}.${key}`, seen);
    }
  }
  seen.delete(object);
}

/** Build one command's serializable half. */
function manifestCommand(command: Command): CommandManifestEntry {
  return {
    id: command.id,
    label: command.label,
    icon: command.icon,
    isDisabled: command.isDisabled,
    hotkey: command.hotkey,
    when: command.when,
    category: command.category,
    surfaces: command.surfaces,
    priority: command.priority,
    // `isVisible`, `onExecute` and `whenExpression` are absent by CONSTRUCTION.
    // There is no delete here and there is nothing to forget to delete.
  };
}

/**
 * Split one host-owned blueprint into what crosses and what stays.
 *
 * The input is the registry's NORMALISED record — `LEAPExtensionBlueprint`, not
 * `LEAPExtensionBlueprintInput` — so every string has already been through
 * `EXTENSION_ID_PATTERN`, every tree through `normalizeNavigationNode`, and
 * every command through `normalizeRibbonAction`. This function adds no
 * validation of its own about CONTENT and one about SHAPE: that what it built
 * can actually cross.
 *
 * Both halves are deep-frozen, and what that buys differs between them. The
 * manifest is a plain data graph, so the freeze reaches all of it: it is about
 * to be handed to a transport and then held by main as the authoritative record
 * of what this extension declares. The pane-local half is frozen as an OBJECT —
 * its three bindings cannot be replaced — but `handlers` is a `Map`, and a
 * `Map`'s entries are not own properties, so `Object.freeze` does not seal them
 * and `handlers.set` still works. That is stated rather than glossed, per
 * ADR-0001 Amendment G: the guarantee here is "nobody swaps the views object or
 * the handler table", not "nobody can add a handler". `deepFreeze` is total and
 * never throws — see its docblock in `ShellAPI.ts`.
 *
 * @throws {ShellUXError} `INVALID_FIELD` when anything in the manifest could not
 *   cross a process boundary.
 */
export function splitBlueprint(blueprint: LEAPExtensionBlueprint): BlueprintSplit {
  const manifest: ExtensionManifest = {
    id: blueprint.id,
    name: blueprint.name,
    version: blueprint.version,
    navigationTree: blueprint.navigationTree,
    commands: blueprint.commands.map(manifestCommand),
  };
  assertSerializable(manifest, 'manifest');

  const handlers = new Map<string, Command>();
  for (const command of blueprint.commands) {
    handlers.set(command.id, command);
  }

  return {
    manifest: deepFreeze(manifest),
    paneLocal: deepFreeze({
      id: blueprint.id,
      views: blueprint.views,
      handlers,
    }),
  };
}
