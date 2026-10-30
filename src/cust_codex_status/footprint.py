"""What one chat leaves on disk, and when to archive or clean it. Read-only: this only measures and suggests; the commands it
returns are shown to the user, never run.

Parts (bytes): the rollout (the transcript), the chat's shell snapshots and its visualizations folder. Everything except the
rollout can be regenerated, so deleting it does not break `codex resume`."""
import glob
import os
import shlex
import time

from . import config
from .util import fmt

CACHE_SECS = 120
MAX_ENTRIES = 20_000                 # stop walking a runaway folder after this many files
_cache = {}                          # session id -> (time, result)
REGENERABLE = ("shell_snapshots", "visualizations")


def dir_size(path, budget=MAX_ENTRIES):
    """Total bytes under `path` (a file or a folder); symlinks are not followed; 0 when missing."""
    try:
        if os.path.isfile(path):
            return os.path.getsize(path)
    except OSError:
        return 0
    total, stack, seen = 0, [path], 0
    while stack and seen < budget:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    seen += 1
                    try:
                        if e.is_symlink():
                            continue
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        else:
                            total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def locations(sid, transcript):
    """part -> path, for one chat. Only paths that exist are returned."""
    codex = config.CODEX
    cand = {"transcript": transcript}
    snaps = glob.glob(os.path.join(codex, "shell_snapshots", sid + ".*"))
    if snaps:
        cand["shell_snapshots"] = snaps
    viz = glob.glob(os.path.join(codex, "visualizations", "*", "*", "*", sid))
    if viz:
        cand["visualizations"] = viz
    return {k: v for k, v in cand.items() if v and (all(os.path.lexists(x) for x in v) if isinstance(v, list) else os.path.lexists(v))}


def footprint(sid, transcript, now=None):
    """-> dict(total, parts{name: bytes}, paths{name: path}), cached for CACHE_SECS."""
    now = now or time.time()
    hit = _cache.get(sid)
    if hit and now - hit[0] < CACHE_SECS:
        return hit[1]
    paths = locations(sid, transcript)
    parts = {k: sum(dir_size(x) for x in (p if isinstance(p, list) else [p])) for k, p in paths.items()}
    res = dict(total=sum(parts.values()), parts=parts, paths=paths)
    _cache[sid] = (now, res)
    return res


def mb(n):
    return round(n / 1e6, 1)


def size_text(n):
    return fmt(n) + "B" if n < 1e6 else f"{n / 1e6:.0f} MB" if n < 1e9 else f"{n / 1e9:.1f} GB"


def advice(r, fp, rules=None, now=None):
    """What to do about this chat's files and memory: a list of dict(kind, text, command|None). Never executed."""
    rules, now, out = rules or config.alert_rules()["advice"], now or time.time(), []
    age_days = (now - r["last_active"]) / 86400
    scratch = sum(fp["parts"].get(k, 0) for k in REGENERABLE)
    if not r["active"] and scratch >= rules["scratch_mb"] * 1e6 and age_days >= rules["scratch_days"]:
        paths = [x for k in REGENERABLE if k in fp["paths"] for x in (fp["paths"][k] if isinstance(fp["paths"][k], list) else [fp["paths"][k]])]
        out.append(dict(kind="delete-scratch", text=f"Delete scratch files ({size_text(scratch)}, regenerable). The rollout stays, so resume still works.",
                        command="rm -rf " + " ".join(shlex.quote(p) for p in paths)))
    if not r["active"] and age_days >= rules["archive_days"] and not r.get("archived_by_ide"):
        out.append(dict(kind="archive", text=f"Idle for {int(age_days)} days and not archived: archive it in the Codex app to keep the list short.", command=None))
    if fp["parts"].get("transcript", 0) >= rules["transcript_mb"] * 1e6:
        out.append(dict(kind="long-transcript", text=f"The rollout is {size_text(fp['parts']['transcript'])}: resuming will be slow. Start clean with a handoff note instead.", command=None))
    return out
