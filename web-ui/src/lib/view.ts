// The view dial, the same as views.apply_level in Python: a level 0-100 picks one of five views,
// and each view turns a few display flags on or off. Pure functions, so they are easy to test.

export const VIEWS = ["minimal", "compact", "lean", "standard", "full"] as const;
export type ViewName = (typeof VIEWS)[number];

/** The level each view jumps to (keys 1-5, the view switch, + and -). */
export const LEVEL_REPS = [10, 30, 60, 75, 95] as const;

export interface Flags {
  minimal: boolean;              // hide usage limits, attention and the legend
  compact: boolean;              // live chats as rows instead of cards
  lean: boolean;                 // short cards
  noPrompts: boolean;            // hide first / latest prompt
  showArc: boolean;              // show archived chats
  verbose: boolean;              // latest 3 subagents per chat
}

export type FlagName = keyof Flags;

export function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function viewIndex(level: number): number {
  return level < 20 ? 0 : level < 45 ? 1 : level < 70 ? 2 : level < 90 ? 3 : 4;
}

export function flagsFor(level: number): Flags {
  return {
    minimal: level < 20,
    compact: level < 45,
    lean: level < 70,
    noPrompts: level < 90,
    showArc: level >= 90,
    verbose: level >= 90,
  };
}

/** One view up (+1) or down (-1), landing on that view's representative level. */
export function stepLevel(level: number, delta: number): number {
  return LEVEL_REPS[Math.max(0, Math.min(VIEWS.length - 1, viewIndex(level) + delta))];
}
