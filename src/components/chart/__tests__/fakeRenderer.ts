import type {
  ChartInstance,
  ChartOption,
  ChartRenderer,
} from '../../../core/chart/ChartRenderer';
import type { ChartPalette } from '../../../core/chart/chartPalette';

/**
 * A `ChartRenderer` that records instead of painting.
 *
 * The same seam `HydrationEngine`'s memory-only `ShellStorage` and
 * `src/core/ipc/__tests__/fakePort.ts` are: a real implementation of a host
 * interface, with no library behind it. jsdom has no canvas 2D context, so this
 * is the only way the wrapper's lifetime rules — one instance per palette, one
 * `setOption` per data change, a `dispose` before every re-`init` — can be
 * asserted at all.
 *
 * The `log` is a FLAT, ORDERED list of every call across every instance,
 * because the properties worth pinning are about order: a wrapper that
 * re-initialised before disposing would pass any per-instance count and fail
 * this.
 */
export interface RendererLog {
  readonly log: string[];
  readonly options: ChartOption[];
  readonly palettes: ChartPalette[];
  readonly renderer: ChartRenderer;
  /** How many instances have been built and not yet disposed. */
  live(): number;
}

export function createFakeRenderer(id = 'fake', isSupported = true): RendererLog {
  const log: string[] = [];
  const options: ChartOption[] = [];
  const palettes: ChartPalette[] = [];
  let live = 0;

  const renderer: ChartRenderer = Object.freeze({
    id,
    isSupported: () => isSupported,
    create(host: HTMLElement, palette: ChartPalette): ChartInstance {
      live += 1;
      palettes.push(palette);
      log.push(`create:${host.tagName.toLowerCase()}`);
      return Object.freeze({
        setOption(option: ChartOption): void {
          options.push(option);
          log.push(`setOption:${option.title}`);
        },
        resize(): void {
          log.push('resize');
        },
        dispose(): void {
          live -= 1;
          log.push('dispose');
        },
      });
    },
  });

  return {
    log,
    options,
    palettes,
    renderer,
    live: () => live,
  };
}
