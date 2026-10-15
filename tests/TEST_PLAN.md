# SnapText 1.0.2 test plan

## Build and launch
- [ ] `npm.cmd install` completes without errors.
- [ ] Run with `$env:CARGO_TARGET_DIR = "J:\snaptext-build"` followed by `npm.cmd run tauri dev`.
- [ ] App launches with no React runtime errors.
- [ ] Window restores to normal size after desktop-region selection or cancellation.

## Desktop-region capture
- [ ] Click **Select desktop region**; SnapText hides before capture.
- [ ] Fullscreen selector shows the captured desktop without the SnapText window.
- [ ] Drag top-left to bottom-right; selected crop matches the drawn rectangle.
- [ ] Drag bottom-right to top-left; selection direction does not matter.
- [ ] A selection of less than 8 CSS pixels is rejected with a useful status.
- [ ] Press `Esc`; selector cancels and main window returns.
- [ ] Captured crop can be saved as PNG and pasted from Copy image.
- [ ] Test Windows display scaling at 100%, 125%, 150%, and 200%.
- [ ] Test on a multi-monitor setup; confirm/document that first detected display is used.
- [ ] Test if capture or fullscreen switching fails; window should not remain hidden.

## Windows OCR
- [ ] Load an image with large clear English text; recognized text appears.
- [ ] Capture a desktop region containing English text and extract it.
- [ ] Copy text and paste into Notepad.
- [ ] Image with no text returns empty output and a readable status.
- [ ] English text mixed with Arabic, Bengali, Chinese, or Cyrillic scripts does not return non-ASCII scripts.
- [ ] Test accented Latin letters and note that this version's ASCII filter may omit them.
- [ ] Test when Windows Windows OCR support is missing; error explains language availability.
- [ ] Confirm OCR works with network disconnected.
- [ ] Confirm no screenshot content is sent over the network.

## Regression
- [ ] Full-screen capture still works.
- [ ] Open image supports PNG/JPEG/WebP where the WebView can decode them.
- [ ] Crop image preview still works.
- [ ] Save image works.
- [ ] Copy image works or reports clipboard errors clearly.
- [ ] Extracted text is editable.
- [ ] Existing UI remains usable in a narrow window.

## Release gates
- [ ] No crash or stuck-hidden window in 20 repeated region captures.
- [ ] No known silent data loss.
- [ ] Record idle RAM and OCR latency on a representative PC.


## 1.0.3 acceptance tests
- [ ] App renders at startup.
- [ ] Global Print Screen opens the quick overlay when app is unfocused.
- [ ] Select Region returns the selected desktop rectangle.
- [ ] Capture Screen captures the primary display.
- [ ] Extract Text captures a region, runs Windows OCR, and copies successful text.
- [ ] OCR preprocessing improves or does not regress small-text samples.
- [ ] PNG/JPEG import, OCR, and clipboard copy work.
- [ ] Save/copy image still work.
- [ ] Escape cancels selection.
- [ ] OCR is local and makes no network requests.


## SnapText 1.0.4 additions

- Verify OCR automatically copies text using the native Windows clipboard command; paste into Notepad with Ctrl+V.
- Verify the Copy text button with the same paste test.
- If Print Screen opens Windows Snipping Tool, disable Settings → Accessibility → Keyboard → Use the Print screen key to open screen capture, then restart SnapText and retest.


## Windows multilingual OCR limitations
- [ ] Test Bengali, Arabic, Hindi, and English separately on Windows 10 and Windows 11.
- [ ] Record which language OCR packs/features are installed on each test machine.
- [ ] Do not assume language display support means OCR recognition support. Bengali OCR is a known unverified capability with native Windows OCR.
- [ ] If required scripts fail, evaluate an offline bundled OCR engine and language data before claiming multilingual support.
