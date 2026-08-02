import { execute, isVisible } from '../command';
import { ariaKeyShortcuts } from '../hotkeys';
import type {
  Command,
  CommandCategory,
  CommandSurface,
  IShellAPI,
  RibbonContext,
} from '../types';
import { COMMAND_CATEGORIES } from '../types';
import type { WhenNode } from './when';
import { evaluateWhen } from './when';

/**
 * ============================================================================
 * ONE REGISTRY. FOUR PROJECTIONS. THE SAME TWO GUARDS ON EVERY ONE OF THEM.
 * ============================================================================
 * The ribbon is gone and four surfaces stand where it stood — a 32px context
 * bar, a Cmd-K palette, a selection-triggered floating toolbar and a docked
 * omnibox composer. Each of them answers a different question, and every one of
 * them answers it about **the same collection, through the same filters**.
 *
 * That is the whole reason this module exists rather than four `filter` calls in
 * four components. §11 item 5 of the native-host plan — "multiple competing,
 * non-unified command surfaces. One registry or inherit the mess" — is a
 * statement about product coherence; the security half is sharper. Four
 * independent filters are four chances for one of them to offer a command the
 * other three would have hidden, and a surface that offers a hidden command is a
 * WIDER route to a plug-in handler than the surface it was licensed against. That
 * is exactly the argument ADR-0001 Amendment H Decision 1 makes for the keyboard
 * chord, four times over.
 *
 * ---------------------------------------------------------------------------
 * THE FILTER, IN ORDER, AND WHY EACH STEP IS WHERE IT IS
 * ---------------------------------------------------------------------------
 * `offer` below is the ONE function every projection funnels through. In order:
 *
 * 1. **Source.** Host commands and the FOREGROUND extension's commands. There is
 *    no third source and — see the containment block — no parameter through which
 *    one could be named.
 * 2. **`surfaces`.** A command may narrow where it is offered. It can never widen
 *    it: a surface decides what it asks for, and this field only ever removes.
 * 3. **`isVisible`**, through `isVisible` in `src/core/command.ts`. The guard, not
 *    a bare call: a throwing predicate is "not visible" and reported, a
 *    non-boolean is "not visible", and the report cannot itself escape.
 * 4. **`when`**, through `evaluateWhen`. **AND, not OR**, and that is load-bearing:
 *    ANDing means adding a `when` to an existing command can only ever narrow
 *    where it appears, so the migration cannot accidentally reveal a command a
 *    predicate was hiding. `evaluateWhen` is total — it returns a boolean and
 *    cannot throw — so it needs no guard of its own.
 * 5. **Order.** `priority` descending, stable, so a manifest that declares no
 *    priorities gets exactly the order it wrote. `INLINE_ACTION_LIMIT` in the
 *    context bar depends on that, as it always did.
 *
 * **Two tiers of visibility, and the succession is written down.** `isVisible` is
 * a closure and cannot cross a process boundary (ADR-0001:1349-1352); `when` is an
 * expression over primitives and can. Today there is one process, both run, and
 * `when` is optional. When the panes split, `when` becomes required for a command
 * appearing in host chrome and `isVisible` narrows to a pane-local fast path for
 * the floating toolbar — which is the one surface that lives in the pane process.
 * The AND survives that change unaltered; only the tier that is available moves.
 *
 * ---------------------------------------------------------------------------
 * PALETTE CONTAINMENT. THIS IS A SECURITY DECISION, NOT A UX ONE.
 * ---------------------------------------------------------------------------
 * The palette lists **the foreground extension's commands, the host's own
 * commands, and a host-owned "switch extension" verb. Nothing else.**
 *
 * Listing a BACKGROUND extension's commands would be a wider route to a plug-in
 * handler than the ribbon ever was. `onExecute` is handed a `RibbonContext` whose
 * `contextKeys` belong to whichever extension is in the foreground and whose
 * `selectedItemIds` are rows in the foreground extension's list. Handing that to a
 * backgrounded extension's handler means giving it another vendor's published
 * state and a selection that means nothing to it, at a moment the user believes
 * they are operating on what is on screen. `DUPLICATE_HOTKEY` is scoped per
 * blueprint for precisely this reason — chords are foreground-only, ADR-0001
 * Amendment H Decision 6 — and a palette that reached across extensions would
 * make that scoping arbitrary rather than principled.
 *
 * **It is enforced structurally, not by a filter.** `createCommandRegistry` takes
 * ONE extension. There is no parameter through which a second one could be named,
 * no registry lookup inside this module and no import of `RegistryContext`. A
 * cross-extension search, if it is ever wanted, is activate-then-execute: two
 * visible steps, the second of which happens after the handover has cleared the
 * selection and the context keys. *Test:* "offers no route by which a second
 * extension commands could enter a projection".
 *
 * ---------------------------------------------------------------------------
 * RECENTS ARE HOST STATE, AND THEY ARE FILTERED WHEN THEY ARE READ
 * ---------------------------------------------------------------------------
 * A recents list survives a session and an extension switch, so it will hold keys
 * belonging to an extension that is not in the foreground now, and keys for
 * commands whose predicate has since gone false. **Filtering only when a command
 * is recorded would leave exactly the hole the containment block forbids.** So
 * `recents` resolves every key against the set `offer` produced for THIS context,
 * on every read: a key that does not resolve is dropped, and it is dropped without
 * being told why, because "you have a recent command from another extension" is
 * not a fact this surface should be publishing either.
 *
 * The keys are host-minted and namespaced — `host:<id>` and `ext:<extension>:<id>`
 * — which is a second, structural reason a recent belonging to another extension
 * cannot resolve: its key names that extension, and no entry in the current set
 * carries that name. They are compared for equality and held in a `Map`; they are
 * never used as an object key, so they need no `EXTENSION_ID_PATTERN` of their own.
 * ============================================================================
 */

/**
 * How many recently-executed commands the host remembers.
 *
 * Bounded for the reason every other collection in this repository is: a list a
 * plug-in can grow by calling `onExecute` in a loop is a list that eventually
 * fills the origin's storage quota. Sixteen is chosen against what the palette
 * shows — a recents block longer than a screenful is not a shortcut any more.
 */
export const MAX_RECENT_COMMANDS = 16;

/** Max length of one persisted recents key. Bounds a hand-edited payload. */
export const MAX_RECENT_KEY_LENGTH = 160;

/**
 * A command the HOST owns. Not registry data — no predicate, no plug-in, no
 * `when`, and deliberately no `hotkey`.
 *
 * **Host chrome is not plug-in-declarable, and the absence of `hotkey` is how
 * that is spelled.** A host command's chord — Cmd-K for the palette — is
 * registered by `useHotkeyDispatch` BEFORE the extension chord table is
 * consulted, so it is unreachable by an extension declaring `{key:'k',
 * ctrl:true}`. Giving `HostCommand` a `hotkey` field would put host chords and
 * plug-in chords in one table and make that precedence a lookup order rather than
 * a structure.
 */
export interface HostCommand {
  readonly id: string;
  readonly label: string;
  /** A key into `SHELL_ICONS`, or a host-only glyph key. */
  readonly icon: string;
  readonly isDisabled?: boolean;
  readonly category?: CommandCategory;
  readonly surfaces?: readonly CommandSurface[];
  readonly priority?: number;
  /** Invoked on activation. Host code, so it is not wrapped in a guard. */
  onSelect(): void;
}

/** The foreground extension's contribution: its commands and its live handle. */
export interface ExtensionCommands {
  /** The id the registry validated. Used to namespace recents keys. */
  readonly extensionId: string;
  /** Host-owned normalised records, straight off the registry. */
  readonly commands: readonly Command[];
  /** The live, revocable handle `onExecute` is entitled to. */
  readonly shell: IShellAPI;
}

/**
 * One row, as every surface renders it.
 *
 * A flat record rather than the `Command`/`HostCommand` union, so that
 * `commandListItem.tsx` has one shape to render and cannot grow a branch that
 * treats a plug-in string differently from a host one. `run` is already bound
 * through `execute` for a plug-in command, which is what keeps the guard on the
 * one path all four surfaces share.
 */
export interface CommandEntry {
  /** Host-minted, namespaced, unique within one registry. The React key. */
  readonly key: string;
  /** The declared id. UNTRUSTED for a plug-in command. */
  readonly id: string;
  /** UNTRUSTED display text for a plug-in command. Render as a text node only. */
  readonly label: string;
  /** UNTRUSTED lookup key for a plug-in command. Resolve through `SHELL_ICONS`. */
  readonly icon: string;
  readonly isDisabled: boolean;
  /** Host-computed `aria-keyshortcuts`, or `undefined` for no announcement. */
  readonly keyShortcuts: string | undefined;
  readonly category: CommandCategory | undefined;
  readonly source: 'host' | 'extension';
  /** Already guarded. A throwing handler is reported and does not reach here. */
  run(): void;
}

/** One bucket of `listByCategory`. */
export interface CommandGroup {
  /** `null` for the trailing group of commands that declared no category. */
  readonly category: CommandCategory | null;
  /** Host-owned display text. Never a plug-in string. */
  readonly label: string;
  readonly commands: readonly CommandEntry[];
}

/**
 * Host display text for each bucket.
 *
 * `Record<CommandCategory, string>` so the compiler rejects a missing bucket and
 * an invented one, in the same shape as `SLOT_NORMALIZERS` in `HydrationEngine`.
 */
const CATEGORY_LABELS: Readonly<Record<CommandCategory, string>> = Object.freeze({
  file: 'File',
  edit: 'Edit',
  view: 'View',
  navigate: 'Navigate',
  select: 'Select',
  insert: 'Insert',
  tools: 'Tools',
  help: 'Help',
});

/** The trailing bucket's label. A command that filed itself nowhere. */
export const UNCATEGORISED_LABEL = 'Uncategorised';

export interface CommandRegistryInput {
  readonly hostCommands: readonly HostCommand[];
  /** `null` when no extension is in the foreground. */
  readonly extension: ExtensionCommands | null;
  /** Host-owned recents, most recent first. Bounded by the caller. */
  readonly recentKeys: readonly string[];
  /** Told the key of every command a surface actually ran. Host state. */
  readonly onExecuted?: (key: string) => void;
}

/** The four projections. Every one of them goes through `offer`. */
export interface CommandRegistry {
  listForSurface(surface: CommandSurface, context: Readonly<RibbonContext>): readonly CommandEntry[];
  listByCategory(context: Readonly<RibbonContext>): readonly CommandGroup[];
  /**
   * Recently executed commands that are still offered on the palette RIGHT NOW.
   *
   * **It takes the context, and that is a deliberate departure from a bare
   * `recents()`.** The guards are a function of the context; a projection with no
   * context could only return unfiltered keys, and something downstream would
   * have to run the guards over them — which is the second filter this whole
   * module exists to prevent. See the recents block in the banner.
   */
  recents(context: Readonly<RibbonContext>): readonly CommandEntry[];
  suggestedFor(context: Readonly<RibbonContext>): readonly CommandEntry[];
}

/**
 * Whether a parsed `when` tree reads the SELECTION.
 *
 * Host code over a host-owned frozen tree, so it invokes nothing a plug-in wrote.
 * Recursion is bounded by `WHEN_LIMITS.MAX_DEPTH`, enforced at parse time, which
 * is why this needs no depth counter of its own.
 */
function referencesSelection(node: WhenNode): boolean {
  switch (node.kind) {
    case 'literal':
    case 'contextKey':
      return false;
    case 'field':
      return node.field === 'selectedItemId';
    case 'inSelection':
      return true;
    case 'not':
      return referencesSelection(node.operand);
    case 'and':
    case 'or':
    case 'compare':
      return referencesSelection(node.left) || referencesSelection(node.right);
    case 'inList':
    case 'startsWith':
      return referencesSelection(node.operand);
  }
}

/** Whether a command asked for `surface`. No `surfaces` means every surface. */
function wantsSurface(
  surfaces: readonly CommandSurface[] | undefined,
  surface: CommandSurface,
): boolean {
  return surfaces === undefined || surfaces.includes(surface);
}

/**
 * The chord a command advertises to assistive technology, or `undefined`.
 *
 * TWO REASONS TO OMIT IT, AND BOTH ARE THE SAME REASON: **do not advertise what
 * will not fire.** A command with no `hotkey` has nothing to advertise. A command
 * that is DISABLED is skipped by the dispatcher — `hotkeyDispatch.ts` checks
 * `isDisabled` exactly as the shared row's own click guard does — so announcing a
 * shortcut on it would tell a screen-reader user about a key that does nothing.
 *
 * `ariaKeyShortcuts` rather than `describeHotkey`: `aria-keyshortcuts` is defined
 * in terms of UI Events `KeyboardEvent.key` VALUES, where the control key is
 * `Control`. `Ctrl` is the display spelling and is not a valid key value.
 *
 * Host commands never reach here — `HostCommand` has no `hotkey` field at all.
 */
function keyShortcutsOf(command: Command): string | undefined {
  if (command.hotkey === undefined || command.isDisabled === true) {
    return undefined;
  }
  return ariaKeyShortcuts(command.hotkey);
}

/** Sort key. `undefined` is 0, so an unprioritised manifest keeps its own order. */
function priorityOf(value: number | undefined): number {
  return value === undefined ? 0 : value;
}

/**
 * Build the shell's command registry over one host command list and at most one
 * foreground extension.
 *
 * Cheap to construct and meant to be rebuilt whenever its inputs change; it holds
 * no subscription, no listener and no mutable state beyond the recents array it
 * was handed.
 */
export function createCommandRegistry(input: CommandRegistryInput): CommandRegistry {
  const { hostCommands, extension, recentKeys, onExecuted } = input;

  function noteExecuted(key: string): void {
    if (onExecuted !== undefined) {
      onExecuted(key);
    }
  }

  function hostEntry(command: HostCommand): CommandEntry {
    return {
      key: `host:${command.id}`,
      id: command.id,
      label: command.label,
      icon: command.icon,
      isDisabled: command.isDisabled === true,
      // Never on a host command: `HostCommand` carries no chord, and the
      // dispatcher walks the foreground extension's commands and nothing else.
      keyShortcuts: undefined,
      category: command.category,
      source: 'host',
      run: () => {
        command.onSelect();
        noteExecuted(`host:${command.id}`);
      },
    };
  }

  function extensionEntry(
    command: Command,
    owner: ExtensionCommands,
    context: Readonly<RibbonContext>,
  ): CommandEntry {
    const key = `ext:${owner.extensionId}:${command.id}`;
    return {
      key,
      id: command.id,
      label: command.label,
      icon: command.icon,
      isDisabled: command.isDisabled === true,
      keyShortcuts: keyShortcutsOf(command),
      category: command.category,
      source: 'extension',
      run: () => {
        // The ONE route from any surface to a plug-in handler, and it is the same
        // `execute` the chord dispatcher calls. A throwing handler is reported
        // here and does not reach the surface that invoked it.
        execute(command, context, owner.shell);
        noteExecuted(key);
      },
    };
  }

  /**
   * The one filter. Every projection is a view over this.
   *
   * The context is read once and handed to the predicate, to the expression and
   * to `onExecute`, so a command's visibility and its execution cannot see two
   * different worlds — the same property `hotkeyDispatch`'s decision 5 pins.
   */
  function offer(
    surface: CommandSurface,
    context: Readonly<RibbonContext>,
  ): readonly CommandEntry[] {
    // Entry and sort key TOGETHER, so the comparator never indexes a parallel
    // array and never needs a `??` for a lookup that cannot miss — an unreachable
    // branch is a branch the coverage gate has to be lied to about.
    const offered: { readonly entry: CommandEntry; readonly priority: number }[] = [];

    for (const command of hostCommands) {
      if (!wantsSurface(command.surfaces, surface)) {
        continue;
      }
      offered.push({ entry: hostEntry(command), priority: priorityOf(command.priority) });
    }

    if (extension !== null) {
      for (const command of extension.commands) {
        if (!wantsSurface(command.surfaces, surface)) {
          continue;
        }
        if (!isVisible(command, context)) {
          continue;
        }
        // AND, never OR. See step 4 in the banner.
        if (
          command.whenExpression !== undefined &&
          !evaluateWhen(command.whenExpression, context)
        ) {
          continue;
        }
        offered.push({
          entry: extensionEntry(command, extension, context),
          priority: priorityOf(command.priority),
        });
      }
    }

    // Sorted on the captured key, so the comparator never re-reads a field off
    // plug-in-shaped data while it is comparing. `Array.prototype.sort` is
    // required to be stable, which is what preserves declaration order within one
    // priority — and a manifest that declares no priorities at all therefore
    // comes back exactly as it was written.
    return Object.freeze(
      [...offered].sort((left, right) => right.priority - left.priority).map((row) => row.entry),
    );
  }

  function listForSurface(
    surface: CommandSurface,
    context: Readonly<RibbonContext>,
  ): readonly CommandEntry[] {
    return offer(surface, context);
  }

  function listByCategory(context: Readonly<RibbonContext>): readonly CommandGroup[] {
    const offered = offer('palette', context);
    const groups: CommandGroup[] = [];
    // `COMMAND_CATEGORIES` is an array precisely so this order is a decision
    // rather than an accident of `Set` insertion.
    for (const category of COMMAND_CATEGORIES) {
      const commands = offered.filter((entry) => entry.category === category);
      if (commands.length > 0) {
        groups.push(
          Object.freeze({
            category,
            label: CATEGORY_LABELS[category],
            commands: Object.freeze(commands),
          }),
        );
      }
    }
    const uncategorised = offered.filter((entry) => entry.category === undefined);
    if (uncategorised.length > 0) {
      groups.push(
        Object.freeze({
          category: null,
          label: UNCATEGORISED_LABEL,
          commands: Object.freeze(uncategorised),
        }),
      );
    }
    return Object.freeze(groups);
  }

  function recents(context: Readonly<RibbonContext>): readonly CommandEntry[] {
    // Resolved against what is offered NOW, not against what was offered when the
    // key was recorded. See the recents block in the banner.
    const live = new Map<string, CommandEntry>();
    for (const entry of offer('palette', context)) {
      live.set(entry.key, entry);
    }
    const resolved: CommandEntry[] = [];
    for (const key of recentKeys) {
      const entry = live.get(key);
      if (entry !== undefined) {
        resolved.push(entry);
      }
      if (resolved.length >= MAX_RECENT_COMMANDS) {
        break;
      }
    }
    return Object.freeze(resolved);
  }

  function suggestedFor(context: Readonly<RibbonContext>): readonly CommandEntry[] {
    // Nothing is selected, so there is nothing for a suggestion to be ABOUT. An
    // empty answer rather than "everything", because a suggestion block that
    // repeats the whole palette teaches the user to stop reading it.
    if (context.selectedItemIds.length === 0) {
      return Object.freeze([]);
    }
    const selectionSensitive = new Set<string>();
    if (extension !== null) {
      for (const command of extension.commands) {
        if (
          command.whenExpression !== undefined &&
          referencesSelection(command.whenExpression.node)
        ) {
          selectionSensitive.add(command.id);
        }
      }
    }
    return Object.freeze(
      offer('palette', context).filter(
        (entry) =>
          entry.source === 'extension' &&
          (selectionSensitive.has(entry.id) || entry.category === 'select'),
      ),
    );
  }

  return Object.freeze({ listForSurface, listByCategory, recents, suggestedFor });
}

/**
 * Fold one executed command into a recents list, most recent first.
 *
 * Pure, host-owned and total, so the persistence layer and the tests agree on one
 * definition of "recent". Re-running a command moves it to the front rather than
 * appearing twice, and the list is truncated to `MAX_RECENT_COMMANDS` — bounding
 * what is STORED, in the same shape every other bound in this repository takes.
 */
export function withRecent(recentKeys: readonly string[], key: string): readonly string[] {
  const next = [key, ...recentKeys.filter((candidate) => candidate !== key)];
  return Object.freeze(next.slice(0, MAX_RECENT_COMMANDS));
}
