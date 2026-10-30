import types

"""The --level 0-100 view dial: which of the five views a number means, and the flags each view sets."""



LEVELS = [(0, "minimal"), (20, "compact"), (45, "lean"), (70, "standard"), (90, "full")]


LEVEL_REPS = [10, 30, 60, 75, 95]          # what the numbers 1-5 / the TUI +/- jump to


DEFAULT_LEVEL = 75


def level_name(n):
    return [nm for lo, nm in LEVELS if n >= lo][-1]


def apply_level(args):
    """--level 0-100 sets the baseline view; explicit flags (--compact, -D, --no-prompts, -v) can only add to it."""
    ex = args.explicit
    n = args.level = max(0, min(100, args.level))
    args.minimal = n < 20
    args.compact = ex["compact"] or n < 45
    args.lean = n < 70
    args.no_prompts = ex["no_prompts"] or n < 90
    args.show_arc = ex["show_arc"] or n >= 90
    args.verbose = ex["verbose"] or n >= 90


def make_options(**kw):
    """A complete options object (what argparse gives the CLI) for callers that have no command line: tests, other front-ends."""
    o = types.SimpleNamespace(level=DEFAULT_LEVEL, compact=False, no_prompts=False, show_arc=False, verbose=False, subagents=False, expand=None, arc_prompt=True,
                              account=False, show_live=True, days=7, project=None, n=None, tui=False, watch=None)
    for k, val in kw.items():
        setattr(o, k, val)
    o.explicit = dict(compact=o.compact, no_prompts=o.no_prompts, show_arc=o.show_arc, verbose=o.verbose)
    apply_level(o)
    return o
