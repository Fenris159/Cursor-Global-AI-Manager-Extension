# Building Cursor Global AI Manager

Multiplatform instructions to build/compile the extension. Requires **Node.js** (v18+ recommended) and **npm**.

---

## Prerequisites

- **Node.js** (LTS 18.x or 20.x recommended) — [nodejs.org](https://nodejs.org/)
- **npm** (bundled with Node.js)

Check versions:

```bash
node -v
npm -v
```

---

## If PowerShell is open as Admin and you're in System32

If you opened **PowerShell as Administrator** and the prompt shows something like `PS C:\Windows\System32>`, you need to go to your project folder first, then run commands there.

**Step 1 — Go to the project folder** (replace with your actual project path):

```powershell
cd "path\to\your\Cursor Global AI Manager Extension"
```

**Step 2 — Build and package the .vsix into `.vsce/`:**

Either run the batch script (compiles, then packages):

```powershell
.\scripts\package-vsix.cmd
```

Or do it in two steps with npm:

```powershell
npm run compile
npm run package-vsix
```

The `.vsix` file will be in the **`.vsce`** folder inside the project (e.g. `cursor-global-ai-cursor-global-ai-manager-1.0.0.vsix`).

If you haven’t run `npm install` in this project yet, do that once before compiling:

```powershell
cd "path\to\your\Cursor Global AI Manager Extension"
npm install
```

Then run Step 2.

---

## 1. Install dependencies

From the extension project root (where `package.json` is):

**Windows (Command Prompt or PowerShell):**

```cmd
npm install
```

**macOS / Linux (Terminal):**

```bash
npm install
```

---

## 2. Compile TypeScript

The extension is written in TypeScript and compiles to JavaScript in the `out/` folder.

### Option A: npm script (all platforms)

**Windows:**

```cmd
npm run compile
```

**macOS / Linux:**

```bash
npm run compile
```

### Option B: TypeScript compiler directly (all platforms)

**Windows:**

```cmd
npx tsc -p ./
```

**macOS / Linux:**

```bash
npx tsc -p ./
```

### Option C: Node script (all platforms)

Uses the project’s `scripts/compile.js` (runs `tsc` via Node):

**Windows:**

```cmd
node scripts\compile.js
```

**macOS / Linux:**

```bash
node scripts/compile.js
```

### Option D: Windows fallback — `compile.cmd`

If you’re on **Windows** and have trouble with `npm` or `node` (e.g. PATH not set, permission errors, or npm scripts failing), use the batch script instead. It finds Node.js automatically (Program Files, Local AppData, or PATH) and runs the same compile logic.

From the project root in **Command Prompt** or **PowerShell**:

```cmd
scripts\compile.cmd
```

Or double‑click `scripts\compile.cmd` in File Explorer (it will run from the script’s folder and switch to the project root). You still need Node.js installed and dependencies installed once (`npm install` from the project root); this only bypasses needing `npm`/`node` in your PATH for the compile step.

---

## 3. Verify build

After a successful compile:

- The **`out/`** directory should contain at least:
  - `extension.js`
  - `fsManager.js`
  - `pathResolver.js`
  - (and any other compiled `.js` and `.map` files from `src/`)

---

## 4. Watch mode (optional)

To recompile automatically when you change source files:

**Windows:**

```cmd
npm run watch
```

**macOS / Linux:**

```bash
npm run watch
```

Stop with `Ctrl+C`.

---

## 5. Lint (optional)

**Windows:**

```cmd
npm run lint
```

**macOS / Linux:**

```bash
npm run lint
```

---

## 6. Package .vsix into .vsce/ (optional)

To build a `.vsix` and put it in the **`.vsce/`** folder:

**All platforms (requires vsce or npx):**

```bash
npm run compile
npm run package-vsix
```

The output file is **`.vsce/cursor-global-ai-cursor-global-ai-manager-1.0.0.vsix`** (version from `package.json`).

**Windows:** From the project root you can run **`scripts\package-vsix.cmd`**. It compiles first, then runs `npx @vscode/vsce package --out .vsce\...`. If npx fails, install vsce globally: `npm install -g @vscode/vsce`, then run:  
`vsce package --out .vsce\cursor-global-ai-cursor-global-ai-manager-1.0.0.vsix`

**If vsce says "Couldn't detect the repository" or "link will be broken":** `package.json` includes a `repository` field so README/CHANGELOG links work. If you use a different Git host or path, edit `package.json` and set `repository.url` to your repo URL (e.g. `https://github.com/yourname/cursor-global-ai-manager.git`).

---

## Summary (copy-paste)

| Platform   | Install deps   | Compile        | Windows fallback (if npm/node fail) |
|-----------|----------------|----------------|-------------------------------------|
| Windows   | `npm install`  | `npm run compile` | `scripts\compile.cmd`              |
| macOS     | `npm install`  | `npm run compile` | —                                   |
| Linux     | `npm install`  | `npm run compile` | —                                   |

The same commands work on all platforms; only the path separators in `scripts/compile.js` are handled by Node’s `path` module. On Windows, if you have issues with npm or Node in your PATH, use **`scripts\compile.cmd`** as a fallback.

---

## Troubleshooting

- **`tsc: command not found`** — Use `npx tsc -p ./` or `npm run compile` so the local TypeScript from `node_modules` is used.
- **`Cannot find module 'vscode'`** — Run `npm install`; `@types/vscode` is a devDependency.
- **Compile fails with type errors** — Ensure Node and `npm install` are up to date and that you’re in the project root (where `tsconfig.json` and `package.json` are).
- **Windows: npm or node not found / PATH issues** — Run **`scripts\compile.cmd`** from the project root instead. It locates Node (Program Files, Local AppData, or PATH) and compiles without needing `npm` or `node` in your shell. You still need Node.js installed and must have run `npm install` at least once.
