# Brogue CE Web (Emscripten)

This folder provides a minimal way to compile `BrogueCE-master` to WebAssembly and run it in a browser.

## 1) Install Emscripten

Example:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

## 2) Build

From repository root:

```bash
./brogueweb/build_web.sh
```

Output files are generated in `brogueweb/dist/`.

## 3) Run locally

```bash
./brogueweb/serve.sh 8080
```

Then open:

- http://localhost:8080/

## Notes

- This build uses the SDL2 renderer (`sdl2-platform.c`) and preloads `assets/` + `keymap.txt` into the Emscripten virtual filesystem.
- For Chinese text rendering, place a font file at `BrogueCE-master/bin/assets/NotoSansSC-Regular.ttf` before building.
  - The runtime also tries: `NotoSansCJKsc-Regular.otf`, `SourceHanSansSC-Regular.otf`, `SourceHanSansCN-Regular.otf`.
- UI localization currently defaults to Chinese. You can switch language at runtime with `--lang en_US` or `--lang zh_CN`.
- External translation file: `BrogueCE-master/bin/assets/zh_CN.json` (JSON object of `\"English string\" : \"中文翻译\"`).
- Optional override: set env `BROGUE_LANG_FILE` to point to another JSON file.
- Export untranslated keys:
  - Full scan: `./brogueweb/i18n/export_untranslated.sh`
  - Player-visible priority: `./brogueweb/i18n/export_untranslated_visible.sh`
- Merge filled todo entries back into base:
  - `./brogueweb/i18n/merge_translations.sh`
- Validate placeholder consistency (`%...` and `$HESHE` style tokens):
  - `./brogueweb/i18n/check_translations.sh`
- Existing save/recording logic may need additional browser-side handling for persistence and file import/export.
- If startup fails, open browser DevTools Console and check runtime errors.
