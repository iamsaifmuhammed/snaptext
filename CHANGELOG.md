# Changelog

## 1.1.1 — First public Windows release candidate

- Set application version consistently to 1.1.1.
- Target Windows installer packaging through the included Windows CI workflow.
- Preserve the tested 1.0.10 application behavior.
- This source package does not itself contain a compiled or signed installer.

# Changelog

## 1.0.10
- Narrowed this release to Windows 10 and Windows 11; removed macOS Vision/Swift OCR and `pbcopy` clipboard code.
- Added the existing app icon to visible app branding, in addition to its bundle-icon use.
- Clarified native Windows OCR language limitations in the UI and documentation.
- Preserved Unicode output, successful-extraction auto-copy, and existing capture/image workflows.
- Retained Print Screen behavior that focuses the main application window.
- Known limitation: broad Bengali, Arabic, and Hindi OCR is not guaranteed by Windows' built-in OCR engine. A bundled offline multilingual engine may be needed after testing.

## 1.0.9
- Print Screen focuses the main window.
- Windows OCR uses the current user's available OCR language resources and preserves Unicode.
- Successful extraction automatically copies recognized text.
