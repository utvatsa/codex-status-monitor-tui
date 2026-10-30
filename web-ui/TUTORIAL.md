# Building the web view in React: a step-by-step tutorial

This is how the `cust-codex-status` web page in this folder was built, in the order it was built, with the reasoning behind each
choice. Read it with the code open next to it: every step names the files it talks about. By the end you will have seen, in a real
and small app, most of what day-to-day React work uses: components and props, state with `useReducer`, effects and their cleanup,
custom hooks, context, refs, TypeScript types for server data, CSS Modules and theming, accessibility, testing and a production build.

> **Who this is for:** you know some JavaScript and HTML/CSS, and want to learn React the way it is used in industry.
> No React experience is assumed; each new idea is explained where it first appears.

**Contents**

0. [The big picture](#0-the-big-picture)
1. [Tooling: Node, npm, Vite, TypeScript](#1-tooling-node-npm-vite-typescript)
2. [The config files, line by line](#2-the-config-files-line-by-line)
3. [The data contract: TypeScript types for the server's JSON](#3-the-data-contract-typescript-types-for-the-servers-json)
4. [Pure logic first (and your first tests)](#4-pure-logic-first-and-your-first-tests)
5. [UI state with `useReducer`](#5-ui-state-with-usereducer)
6. [Custom hooks: live data, time, media queries, themes, keys](#6-custom-hooks-live-data-time-media-queries-themes-keys)
7. [Styling: design tokens, themes and CSS Modules](#7-styling-design-tokens-themes-and-css-modules)
8. [Components, from small to large](#8-components-from-small-to-large)
9. [Putting it together: `App.tsx`](#9-putting-it-together-apptsx)
10. [The development loop](#10-the-development-loop)
11. [Testing components](#11-testing-components)
12. [Building and shipping inside a Python package](#12-building-and-shipping-inside-a-python-package)
13. [Checking it in a real browser](#13-checking-it-in-a-real-browser)
14. [Exercises](#14-exercises)
15. [Cheat sheet](#15-cheat-sheet)
16. [A second design: reimagining the same app](#16-a-second-design-reimagining-the-same-app)

---

## 0. The big picture

`cust-codex-status` is a Python tool. It reads Codex's local files, works out each chat's health (OK / AMBER / RED) and shows it in
a terminal UI (the TUI). The web view shows **the same data** in a browser. It is not a second backend: the TUI publishes what it read,
and the page displays it.

```
 Python (src/cust_codex_status)                                          Browser (this folder, built)
 ┌──────────────────────────────────────────────────────────┐            ┌───────────────────────────────┐
 │ tui / --web loop ─► report.fetch() ─► bridge.Hub.publish  │  SSE       │ useSnapshot() ─► <App/>        │
 │                                        │ snapshot() JSON  ─┼──────────► │   state/ui.ts (useReducer)     │
 │ server.py: /, /static/*, /api/state,   │                  │            │   components/*                 │
 │            /api/events, /api/refresh ◄─┼──────────────────┼─ POST ─────┤ "Refresh", "archived on"       │
 └──────────────────────────────────────────────────────────┘            └───────────────────────────────┘
```

Three decisions shape everything below:

1. **The server computes, the page displays.** Health levels, reasons, tips and number formats come from Python (`bridge.py` calls the same
   `health()` and `fmt()` the terminal uses), so the page and the TUI can never disagree. The page has almost no business logic.
2. **Live updates over Server-Sent Events (SSE).** One long HTTP response that the server keeps writing to. Simpler than WebSockets, and
   it reconnects on its own.
3. **Built once, committed.** `npm run build` writes the finished page into the Python package (`src/cust_codex_status/web/static/`).
   People who install the tool never need Node; only people changing the page do.

---

## 1. Tooling: Node, npm, Vite, TypeScript

**What each tool does**

| Tool | Role | Why this one |
|---|---|---|
| **Node.js** (24 LTS; 22.22+ also works) | runs JavaScript outside the browser: the build and the tests | needed by everything else |
| **npm** | installs packages listed in `package.json`, pins exact versions in `package-lock.json` | ships with Node |
| **React** 19 | a library for building UIs from **components**: functions that return what the screen should look like | the most used UI library; huge ecosystem |
| **TypeScript** 7 | JavaScript plus types, checked before running | catches typos and wrong shapes of server data at build time |
| **Vite** 8 | dev server with instant reload, and the production bundler | fast, minimal config, the default for new React apps |
| **Vitest** 5 | test runner with the same config as Vite | Jest-compatible API, no separate setup |
| **Testing Library** + **jsdom** | render components in a fake browser and interact like a user | tests what users see, not internals |

**Step 1.1: create `package.json` by hand.** Generators (`npm create vite@latest`) are fine, but writing it yourself shows that there is
no magic. Ours has:

- `"type": "module"`: files use `import`/`export` (ES modules), the modern standard.
- `scripts`: `dev`, `build` (`tsc --noEmit && vite build`: type-check first, then bundle), `test`, `typecheck`.
- `dependencies` (shipped in the page): only `react` and `react-dom`.
- `devDependencies` (only for building and testing): everything else.

**Step 1.2: pin exact versions.** Versions are written as `"19.3.0"`, not `"^19.3.0"`. A caret allows any newer minor version, so two
people (or two days) can get different code. We also chose versions **at least two weeks old**: brand-new releases occasionally get
pulled or patched in the first days. To find the newest version older than a date:

```sh
npm view vite time --json      # every version with its release date
```

**Step 1.3: install, and two real-world snags (and how they were really fixed).** The first install ran on Node 22.17 with npm 10.9,
and hit two problems:

1. `npm install` crashed with `Cannot read properties of null (reading 'edgesOut')`, an npm 10.9 bug when resolving
   **peer dependencies** (packages that expect you to install something alongside them, like `@vitejs/plugin-react` expecting `vite`).
   A workaround is `legacy-peer-deps=true` in `.npmrc`, but that stops npm from installing peers at all, so you must then add the
   missing ones by hand (here `@testing-library/dom`). You can list a package's peers with:
   ```sh
   node -p "require('./node_modules/@testing-library/react/package.json').peerDependencies"
   ```
2. A warning, `EBADENGINE`: jsdom 30 declares `engines: { node: "^22.22.2 || ^24.15.0 || >=26.0.0" }`, and 22.17 is older.
   A workaround is pinning jsdom 29.

Both workarounds pointed at the same root cause: **an old toolchain**. So we fixed that instead. Node 24 (the current LTS) was installed with
Homebrew (`brew install node@24 && brew link --force node@24`), which ships npm 11. On it, a plain `npm install` resolves the peers
correctly (no `.npmrc` hack, no hand-added peers) and jsdom 30 installs without warnings. Lessons: read warnings, because they often name
a real incompatibility before it bites; and prefer fixing the cause over stacking workarounds.

npm 11 also brought a security feature: packages' **install scripts** (code that runs during `npm install`) no longer run until you
allow them. `npm install-scripts ls` showed one, `fsevents` (macOS file watching for the dev server). It already ships a prebuilt binary
and its script is only a build-from-source fallback, so we denied it (`npm install-scripts deny fsevents`, recorded as `allowScripts` in
`package.json`) and checked it still loads: `node -e "require('fsevents')"`.

To make the requirement explicit rather than discovered, `package.json` has an `engines` field (copied from jsdom's, the strictest
dependency) and the folder has a `.nvmrc` containing `26` (it was `24` when this was written; both satisfy `engines`), so `nvm use` (if you use nvm) picks the right version.

**Step 1.4: ignore what should not be committed.** `.gitignore` lists `node_modules/` (re-creatable with `npm ci`). `package-lock.json`
**is** committed: it is what makes `npm ci` install exactly the same tree everywhere.

---

## 2. The config files, line by line

**`tsconfig.json`**: how TypeScript checks the code.

- `"strict": true` turns on every safety check (e.g. a value that might be `null` must be handled). Always start strict.
- `"jsx": "react-jsx"` lets `.tsx` files contain JSX (the HTML-like syntax) without importing React in every file.
- `"moduleResolution": "bundler"` resolves imports the way Vite does.
- `"noEmit": true`: TypeScript only checks; Vite does the actual compiling (much faster).
- `"types": [...]` adds global types: Vite's `import.meta`, Vitest's `describe`/`it`, jest-dom's `toBeInTheDocument`.
- `noUnusedLocals` / `noUnusedParameters`: dead code is an error, which keeps the code tidy.

**`vite.config.ts`**: how the page is served in development and built for production.

```ts
base: "/static/",                                           // every built URL starts with /static/ (that's where Python serves files)
build: { outDir: "../src/cust_codex_status/web/static", emptyOutDir: true },   // build straight into the Python package
server: { proxy: { "/api": { target: API, changeOrigin: true, headers: { Origin: API } } } },
test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
```

The **proxy** is the important trick for development: the page runs on Vite's server (port 5173) with instant reload, but its calls to
`/api/...` are forwarded to the real Python server (port 8765). The Python server protects itself against other websites by checking the
`Host` and `Origin` headers (see `server.py`), so the proxy rewrites both (`changeOrigin` does `Host`, `headers` does `Origin`).
Without that, the page's Refresh button would get `403 Forbidden` in development only, a confusing bug.

`declare const process: …` at the top: the config reads one environment variable (`CCS_API`), and declaring the type there avoids adding
`@types/node` just for that line.

**`index.html`**: the one HTML page. It has an empty `<div id="root">` and one script tag pointing at `/src/main.tsx`. In development
Vite serves that `.tsx` file compiled on the fly; in the build it rewrites the tag to the bundled, content-hashed file
(`/static/assets/index-CHTLY4u6.js`).

**`src/main.tsx`**: the entry point. It imports the global CSS and renders `<App/>` into `#root`:

```tsx
createRoot(document.getElementById("root")!).render(
  <StrictMode><ToastProvider><App /></ToastProvider></StrictMode>,
);
```

`StrictMode` does extra checks in development only, the main one being that it **runs every effect twice** on mount. If an effect forgets
to clean up (say, it opens a connection and never closes it), you see the bug immediately instead of in production.

---

## 3. The data contract: TypeScript types for the server's JSON

**File: `src/types.ts`.** Before writing any UI, describe the data you will get. Open `src/cust_codex_status/web/bridge.py`: `snapshot()`
returns a dict; `types.ts` describes the same shape:

```ts
export type Health = "OK" | "AMBER" | "RED";          // a union of string literals: only these three values type-check
export interface Session { sid: string; active: boolean; health: Health; why: string[]; ctx_pct: number; /* … */ }
export interface Snapshot { generated: number; sessions: Session[]; totals: { … }; view: { … } }
```

Why bother? From now on, `session.ctx_pct` autocompletes, and a typo like `session.ctxPct` is a build error, not a blank space on the
page. When Python adds a field, add it here and TypeScript shows every place that could use it.

> **Note:** types are a *promise*, not a check: at runtime, `JSON.parse` returns whatever the server sent. That's acceptable here because
> both sides live in one repo and change together. For data from a third party, validate it at runtime (libraries like `zod` do that).

---

## 4. Pure logic first (and your first tests)

**Files: `src/lib/view.ts`, `src/lib/format.ts`, and their `*.test.ts`.**

A **pure function** returns the same output for the same input and touches nothing else (no DOM, no network, no time). Pure functions
are the easiest code to test and to reason about, so we write as much logic as possible that way, and keep components thin.

`view.ts` re-creates the Python view dial (`views.py`): a level 0-100 picks one of five views, each turning display flags on or off:

```ts
export function flagsFor(level: number): Flags {
  return { minimal: level < 20, compact: level < 45, lean: level < 70, noPrompts: level < 90, showArc: level >= 90, verbose: level >= 90 };
}
```

Its test (`view.test.ts`) reads like a specification:

```ts
it("steps between representative levels and stops at the ends", () => {
  expect(stepLevel(75, 1)).toBe(95);
  expect(stepLevel(95, 1)).toBe(95);
});
```

Run the tests with `npm test` (once) or `npm run test:watch` (re-runs on every save).
`describe` groups tests, `it` is one test, and `expect(x).toBe(y)` checks a value. `toEqual` compares arrays and objects by content.

---

## 5. UI state with `useReducer`

**File: `src/state/ui.ts`** (+ `ui.test.ts`).

**State** is data that changes while the page is open and, when it changes, should re-render the screen. This page has two kinds:

- **Server data** (the snapshot): it arrives from the server, and we never change it.
- **UI state**: what the user chose, i.e. view level, toggles, which chat is highlighted or selected, filter text, expanded rows, whether the
  shortcuts dialog is open.

For simple values React offers `useState`. When many values change together under rules ("pressing Esc goes back to NAVIGATE, or if
already there clears the filter"), the industry pattern is a **reducer**: one pure function `(state, action) => newState`.

```ts
export function uiReducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case "pick":  return { ...s, cursor: a.id, selected: true };
    case "back":  if (s.selected) return { ...s, selected: false };
                  if (s.query) return { ...s, query: "" };
                  return s;
    // …
  }
}
```

Things to notice:

- **Never mutate; return a new object.** `{ ...s, selected: false }` copies `s` and overrides one field. React detects changes by
  comparing object identity, so mutating `s.selected = false` would not re-render.
- **Actions are a typed union** (`UiAction`). TypeScript checks that every `dispatch({ type: "move", delta: 1, ids })` has the right fields,
  and inside `case "move":` it knows `a.delta` exists.
- **Keys, clicks and the toolbar dispatch the same actions**, so they behave identically by construction.
- **Selection follows ids, not positions.** The list re-renders every few seconds; a `sync` action keeps the cursor on the same chat, or
  moves it to the first one if that chat disappeared. (The TUI does the same.)
- **Derived values are computed, not stored.** `effectiveFlags()` combines the level and the toggles each render. Storing derived values in
  state is a classic source of bugs, because they get out of sync with what they derive from.

In a component: `const [ui, dispatch] = useReducer(uiReducer, initialState)`. The reducer test checks the rules without rendering
anything; for example, "a level change drops the toggles; a toggle flips one flag of the current level".

---

## 6. Custom hooks: live data, time, media queries, themes, keys

A **hook** is a function whose name starts with `use` and that calls React's built-in hooks. Custom hooks are how you package behaviour
for reuse and keep components readable. Rules: call hooks at the top level of a component (not inside `if` or loops), and only from
components or other hooks.

**`useSnapshot` (`src/hooks/useSnapshot.ts`): the live data.**

```ts
useEffect(() => {
  const es = new EventSource("/api/events");
  es.addEventListener("snapshot", (e) => setSnapshot(JSON.parse(e.data)));
  return () => es.close();                 // cleanup: React calls this when the component goes away
}, [url]);
```

- `useEffect(fn, deps)` runs `fn` **after** rendering, for side effects (network, timers, subscriptions). It re-runs when a value in
  `deps` changes; `[]` means once.
- The function it returns is the **cleanup**. Forgetting it would leave a connection open each time the component re-mounts; StrictMode's
  double run in development (step 2) exposes exactly that.
- `EventSource` reconnects by itself. If it gives up (`readyState === CLOSED`) we retry every 3 s, so the page comes back when you restart
  the server. `connection` (`live` / `retrying` / `stopped`) drives the dot in the top bar and the banner.

**`useNow`**: `setInterval` inside `useEffect`, with `clearInterval` as cleanup. It re-renders every second for "updated 3s ago".

**`useMediaQuery`**: built on `useSyncExternalStore`, React's official way to read something that lives outside React (here
`window.matchMedia`) and re-render when it changes. `App` uses it to pick the side panel (wide screens) or inline details (narrow).

**`useTheme`**: keeps the theme in state, and in an effect writes it to `<html data-theme="nord">` and to `localStorage`. CSS does the
rest (step 7). `lib/storage.ts` wraps `localStorage` in `try/catch`, because it can throw in private windows.

**`useHotkeys`**: one `keydown` listener for the whole page. Two techniques worth learning:

```ts
const ref = useRef({ keymap });
ref.current = { keymap };                  // always the latest handlers…
useEffect(() => {
  const onKey = (e) => ref.current.keymap[e.key]?.(e);
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);                                    // …but the listener is added only once
```

- `useRef` holds a value that survives re-renders **without** causing one. Storing the latest keymap in a ref avoids re-adding the listener
  on every render, and avoids the "stale closure" bug (a listener that still sees old state).
- Keys are ignored while typing in an input (so `/` can be typed into the filter), and when ⌘/Ctrl/Alt is held, so browser shortcuts
  still work.

---

## 7. Styling: design tokens, themes and CSS Modules

**Files: `src/styles/tokens.css`, `src/styles/base.css`, every `*.module.css`.**

**Design tokens.** Every colour, radius, shadow and font size is a CSS variable in `tokens.css`, and components only use the variables:

```css
:root { --bg: #f6f7f9; --text: #101828; --accent: #0e7490; --ok: #067647; --amber: #b54708; --red: #b42318; … }
```

Colours are named by **role**, not hue: `--accent` (live / interactive), `--nav` (keyboard highlight), `--sel` (selected), `--ok` / `--amber`
/ `--red` (health only). That's what makes themes cheap, and it keeps meaning consistent: the TUI's rule "frame colour = group, badge
colour = health" holds here too.

**Themes** are only new values for the same variables:

```css
:root[data-theme="nord"]  { --bg: #2b303b; --accent: #88c0d0; … }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { …dark values… } }   /* "Auto" follows the OS */
```

`useTheme` sets or removes `data-theme`, and the whole page recolours with no React re-render needed.
*Adding a theme:* copy a block in `tokens.css`, change `data-theme="…"` and the values, then add an entry to `THEMES` in `useTheme.ts`
(label, hint, two swatch colours). Check that text on `--bg-elev` stays readable and that the three health colours stay distinct.

**CSS Modules.** A file named `X.module.css` is scoped to the component that imports it:

```tsx
import s from "./Toolbar.module.css";
<div className={s.toolbar}>          // becomes class="_toolbar_1x2y3" in the build: no clashes with other components
```

Global rules (reset, fonts, `:focus-visible`, `.sr-only`) live in `base.css` only.

**Techniques used in the stylesheets:**

- `color-mix(in srgb, var(--accent) 40%, transparent)`: tints from tokens, so new themes keep working without new variables.
- `position: sticky` for the top bar, toolbar and side panel; `backdrop-filter: blur()` for the frosted header.
- Grid with `minmax(0, 1fr)`. A plain `1fr` column refuses to shrink below its content's width, which caused horizontal scrolling on
  phones (found with the screenshot script, step 13).
- `@media (max-width: …)` breakpoints at 1240 / 1100 / 900 / 760 / 640 px: columns drop out of rows, and tiles go 4 → 2 → 1.
- `@media (prefers-reduced-motion: reduce)` turns animations off for people who ask their OS for less motion.
- `font-variant-numeric: tabular-nums` (the `.tnum` class), so numbers line up and don't jiggle when they change.

**A security detail:** the Python server sends a Content-Security-Policy with `style-src 'self'`, which blocks `style="…"` attributes
written in HTML. React's `style={{ width: "40%" }}` is applied from JavaScript (through the CSSOM), which CSP allows, so the meters
work. Inline `<script>` would be blocked too, and Vite's build doesn't produce any.

---

## 8. Components, from small to large

A **component** is a function that takes **props** (an object of inputs) and returns JSX. React calls it again whenever its props or
state change, and updates only the parts of the DOM that differ.

**Small, presentational (`components/ui/`)**

- `Icon.tsx`: an inline SVG set. There's no icon font and no extra request, and `stroke="currentColor"` makes icons take the text colour.
- `primitives.tsx`: `Badge`, `Meter`, `Kbd`, `Button`, `CopyButton` and the `cx()` helper (joins class names, skipping falsy ones).
  `Button` shows **prop spreading**: `{...rest}` passes every other attribute (`onClick`, `title`, `aria-*`) down to the `<button>`.
  `CopyButton` has a little local state (`useState(false)`) for its two-second "Copied" tick, and calls `e.stopPropagation()` so a
  click on the button doesn't also select the card it sits on.
- `Card.tsx`: a titled surface. It shows **composition**: it renders whatever `children` you put inside it.
- `Toast.tsx`: **context**. `ToastProvider` puts a `show(message)` function in context; any component deep in the tree calls
  `useToast()` to get it, so we avoid passing `onCopied` callbacks through five levels of props ("prop drilling").

**Feature components**

- `TopBar.tsx`: brand, connection dot, address, *updated Ns ago*, Refresh, theme and shortcuts. It only displays props and calls callbacks.
- `ThemeMenu.tsx`: an **accessible popup**: `aria-haspopup`, `aria-expanded`, `role="listbox"`/`"option"`, `aria-activedescendant`, arrow
  keys and Enter, Escape, and click-outside to close. `e.stopPropagation()` in its `onKeyDown` keeps ↑ ↓ from also moving the chat
  cursor. (React attaches its listeners at the root element, so stopping propagation there stops the event before it reaches `window`.)
- `Overview.tsx`: account line, KPI tiles, usage and the attention card (count, arrows, expandable summary; the items come from `lib/attention.ts`).
- `Session.tsx`: one chat, three ways: `SessionCard`, `SessionRow`, `SessionDetails` (shared by both), plus `DetailPanel`.
  Rendering the same data in several layouts from shared small pieces (`State`, `Context`, `Stats`, `Command`) is the everyday reuse
  pattern in React.
- `Toolbar.tsx`: the view switch (a `radiogroup`), toggle chips (`aria-pressed`) and the filter. It uses **`forwardRef`**, so `App` can
  hold a ref to the `<input>` inside and focus it when you press `/`.
- `KeyBar.tsx`: the bottom bar, like the TUI's footer.
- `ShortcutsDialog.tsx`: the native `<dialog>` with `showModal()`. The browser gives you focus trapping, Escape-to-close and an inert
  background for free, which is better than re-implementing a modal.

**Accessibility checklist we followed:** real `<button>`s for actions (keyboard and screen-reader friendly by default); visible focus
(`:focus-visible`); `aria-label` on icon-only buttons; `role="meter"` with `aria-valuenow` on bars; a `role="status"` live region for
toasts; colour never the *only* signal (badges also say OK / AMBER / RED); and keyboard parity with the mouse.

---

## 9. Putting it together: `App.tsx`

`App` is where data, state and components meet. Read it top to bottom:

1. **Inputs:** `useSnapshot()` (server data), `useReducer(uiReducer, …)` (UI state), `useTheme`, `useNow`, `useMediaQuery`.
2. **Start state** from saved preferences and the address: `?level=95&theme=nord` (`startState()`, run once via `useMemo`).
3. **Derived data, computed on each render:** the effective flags; `live` and `archived` lists after the filter; `items` (their order is the
   numbering); `current` (the chat under the cursor). Nothing derived is stored in state.
4. **Effects**:
   - `sync` the cursor when the list of ids changes. The dependency is `idKey`, a joined string, because arrays are new objects every
     render and would re-run the effect each time.
   - save preferences.
   - ask the server for archived chats the first time they're shown (`requestRefresh(true)`, once, guarded by a ref).
   - scroll the highlighted chat into view.
5. **The keymap**: an object from key to handler, passed to `useHotkeys`. While the shortcuts dialog is open, only `?` is active.
6. **Rendering:** a loading skeleton or "server stopped" screen until the first snapshot, then the page. The **master-detail** layout
   (list + sticky `DetailPanel`) appears only when `useMediaQuery("(min-width: 1100px)")` is true; otherwise `inlineDetails` makes the
   selected card or row show its details itself.

`key={x.sid}` on list items: React uses keys to match items between renders. Use a stable id, never the array index, or a refresh that
reorders chats would mix up their DOM (and focus) between rows.

---

## 10. The development loop

```sh
cd web-ui
npm ci                                                # once: exact versions from package-lock.json
cust-codex-status --web --no-open --web-idle 0 &      # the data source on 127.0.0.1:8765, never idles out
npm run dev                                           # open http://localhost:5173/static/
```

Edit any file and the browser updates in place, keeping state (**Hot Module Replacement**). The page talks to the real Python server
through the proxy (step 2), so you see your real chats. Set `CCS_API=http://127.0.0.1:9000 npm run dev` if the server runs elsewhere.

Useful extras: the React DevTools browser extension (inspect components, props and state), and `npm run typecheck` in a second terminal.

---

## 11. Testing components

**Files: `src/test/setup.ts`, `src/test/fixtures.ts`, `src/App.test.tsx`.**

Testing Library's idea: **test what the user sees and does**, not implementation details. Find elements by role, label or text, then act
like a person:

```tsx
const user = userEvent.setup();
render(<ToastProvider><App /></ToastProvider>);
act(() => FakeEventSource.last().push(snapshot()));          // the server "sends" a snapshot
await user.keyboard("{ArrowDown}{Enter}");                   // move to the 2nd chat, select it
expect(screen.getByText("SELECTED")).toBeInTheDocument();
expect(screen.getByLabelText("Details of busy-chat")).toBeInTheDocument();
await user.keyboard("{Enter}");                              // Enter again copies
expect(await navigator.clipboard.readText()).toBe("cd ~/big && codex resume 22222222-bbbb");
```

**Fakes in `setup.ts`.** jsdom is a browser without layout or network, so we fill in what the page needs:

- `FakeEventSource`, whose `push(data)` plays the server.
- `matchMedia`, reporting a wide screen unless a test says otherwise.
- `fetch`, a spy, so a test can check that `POST /api/refresh` was sent with `{"archived": true}`.
- The clipboard is user-event's own fake; read it back with `navigator.clipboard.readText()`.

**`act()`** tells React "state is about to change outside a user event", so it flushes updates before the next line. user-event calls
already do this for you.

**Queries, in order of preference:** `getByRole` (with `name`), `getByLabelText`, `getByText`. `getBy…` throws if there are zero or
several matches (good: it flags ambiguity), `queryBy…` returns `null` (use it to assert absence), and `findBy…` waits (for things that
appear asynchronously, like a toast).

Two bugs these tests caught while writing them: a heading query matched both the card and the side panel (fixed by matching the full
title), and user-event replaces `navigator.clipboard` with its own fake (so spying on our fake saw nothing).

---

## 12. Building and shipping inside a Python package

```sh
npm run build        # = tsc --noEmit && vite build
```

1. `tsc --noEmit` type-checks everything; any error stops the build.
2. Vite bundles, minifies and tree-shakes (drops unused code), and writes to `src/cust_codex_status/web/static/`:
   `index.html` plus `assets/index-<hash>.js` and `.css`. About 80 KB gzipped, most of it React itself.
3. The `<hash>` changes whenever the content changes, so the Python server can tell browsers to cache `assets/*` forever
   (`Cache-Control: immutable`) while `index.html` is `no-store`. A new build is picked up on the next page load.

**On the Python side** (`server.py`): `static_files()` walks the build folder once at start-up and builds an **allow-list** of servable
files (known extensions only). A request is looked up in that list and is never joined onto a disk path, so `/static/../server.py` can't
escape. `pyproject.toml` includes `web/static/*` and `web/static/assets/*` as package data, so `pip install .` ships the page.

**Files that bypass the bundler.** Anything in `web-ui/public/` is copied into the build as it is, which is how the earlier plain-JS
page (`public/plain/`) and the version switch (`public/compare.js`) ship next to the React build. `emptyOutDir` wipes the output folder
on every build, so anything that must survive lives in `public/`, never directly in `static/`. Vite warns that `compare.js` "can't be
bundled without type=module"; that is expected, since it is a plain script on purpose. Open `/plain` to see the same page without
React and compare the sizes the strip reports.

**Commit the build** with the source change. The Python tests check that every file `index.html` references exists in the allow-list
(`test_page_references_only_built_files`), which catches a forgotten rebuild that left stale hashes.

---

## 13. Checking it in a real browser

Unit tests can't tell you that a column overflows at phone width or that a theme has unreadable text. `scripts/screenshot.mjs` drives
headless Chrome through the **DevTools protocol** (Node 22+ has `WebSocket` built in, so there's nothing to install):

```sh
node scripts/screenshot.mjs "http://127.0.0.1:8765/?theme=nord&level=30" /tmp/phone.png 390 1 a wait2000 Down Enter
```

It emulates the viewport (Chrome's `--window-size` won't go below ~500 px, so phones need emulation), presses keys, prints
`overflow: {"vw":390,"sw":390,"wide":[]}` (a `sw` larger than `vw` means something sticks out sideways, and `wide` names the
elements), and saves a full-page screenshot. Look at the screenshots; that's how the phone-width bugs in this page were found and fixed.

---

## 14. Exercises

Each one touches a different part of the stack. Run `npm test` and look in the browser after each.

1. **Add a field end to end.** In `bridge.py` add `effort` to `_session()` (it is on the Python row as `r["effort"]`). Add `effort: string | null`
   to `Session` in `types.ts`, show it after the model in `SessionCard`, and add it to `fixtures.ts`. Run both test suites.
2. **Add a theme.** "Light · Solarized": a block in `tokens.css` plus an entry in `THEMES`. Check it with the screenshot script.
3. **Add a key.** `o` should open the filter *and* clear it. Add a `case` to the reducer (with a test), then a line to the keymap and to
   `SHORTCUTS`.
4. **Sort control.** Let the user sort archived rows by cost or by age. Where does the sort order belong: in the reducer, or computed in
   `App`? (Hint: step 5, "derived values".)
5. **Count in the tab title.** Show `(2) Codex Status` when chats need attention. Which hook would you use, and what is its cleanup?
6. **Harder: code-split the dialog.** Load `ShortcutsDialog` with `React.lazy` + `<Suspense>` and compare the build sizes.

---

## 15. Cheat sheet

| Concept | Where in this code |
|---|---|
| Component, props, children | `ui/Card.tsx`, `ui/primitives.tsx` |
| `useState` | `CopyButton`, `ThemeMenu` |
| `useReducer` + typed actions | `state/ui.ts`, `App.tsx` |
| `useEffect` + cleanup | `hooks/useSnapshot.ts`, `hooks/useNow.ts` |
| `useRef` (DOM ref, mutable value) | `App.tsx` (`search`, `askedArc`), `hooks/useHotkeys.ts` |
| `forwardRef` | `Toolbar.tsx` |
| `useMemo` / `useCallback` | `App.tsx` (`startState`, `copy`), `Toast.tsx` |
| `useSyncExternalStore` | `hooks/useMediaQuery.ts` |
| Context | `ui/Toast.tsx` |
| Lists and `key` | `App.tsx`, `Session.tsx` |
| Conditional rendering | `App.tsx` (`f.compact ? rows : cards`) |
| CSS Modules / tokens / themes | `*.module.css`, `styles/tokens.css` |
| Accessible patterns | `ThemeMenu.tsx`, `ShortcutsDialog.tsx`, `Toolbar.tsx` |
| Unit test / component test | `lib/view.test.ts`, `state/ui.test.ts` / `App.test.tsx` |
| Dev proxy, build into a package | `vite.config.ts` |

**Commands:** `npm ci` · `npm run dev` · `npm test` · `npm run test:watch` · `npm run typecheck` · `npm run build` ·
`node scripts/screenshot.mjs <url> <out.png> [width] [mobile] [steps…]`

**Further reading:** [react.dev/learn](https://react.dev/learn) (the official tutorial, excellent) ·
[vite.dev/guide](https://vite.dev/guide/) · [testing-library.com/docs/queries/about](https://testing-library.com/docs/queries/about) ·
[typescriptlang.org/docs/handbook](https://www.typescriptlang.org/docs/handbook/intro.html) ·
[developer.mozilla.org: Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

---

## 16. A second design: reimagining the same app

The first design is a clean, conventional dashboard. The second ("Aurora", `src/v2/`) answers a different question: **how far can the
look and feel go when the data, state and keys stay exactly the same?** It is also the best demonstration of why we split logic from
presentation in steps 3 to 6: nothing below `components/` changed.

**What was reused, unchanged**: `types.ts`, `lib/*`, `state/ui.ts` (the reducer), `hooks/useSnapshot`, `useTheme`, `useHotkeys`, `useNow`.
**What is new**: `src/v2/` (components, tokens, one CSS file) and a second HTML entry, `v2.html`.

### 16.1 Two pages from one build
`vite.config.ts` gets `build.rollupOptions.input = { main: "index.html", v2: "v2.html" }`. Vite builds both, and puts React itself into a
shared chunk (`ui-*.js`), so the second design costs about 35 KB of JS, not another 230 KB. On the Python side `PAGES` in `server.py` maps
`/` to `v2.html` and `/classic` to `index.html`. Remember to **restart the server after a build**: the allow-list of files is made at start-up.

### 16.2 Design language: what "glass + aurora" means in CSS
- **Aurora**: three large blurred circles (`.aurora i`, `filter: blur(90px)`) drift on 40 to 50 second keyframe loops behind everything.
  Only `transform` is animated, which the browser can run on the GPU without re-layout.
- **Glass** (`.glass`): a translucent background made with `color-mix(in srgb, var(--surface) 62%, transparent)`, `backdrop-filter: blur() saturate()`,
  a hairline border and an **inset 1px highlight** on the top edge (`inset 0 1px 0 var(--hi)`). The highlight is what makes it read as a lit surface.
- **Tokens** (`tokens.css`): one block per theme, about twenty variables. Components never contain a colour, so six themes cost nothing extra.
  Greys are derived with `color-mix` from `--text` rather than hard-coded, which keeps every theme coherent.
- **Hierarchy**: big tight-tracked numbers (`letter-spacing: -.04em`), small upper-case labels, `font-variant-numeric: tabular-nums` so digits don't jitter.

### 16.3 Motion with purpose
| Where | Technique | Why |
|---|---|---|
| Cards on load | staggered `rise` keyframes, `animation-delay: calc(var(--i) * 55ms)` | tells the eye where to start |
| Numbers | `useCountUp` (rAF + ease-out cubic) | changes feel like change, not a flicker |
| Meters | `scaleX` from the left | data "fills" |
| Row highlight ("lens") | one absolutely positioned element moved with `transform: translateY` after measuring the row (`useLayoutEffect`) | the selection travels instead of teleporting |
| Segmented control | a sliding thumb with a spring easing (`cubic-bezier(.34,1.4,.5,1)`) | direct feedback with a little life |
| Theme switch | `document.startViewTransition` + `flushSync` | a cross-fade of the whole page, where supported |
| Copy button | icon pops into a check, plus a toast | confirmation at the point of action |

Every animation stops under `prefers-reduced-motion: reduce` (one block at the bottom of `app.css`, and `useCountUp` checks it too).

### 16.4 Restraint, then charts that earn their place
The first Aurora cut had large charts and gauges. In use they were **overbearing**: they competed with the list of chats. The fix was not to
remove charts but to make them **small and live**, like Grafana's stat panels: a number first, a 38px chart as supporting evidence, and
the detail on hover. Rules of thumb used here: charts sit at the bottom edge of their card, fade in from the left, and colour is reserved for meaning.

**How the live chart works** (`series.ts`, `Chart.tsx`):
- The server sends only the latest snapshot, so the page **builds the history itself**: `record()` adds one point per series per snapshot
  (headline numbers, plus context and memory for each live chat). `useSeries` keeps 15 minutes and mirrors them to `sessionStorage`.
- The visible range is `[first sample, newest sample]` (at least 30s wide), so the chart **starts as a short line and expands**; after 15 minutes it scrolls.
- `useEased` animates the range end and the value scale with `requestAnimationFrame`, so a new sample glides in instead of jumping.
- The curve is a Catmull-Rom spline turned into cubic Béziers (`smoothPath`); counts use `stepPath`. `valueAt` interpolates between samples.
- The SVG is stretched to its box (`preserveAspectRatio="none"` with `vector-effect: non-scaling-stroke`), so the pulsing dot, crosshair and tooltip are HTML on top.
- Hover: pointer x to time to the nearest sample; the tooltip shows its value and age.

### 16.5 Making the answers obvious: where, which model, which agents
Users asked "where is it running, with which model, how many agents, what are the codes?". The data was there but buried, so the design
promotes it (`derive.ts`, `Chats.tsx`, `Drawer.tsx`):
- **Chips with colour roles**: where it runs = accent, model = violet, so the eye separates them without reading.
- **Short codes**: `sessionCode()` = first 8 characters of the session id; `agentCode()` = first 7 of an agent id. A `CodeChip` shows the short form and copies the full one.
- **Counting**: every live chat is itself one *main agent*, and subagents are extra agents it started, so the Agents panel shows `live chats + running subagents`. (The first version counted only subagents and showed a confusing 0: a lesson in naming what users think they are counting.) `agentTotals()` feeds it; `breakdown()` counts chats per host and model, and those chips double as filters.
- **Python side**: `bridge.py` now sends each agent's `code` (the id from the file name `subagents/agent-<code>.jsonl`), and `types.ts` mirrors it. This is the data-contract loop from chapter 3 in action: change Python, change the type, let TypeScript show every place to update.

### 16.5b Detail level versus archive
In the Python TUI the level dial also switches archived chats on at 90 and above. For the web design that coupling was wrong: users want **Full detail for the live chats**
without pulling in 20 old ones. So `App.tsx` keeps `showArc` in its own state (stored under `archived`), outside the shared reducer, and the level only controls detail.
Separate concerns, separate state.

### 16.6 Colour modes
`modeOf()` says whether a theme is light or dark; the header's Light / Dark / Auto switch sets the base themes, and a second menu holds the palettes
(Paper, Nord, Dracula). `effectiveMode()` resolves Auto through `prefers-color-scheme`, so the `m` key can flip whatever you currently see.

### 16.7 Components worth studying
- `Chart.tsx` and `series.ts`: the live chart and its history store (section 16.4). `parts.tsx`: `Gauge`, `FleetRing`, `Meter`, `CodeChip`, `ToastProvider`, `CopyBtn`.
- `Chats.tsx`: the lens. Read how `useLayoutEffect` measures `offsetTop/offsetHeight` and why a `ResizeObserver` re-measures on resize.
- `Palette.tsx`: a command palette in about 90 lines: every typed word must appear; arrows, Enter, Escape; focus on open.
- `Drawer.tsx`: not modal on purpose, so the list keeps working with the arrow keys while details follow the highlight.

### 16.8 Exercises
1. Add a "Density" command to the palette that toggles `compact` and show its current state in the title.
2. Add a fourth aurora blob only for the Dracula theme, using one extra token.
3. Make the sparkline show a tooltip with the value under the pointer (hint: `onPointerMove` and the SVG `viewBox` maths).
4. Replace `useCountUp` with the CSS `@property` approach (animate a registered custom property) and compare.
