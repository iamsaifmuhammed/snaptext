# SnapText 1.1.1 — Windows release candidate

SnapText is a lightweight, local-first screenshot and OCR utility for Windows 10 and Windows 11, built with Tauri and React.

## Changes in 1.1.1
- Windows-only release scope: removed macOS Vision/Swift OCR and `pbcopy` clipboard code. macOS support can be implemented separately later.
- App header and experimental quick-action header now display the supplied `src-tauri/icons/icon.ico` artwork (converted to a web-friendly PNG for the UI). The Windows installer/app bundle continues to use `icon.ico`.
- OCR interface labels no longer claim English-only support; they explain that recognition depends on Windows OCR language support.
- Preserved Unicode OCR output and automatic clipboard copying after successful extraction.
- Preserved the existing screen capture, region selection, image import, crop, save, and copy-image workflows.
- Print Screen continues to show/focus the main SnapText window, not the experimental quick-actions or capture overlay.

## Important OCR language limitation
This version uses Windows' built-in OCR engine and `TryCreateFromUserProfileLanguages`. Recognition is limited to the languages and OCR capabilities actually supported and available to that Windows installation. Adding a display language alone does not guarantee OCR support. In Windows 10/11, check **Settings → Time & language → Language & region → the language's Options** and install any available handwriting/OCR-related language features. Availability varies by Windows version and language. In particular, do not assume Bengali OCR works just because Bengali text can be displayed in Windows.

**Multilingual release status:** Unicode is preserved, but broad Bengali/Arabic/Hindi OCR is not guaranteed by native Windows OCR. This source package does not bundle a separate OCR engine or language models. The recommended next engineering step, if testing confirms Windows OCR cannot handle required scripts, is to add an offline bundled OCR engine (for example, Tesseract with selected language data). That increases installer size and needs its own licensing, packaging, performance, and language-accuracy validation. We are not claiming that limitation is solved in 1.1.1.

## Build on Windows
Prerequisites: Node.js LTS, Rust with the MSVC toolchain, Microsoft C++ Build Tools, and the WebView2 Runtime.

1. Extract this ZIP.
2. Open PowerShell in the project folder.
3. Run `npm.cmd install`.
4. Run `npm.cmd run build`.
5. Run `npm.cmd run tauri build` to produce a Windows installer/application bundle.

The `src-tauri/icons/icon.ico` file is used for the Windows application bundle. The same icon artwork is used in the app's visible brand mark.

## Manual test plan before public release
1. Launch on Windows 10 and Windows 11 separately.
2. Focus another application and press Print Screen; verify SnapText appears and is focused. Repeat from minimized state.
3. Capture the full screen, select/cancel a rectangular region with Escape, and test crop.
4. Import PNG/JPEG, save the image, and copy the image to the clipboard.
5. Extract English text; confirm recognized text is copied automatically and can be pasted into Notepad.
6. Test Bengali, Arabic, Hindi, and English samples with the Windows OCR languages/features available on the test PC. Record each result separately; a language's presence in Windows does not guarantee OCR support.
7. Test image samples with small text and varied contrast at 100%, 125%, and 150% display scaling.
8. Check app icon in title bar, taskbar, and packaged app/installer.
9. Test offline to confirm OCR is local and images are not uploaded.

## Validation status
This is a **source test package**, not a verified binary release. Native Windows compilation and real-device OCR tests must be completed on Windows before public release. Do not publish an installer until these checks pass.


## Building the Windows installer (v1.1.1)

The GitHub Actions workflow at `.github/workflows/build-windows.yml` builds a Windows NSIS installer on a Windows runner and uploads it as a workflow artifact. Run it with **Actions → Build SnapText Windows installer → Run workflow**, or push the `v1.1.1` tag. The generated installer is expected under `src-tauri/target/release/bundle/nsis/`.

This source archive is not itself an installer. The installer must be built on Windows (or by a Windows CI runner), then tested before public distribution. Unsigned builds may trigger a Windows SmartScreen warning.
