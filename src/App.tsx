import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

type Rect = { x: number; y: number; width: number; height: number };

async function captureScreen(): Promise<string> {
  return await invoke<string>('capture_screen');
}

async function cropImage(imageUrl: string, rect: Rect, image: HTMLImageElement): Promise<string> {
  const scaleX = image.naturalWidth / image.clientWidth;
  const scaleY = image.naturalHeight / image.clientHeight;
  const sx = Math.round(rect.x * scaleX);
  const sy = Math.round(rect.y * scaleY);
  const sw = Math.max(1, Math.round(rect.width * scaleX));
  const sh = Math.max(1, Math.round(rect.height * scaleY));
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(sw, image.naturalWidth - sx);
  canvas.height = Math.min(sh, image.naturalHeight - sy);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not crop this image.');
  context.drawImage(image, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}


function QuickActionWindow() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Choose an action');
  async function close() { await invoke('close_capture_overlay'); }
  async function captureWholeScreen() {
    setBusy(true); setMessage('Capturing display…');
    try {
      const image = await invoke<string>('capture_screen');
      await emitCaptureResult({ image, text: '', mode: 'capture' });
      await invoke('show_main_window');
      await getCurrentWindow().close();
    } catch (e) { setMessage(String(e)); setBusy(false); }
  }
  async function startRegion(mode: 'region' | 'ocr') {
    setBusy(true);
    try { await invoke('open_region_overlay', { mode }); }
    catch (e) { setMessage(String(e)); setBusy(false); }
  }
  return <main className="quick-window">
    <header className="quick-window-header"><div className="brand-mark"><img src="/snaptext-icon.png" alt="" /></div><div><strong>SnapText</strong><p>What would you like to do?</p></div><button className="quick-close" onClick={() => void close()} aria-label="Close">×</button></header>
    <div className="quick-window-actions">
      <button disabled={busy} onClick={() => void startRegion('region')}><span>⌗</span><strong>Select Region</strong><small>Capture a rectangle</small></button>
      <button disabled={busy} onClick={() => void captureWholeScreen()}><span>▣</span><strong>Capture Screen</strong><small>Capture the full display</small></button>
      <button disabled={busy} onClick={() => void startRegion('ocr')}><span>T</span><strong>Extract Text</strong><small>Select text and copy it</small></button>
    </div>
    <p className="quick-window-status">{busy ? message : 'Print Screen · Esc to close'}</p>
  </main>;
}

async function emitCaptureResult(payload: { image: string; text: string; mode: string }) {
  const { emit } = await import('@tauri-apps/api/event');
  await emit('snaptext://capture-result', payload);
}

function RegionOverlayWindow() {
  const [desktopImage, setDesktopImage] = useState<string | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [mode, setMode] = useState<'region' | 'ocr'>(() => new URLSearchParams(window.location.search).get('action') === 'ocr' ? 'ocr' : 'region');
  const [error, setError] = useState('');
  const dragStart = useRef<{x:number;y:number}|null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    void invoke<string>('capture_for_region').then(image => { if (!cancelled) setDesktopImage(image); }).catch(e => setError(String(e)));
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void invoke('close_capture_overlay'); } };
    window.addEventListener('keydown', onKey);
    return () => { cancelled = true; window.removeEventListener('keydown', onKey); };
  }, []);
  function point(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(r.width, e.clientX-r.left)), y: Math.max(0, Math.min(r.height, e.clientY-r.top)) };
  }
  function down(e: React.PointerEvent<HTMLDivElement>) { if (!desktopImage) return; e.currentTarget.setPointerCapture(e.pointerId); const p=point(e); dragStart.current=p; setSelection({...p,width:0,height:0}); }
  function move(e: React.PointerEvent<HTMLDivElement>) { if (!dragStart.current) return; const p=point(e), s=dragStart.current; setSelection({x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),width:Math.abs(p.x-s.x),height:Math.abs(p.y-s.y)}); }
  async function up(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || !desktopImage) return;
    const p=point(e), s=dragStart.current; dragStart.current=null;
    const rect={x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),width:Math.abs(p.x-s.x),height:Math.abs(p.y-s.y)};
    const image=new Image(); image.src=desktopImage;
    try { await image.decode(); } catch { setError('Could not read the captured display.'); return; }
    if(rect.width<8||rect.height<8){setSelection(null);return;}
    const sx=image.naturalWidth/stageRef.current!.clientWidth, sy=image.naturalHeight/stageRef.current!.clientHeight;
    const x=Math.round(rect.x*sx), y=Math.round(rect.y*sy), w=Math.max(1,Math.min(image.naturalWidth-x,Math.round(rect.width*sx))), h=Math.max(1,Math.min(image.naturalHeight-y,Math.round(rect.height*sy)));
    const canvas=document.createElement('canvas'); canvas.width=w;canvas.height=h; const ctx=canvas.getContext('2d'); if(!ctx){setError('Could not crop selection.');return;} ctx.drawImage(image,x,y,w,h,0,0,w,h); const cropped=canvas.toDataURL('image/png');
    if(mode==='ocr'){
      try { const text=await invoke<string>('extract_text_from_data_url',{imageDataUrl:cropped}); if(!text.trim()){setError('No text found. Try a larger or sharper selection.');return;} await invoke('copy_text_to_clipboard',{text}); await emitCaptureResult({image:cropped,text,mode:'ocr'}); await invoke('close_capture_overlay'); }
      catch(e){setError(`OCR or clipboard failed: ${String(e)}`);}
    } else { await emitCaptureResult({image:cropped,text:'',mode:'region'}); await invoke('close_capture_overlay'); }
  }
  return <main className="desktop-region-overlay">
    {desktopImage && <div ref={stageRef} className="desktop-region-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <img src={desktopImage} alt="Desktop" draggable={false}/><div className="desktop-region-shade"/>
      {selection && <div className="desktop-region-selection" style={{left:selection.x,top:selection.y,width:selection.width,height:selection.height}}/>}
    </div>}
    <div className="desktop-region-toolbar"><span>{mode==='ocr'?'Select text to extract':'Drag to capture a region'}</span><span>Esc to cancel</span></div>
    {error && <div className="overlay-error">{error} · Press Esc to close</div>}
  </main>;
}

export default function App() {
  const windowMode = new URLSearchParams(window.location.search).get('mode');
  if (windowMode === 'quick') return <QuickActionWindow />;
  if (windowMode === 'region') return <RegionOverlayWindow />;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [desktopRegionImage, setDesktopRegionImage] = useState<string | null>(null);
  const [desktopRegionMode, setDesktopRegionMode] = useState(false);
  const [status, setStatus] = useState('Ready when you are.');
  const [busy, setBusy] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [quickOverlayOpen, setQuickOverlayOpen] = useState(false);
  const [extractAfterRegion, setExtractAfterRegion] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const desktopImageRef = useRef<HTMLImageElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void listen<{image:string;text:string;mode:string}>('snaptext://capture-result', event => { const payload = event.payload; setImageUrl(payload.image); setRecognizedText(payload.text || ''); setStatus(payload.mode === 'ocr' ? 'Text extracted and copied to the system clipboard.' : 'Screenshot ready. Save, copy, or extract text.'); }).then((unlisten) => { dispose = unlisten; });
    return () => { dispose?.(); };
  }, []);

  function onQuickSelectRegion() { setQuickOverlayOpen(false); setExtractAfterRegion(false); void onStartDesktopRegion(); }
  function onQuickCaptureScreen() { setQuickOverlayOpen(false); setExtractAfterRegion(false); void onCapture(); }
  function onQuickExtractText() { setQuickOverlayOpen(false); setExtractAfterRegion(true); void onStartDesktopRegion(); }

  async function onCapture() {
    setBusy(true);
    setStatus('Capturing your display…');
    try {
      const dataUrl = await captureScreen();
      setImageUrl(dataUrl);
      setRecognizedText('');
      setStatus('Screenshot captured. You can save it, copy it, select a region, or extract text.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onStartDesktopRegion() {
    setBusy(true);
    setStatus('Preparing region selection…');
    try {
      // The native side hides SnapText, captures the desktop, then switches this window
      // to fullscreen so the user can select directly against the captured desktop image.
      const dataUrl = await invoke<string>('start_region_capture');
      setDesktopRegionImage(dataUrl);
      setSelection(null);
      setDesktopRegionMode(true);
      setRecognizedText('');
      setQuickOverlayOpen(false);
      setStatus(extractAfterRegion ? 'Select an area to extract text. Press Esc to cancel.' : 'Drag over the desktop image to capture a region. Press Esc to cancel.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function finishDesktopRegion() {
    setDesktopRegionMode(false);
    setSelection(null);
    dragStart.current = null;
    setDesktopRegionImage(null);
    try {
      await invoke('finish_region_capture');
    } catch (error) {
      setStatus(`Could not restore the SnapText window: ${String(error)}`);
    }
  }

  useEffect(() => {
    if (!desktopRegionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void finishDesktopRegion();
        setStatus('Region capture cancelled.');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [desktopRegionMode]);

  function pointerPosition(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  }

  function onDesktopPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!desktopRegionMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    dragStart.current = point;
    setSelection({ ...point, width: 0, height: 0 });
  }

  function onDesktopPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!desktopRegionMode || !dragStart.current) return;
    const point = pointerPosition(event);
    const start = dragStart.current;
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  async function onDesktopPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!desktopRegionMode || !dragStart.current) return;
    const point = pointerPosition(event);
    const start = dragStart.current;
    const rect = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    dragStart.current = null;
    const image = desktopImageRef.current;
    if (!image || rect.width < 8 || rect.height < 8) {
      setSelection(null);
      setStatus('Selection too small. Drag a larger rectangle, or press Esc to cancel.');
      return;
    }

    try {
      const cropped = await cropImage(desktopRegionImage!, rect, image);
      await finishDesktopRegion();
      setImageUrl(cropped);
      setRecognizedText('');
      if (extractAfterRegion) {
        setBusy(true);
        setStatus('Recognizing text locally…');
        try {
          const text = await invoke<string>('extract_text_from_data_url', { imageDataUrl: cropped });
          setRecognizedText(text);
          if (text.trim()) { await invoke('copy_text_to_clipboard', { text }); setStatus('Text extracted and copied to the system clipboard. Paste it with Ctrl+V.'); }
          else { setStatus('No text found. Try selecting a larger, sharper region.'); }
        } catch (error) { setStatus(`Text extraction failed: ${String(error)}`); }
        finally { setBusy(false); setExtractAfterRegion(false); }
      } else { setStatus('Desktop region captured. Save it, copy it, or extract text.'); }
    } catch (error) {
      await finishDesktopRegion();
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function onRegionPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectingRegion) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    dragStart.current = point;
    setSelection({ ...point, width: 0, height: 0 });
  }

  function onRegionPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectingRegion || !dragStart.current) return;
    const point = pointerPosition(event);
    const start = dragStart.current;
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  async function onRegionPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectingRegion || !dragStart.current) return;
    const point = pointerPosition(event);
    const start = dragStart.current;
    const rect = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    dragStart.current = null;
    const image = imageRef.current;
    if (!image || rect.width < 8 || rect.height < 8) {
      setStatus('Selection too small. Drag a larger rectangle.');
      setSelection(null);
      return;
    }
    try {
      const cropped = await cropImage(imageUrl!, rect, image);
      setImageUrl(cropped);
      setRecognizedText('');
      setSelectingRegion(false);
      setSelection(null);
      setStatus('Image region cropped. You can save, copy, or extract text.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function onCopyImage() {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setStatus('Screenshot copied to clipboard.');
    } catch {
      setStatus('Clipboard image access was blocked by the runtime. Use Save image for now.');
    }
  }

  function onSave() {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `snaptext-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    link.click();
    setStatus('Save requested.');
  }

  async function onExtractText() {
    if (!imageUrl) {
      setStatus('Capture a screenshot or choose an image first.');
      return;
    }
    setBusy(true);
    setStatus('Recognizing text locally…');
    try {
      const text = await invoke<string>('extract_text_from_data_url', { imageDataUrl: imageUrl });
      setRecognizedText(text);
      if (text.trim()) {
        await invoke('copy_text_to_clipboard', { text });
        setStatus('Text extracted and copied to the system clipboard. Paste it with Ctrl+V.');
      } else {
        setStatus('No text found in this image.');
      }
    } catch (error) {
      setStatus(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onCopyText() {
    if (!recognizedText.trim()) {
      setStatus('There is no recognized text to copy yet.');
      return;
    }
    try {
      // Use the native OS clipboard so this works reliably from a Tauri WebView.
      await invoke('copy_text_to_clipboard', { text: recognizedText });
      setStatus('Text copied to the system clipboard.');
    } catch (error) {
      setStatus(`Could not copy text to the clipboard: ${String(error)}`);
    }
  }

  async function onChooseImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Please choose an image file.');
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
      });
      setImageUrl(dataUrl);
      setRecognizedText('');
      setStatus(`Loaded ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  }

  if (desktopRegionMode && desktopRegionImage) {
    return (
      <main className="desktop-region-overlay">
        <div
          className="desktop-region-stage"
          onPointerDown={onDesktopPointerDown}
          onPointerMove={onDesktopPointerMove}
          onPointerUp={onDesktopPointerUp}
          role="application"
          aria-label="Select a desktop screenshot region"
        >
          <img ref={desktopImageRef} src={desktopRegionImage} alt="Captured desktop for region selection" draggable={false} />
          <div className="desktop-region-shade" />
          {selection && (
            <div
              className="desktop-region-selection"
              style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}
            />
          )}
        </div>
        <div className="desktop-region-toolbar">
          <span>Drag to capture a region</span>
          <span>Esc to cancel</span>
        </div>
      </main>
    );
  }

  return (
    <>
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><img src="/snaptext-icon.png" alt="" /></div>
        <div><div className="brand-name">SnapText</div><div className="brand-caption">Screenshot, then copy what matters.</div></div>
        <span className="privacy-pill"><span /> Local-first</span>
      </header>

      <section className="intro">
        <p className="eyebrow">LIGHTWEIGHT DESKTOP UTILITY</p>
        <h1>Capture it.<br /><em>Find the words.</em></h1>
        <p className="intro-copy">A focused screenshot workspace designed to stay out of your way.</p>
      </section>

      <section className="actions" aria-label="Screenshot actions">
        <button className="primary-button" onClick={onCapture} disabled={busy}><span>⌗</span>{busy ? 'Working…' : 'Capture screen'}</button>
        <button className="secondary-button" onClick={onStartDesktopRegion} disabled={busy}>Select desktop region</button>
        <button className="secondary-button" onClick={() => fileInput.current?.click()} disabled={busy}>Open image</button>
        <button
          className="secondary-button"
          onClick={() => {
            if (!imageUrl) {
              setStatus('Capture a screen or open an image first, then select a region.');
              return;
            }
            setSelectingRegion(value => !value);
            setSelection(null);
            setStatus(selectingRegion ? 'Image region selection cancelled.' : 'Drag a rectangle over the preview image to crop it.');
          }}
          disabled={busy || !imageUrl}
        >
          {selectingRegion ? 'Cancel image crop' : 'Crop image'}
        </button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={onChooseImage} />
      </section>

      <section className="workspace">
        <div className="section-heading"><div><span className="step-number">01</span><h2>Screenshot</h2></div><span className="subtle-label">PNG</span></div>
        <div className={`preview ${imageUrl ? 'has-image' : ''}`}>
          {imageUrl ? (
            <div
              className={`image-select-wrap ${selectingRegion ? 'selecting' : ''}`}
              onPointerDown={onRegionPointerDown}
              onPointerMove={onRegionPointerMove}
              onPointerUp={onRegionPointerUp}
            >
              <img ref={imageRef} src={imageUrl} alt="Current screenshot preview" draggable={false} />
              {selectingRegion && <div className="selection-overlay" aria-label="Drag to crop a region">{selection && <div className="selection-rectangle" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}</div>}
            </div>
          ) : (
            <div className="empty-state"><div className="empty-icon">▧</div><strong>Your screenshot appears here</strong><span>Capture your screen or open an image file.</span></div>
          )}
        </div>
        {selectingRegion && <p className="helper-copy region-hint">Drag a rectangle over the preview image to crop it.</p>}
        <div className="button-row"><button className="text-button" onClick={onSave} disabled={!imageUrl}>↓ Save image</button><button className="text-button" onClick={onCopyImage} disabled={!imageUrl}>▢ Copy image</button></div>
      </section>

      <section className="workspace ocr-workspace">
        <div className="section-heading"><div><span className="step-number">02</span><h2>Extract text</h2></div><span className="subtle-label">WINDOWS · ON-DEVICE OCR</span></div>
        <p className="helper-copy">Recognize text locally using Windows OCR. Available languages depend on Windows OCR language support; images are not uploaded.</p>
        <button className="ocr-button" onClick={onExtractText} disabled={!imageUrl || busy}>⌕ Extract text</button>
        <textarea aria-label="Extracted text" value={recognizedText} onChange={(event) => setRecognizedText(event.target.value)} placeholder="Recognized text will appear here…" rows={5} />
        <div className="button-row"><span className="status-message" role="status">{status}</span><button className="text-button" onClick={onCopyText} disabled={!recognizedText}>Copy text ↗</button></div>
      </section>

      <footer><span>SNAPTEXT · VERSION 1.0.10</span><span>No account. No cloud upload.</span></footer>
    </main>
    </>
  );
}
