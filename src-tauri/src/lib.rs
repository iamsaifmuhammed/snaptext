use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use image::{DynamicImage, ImageFormat, imageops::FilterType};
use screenshots::Screen;
use std::{io::Cursor, sync::Mutex, thread, time::Duration};
use tauri::{Emitter, Manager, WebviewWindow, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

fn capture_display_data_url() -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("Could not list displays: {e}. Check screen-recording permissions."))?;
    let screen = screens.first().ok_or_else(|| "No display was found.".to_string())?;
    let captured = screen.capture().map_err(|e| format!("Could not capture display: {e}. Check screen-recording permissions."))?;
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(captured).write_to(&mut out, ImageFormat::Png).map_err(|e| format!("Could not encode screenshot: {e}"))?;
    Ok(format!("data:image/png;base64,{}", BASE64.encode(out.into_inner())))
}
fn restore_window(window: &WebviewWindow) { let _=window.set_fullscreen(false); let _=window.show(); let _=window.set_focus(); }

#[derive(Default)]
struct RegionCaptureState(Mutex<Option<String>>);
#[tauri::command] fn capture_screen() -> Result<String,String> { capture_display_data_url() }

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    if text.is_empty() { return Err("There is no text to copy.".into()); }
    #[cfg(target_os = "windows")]
    {
        use std::{mem::size_of, ptr};
        use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
        use windows::Win32::Foundation::{HANDLE, HWND};

        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            OpenClipboard(HWND::default()).map_err(|e| format!("Could not open the Windows clipboard: {e}"))?;
            let result = (|| -> Result<(), String> {
                EmptyClipboard().map_err(|e| format!("Could not clear the clipboard: {e}"))?;
                let memory = GlobalAlloc(GMEM_MOVEABLE, wide.len() * size_of::<u16>())
                    .map_err(|e| format!("Could not allocate clipboard memory: {e}"))?;
                let target = GlobalLock(memory);
                if target.is_null() {
                    return Err("Could not lock clipboard memory.".into());
                }
                ptr::copy_nonoverlapping(wide.as_ptr(), target.cast::<u16>(), wide.len());
                let _ = GlobalUnlock(memory);
                SetClipboardData(13u32, HANDLE(memory.0))
                    .map_err(|e| format!("Windows could not set clipboard text: {e}"))?;
                // Windows owns the memory after SetClipboardData succeeds.
                Ok(())
            })();
            let _ = CloseClipboard();
            result
        }
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = text; Err("Native clipboard writing is supported on Windows only in this release.".into()) }
}

#[tauri::command]
fn start_region_capture(app: tauri::AppHandle) -> Result<String,String> {
 let window=app.get_webview_window("main").ok_or_else(||"Could not find the SnapText window.".to_string())?;
 window.hide().map_err(|e|format!("Could not hide SnapText: {e}"))?; thread::sleep(Duration::from_millis(220));
 let screenshot=match capture_display_data_url(){Ok(v)=>v,Err(e)=>{let _=window.show();let _=window.set_focus();return Err(e)}};
 if let Err(e)=window.set_fullscreen(true){let _=window.show();let _=window.set_focus();return Err(format!("Could not open region selection: {e}"))}
 if let Err(e)=window.show(){restore_window(&window);return Err(format!("Could not show region selection: {e}"))} let _=window.set_focus(); Ok(screenshot)
}
#[tauri::command] fn finish_region_capture(app:tauri::AppHandle)->Result<(),String>{let w=app.get_webview_window("main").ok_or_else(||"Could not find the SnapText window.".to_string())?;restore_window(&w);Ok(())}

#[tauri::command]
fn open_region_overlay(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("region-overlay") { let _ = existing.close(); }
    if let Some(w) = app.get_webview_window("quick-overlay") { let _ = w.hide(); }
    if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }

    // Capture the real desktop BEFORE creating/showing the fullscreen WebView.
    // Capturing from inside the visible overlay can yield a black or stale DWM frame.
    thread::sleep(Duration::from_millis(350));
    let screenshot = match capture_display_data_url() {
        Ok(image) => image,
        Err(error) => {
            if let Some(w) = app.get_webview_window("quick-overlay") { let _ = w.show(); let _ = w.set_focus(); }
            else if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
            return Err(error);
        }
    };
    {
        let state = app.state::<RegionCaptureState>();
        let mut slot = state.0.lock().map_err(|_| "Capture state is unavailable.".to_string())?;
        *slot = Some(screenshot);
    }

    let url = WebviewUrl::App(format!("index.html?mode=region&action={}", mode).into());
    if let Err(error) = WebviewWindowBuilder::new(&app, "region-overlay", url)
        .title("SnapText Capture")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .fullscreen(true)
        .resizable(false)
        .build() {
        if let Some(w) = app.get_webview_window("quick-overlay") { let _ = w.show(); let _ = w.set_focus(); }
        else if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
        return Err(format!("Could not open capture overlay: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn capture_for_region(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<RegionCaptureState>();
    let mut slot = state.0.lock().map_err(|_| "Capture state is unavailable.".to_string())?;
    slot.take().ok_or_else(|| "Desktop snapshot was not prepared. Close the overlay and try again.".to_string())
}

#[tauri::command]
fn close_capture_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("region-overlay") { let _ = w.close(); }
    if let Some(w) = app.get_webview_window("quick-overlay") { let _ = w.close(); }
    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
    Ok(())
}


#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
    Ok(())
}

#[tauri::command]
fn open_quick_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") { let _ = main.hide(); }
    if let Some(existing) = app.get_webview_window("quick-overlay") {
        let _ = existing.show(); let _ = existing.unminimize(); let _ = existing.set_focus();
        return Ok(());
    }
    let url = WebviewUrl::App("index.html?mode=quick".into());
    WebviewWindowBuilder::new(&app, "quick-overlay", url)
        .title("SnapText Quick Actions")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .inner_size(600.0, 250.0)
        .resizable(false)
        .center()
        .build()
        .map_err(|e| format!("Could not open SnapText quick actions: {e}"))?;
    Ok(())
}

#[tauri::command]
fn extract_text_from_data_url(image_data_url:String)->Result<String,String>{
 let encoded=image_data_url.split_once(',').map(|(_,p)|p).ok_or_else(||"Invalid image data. Please open the image again.".to_string())?;
 let bytes=BASE64.decode(encoded).map_err(|_|"Could not decode image data.".to_string())?;
 #[cfg(target_os="windows")] { return windows_ocr(&bytes); }
 #[cfg(not(target_os="windows"))] { let _=bytes; Err("OCR is supported on Windows 10 and Windows 11 in this release.".into()) }
}
#[cfg(target_os="windows")]
fn preprocess_for_ocr(bytes:&[u8])->Result<Vec<u8>,String>{
 let img=image::load_from_memory(bytes).map_err(|e|format!("Could not prepare image for OCR: {e}"))?;
 let (w,h)=(img.width(),img.height()); if w==0||h==0{return Err("The image is empty.".into())}
 let scale=if w<500||h<180{3}else if w<1100||h<360{2}else{1};
 let img=if scale>1{img.resize(w.saturating_mul(scale).min(7000),h.saturating_mul(scale).min(7000),FilterType::Lanczos3)}else{img};
 let img=img.adjust_contrast(18.0); let mut out=Cursor::new(Vec::new()); img.write_to(&mut out,ImageFormat::Png).map_err(|e|format!("Could not encode enhanced OCR image: {e}"))?;Ok(out.into_inner())
}
#[cfg(target_os="windows")]
fn windows_ocr(bytes:&[u8])->Result<String,String>{
 use windows::{core::HSTRING,Graphics::Imaging::BitmapDecoder,Media::Ocr::OcrEngine,Storage::Streams::{DataWriter,InMemoryRandomAccessStream}};
 let bytes=preprocess_for_ocr(bytes)?; let stream=InMemoryRandomAccessStream::new().map_err(|e|format!("Could not create image stream: {e}"))?;
 let writer=DataWriter::CreateDataWriter(&stream).map_err(|e|format!("Could not prepare image for OCR: {e}"))?;
 writer.WriteBytes(&bytes).map_err(|e|format!("Could not load image bytes: {e}"))?;
 writer.StoreAsync().map_err(|e|format!("Could not buffer image: {e}"))?.get().map_err(|e|format!("Could not finish buffering image: {e}"))?;
 writer.FlushAsync().map_err(|e|format!("Could not flush image stream: {e}"))?.get().map_err(|e|format!("Could not flush image stream: {e}"))?;
 writer.DetachStream().map_err(|e|format!("Could not prepare image stream: {e}"))?;stream.Seek(0).map_err(|e|format!("Could not rewind image stream: {e}"))?;
 let decoder=BitmapDecoder::CreateAsync(&stream).map_err(|e|format!("Windows could not read image: {e}"))?.get().map_err(|e|format!("Windows could not decode image: {e}"))?;
 let bitmap=decoder.GetSoftwareBitmapAsync().map_err(|e|format!("Could not prepare image for OCR: {e}"))?.get().map_err(|e|format!("Could not prepare image for OCR: {e}"))?;
 let engine=OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e|format!("Could not initialize Windows OCR: {e}. Install the required OCR language packs in Windows Settings > Time & language > Language & region."))?;
 let result=engine.RecognizeAsync(&bitmap).map_err(|e|format!("Could not start OCR: {e}"))?.get().map_err(|e|format!("Windows OCR failed: {e}"))?;
 let text:HSTRING=result.Text().map_err(|e|format!("Could not read OCR text: {e}"))?;
 // Do not strip non-ASCII characters: Bengali, Arabic, Hindi and other scripts
 // must survive recognition and clipboard copying unchanged.
 Ok(text.to_string().lines().map(str::trim_end).filter(|line|!line.trim().is_empty()).collect::<Vec<_>>().join("\n"))
}

#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){
 let builder=tauri::Builder::default().plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app,shortcut,event|{
  if event.state==ShortcutState::Pressed && shortcut==&Shortcut::new(None,Code::PrintScreen){
   // 1.0.10: Print Screen is a window-activation command only. Keep the
   // experimental quick/region overlay code available but do not activate it.
   let _ = show_main_window(app.clone());
  }
 }).build()).invoke_handler(tauri::generate_handler![capture_screen,start_region_capture,finish_region_capture,extract_text_from_data_url,copy_text_to_clipboard,open_quick_overlay,open_region_overlay,capture_for_region,close_capture_overlay,show_main_window]);
 builder.setup(|app|{app.manage(RegionCaptureState::default());app.global_shortcut().register(Shortcut::new(None,Code::PrintScreen))?;Ok(())}).run(tauri::generate_context!()).expect("error while running SnapText");
}
