use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex},
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};


#[cfg(windows)]
const TASKBAR_ICON_24: tauri::image::Image<'static> = tauri::include_image!("./icons/taskbar-24.png");
#[cfg(windows)]
const TASKBAR_ICON_30: tauri::image::Image<'static> = tauri::include_image!("./icons/taskbar-30.png");
#[cfg(windows)]
const TASKBAR_ICON_36: tauri::image::Image<'static> = tauri::include_image!("./icons/taskbar-36.png");
#[cfg(windows)]
const TASKBAR_ICON_48: tauri::image::Image<'static> = tauri::include_image!("./icons/taskbar-48.png");
#[cfg(windows)]
const TASKBAR_ICON_60: tauri::image::Image<'static> = tauri::include_image!("./icons/taskbar-60.png");
#[cfg(windows)]
const TASKBAR_ICON_72: tauri::image::Image<'static> = tauri::include_image!("./icons/taskbar-72.png");
#[cfg(windows)]
const TASKBAR_ICON_96: tauri::image::Image<'static> = tauri::include_image!("./icons/taskbar-96.png");

#[cfg(windows)]
fn taskbar_icon_size_for_scale(scale_factor: f64) -> u32 {
    let target = 24.0 * scale_factor.max(1.0);
    [24_u32, 30, 36, 48, 60, 72, 96]
        .into_iter()
        .min_by(|left, right| {
            ((*left as f64 - target).abs())
                .partial_cmp(&((*right as f64 - target).abs()))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(24)
}

#[cfg(windows)]
fn taskbar_icon_for_scale(scale_factor: f64) -> tauri::image::Image<'static> {
    match taskbar_icon_size_for_scale(scale_factor) {
        30 => TASKBAR_ICON_30.clone(),
        36 => TASKBAR_ICON_36.clone(),
        48 => TASKBAR_ICON_48.clone(),
        60 => TASKBAR_ICON_60.clone(),
        72 => TASKBAR_ICON_72.clone(),
        96 => TASKBAR_ICON_96.clone(),
        _ => TASKBAR_ICON_24.clone(),
    }
}

#[cfg(windows)]
fn apply_windows_taskbar_icon(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    if let Err(error) = window.set_icon(taskbar_icon_for_scale(scale_factor)) {
        eprintln!("Failed to apply DPI-matched taskbar icon: {error}");
    }
}

#[derive(Default)]
struct PiState(Mutex<Option<PiProcess>>);

struct PiProcess {
    child: Child,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    cwd: String,
    approved: bool,
}

const PI_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const PI_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);

const MOLTEN_FORGE_DIFF_EXTENSION_SOURCE: &str = include_str!("../../src/pi/molten-forge-diff-extension.js");

fn materialize_molten_forge_diff_extension() -> Result<PathBuf, String> {
    let dir = env::temp_dir().join("molten-forge-pi");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create Molten Forge extension directory {}: {error}", dir.display()))?;
    let path = dir.join(format!("molten-forge-diff-extension-{}.js", env!("CARGO_PKG_VERSION")));
    let needs_write = fs::read_to_string(&path)
        .map(|current| current != MOLTEN_FORGE_DIFF_EXTENSION_SOURCE)
        .unwrap_or(true);
    if needs_write {
        fs::write(&path, MOLTEN_FORGE_DIFF_EXTENSION_SOURCE)
            .map_err(|error| format!("Failed to write Molten Forge diff extension {}: {error}", path.display()))?;
    }
    Ok(path)
}

impl PiProcess {
    fn close_stdin(&mut self) {
        self.stdin.take();
    }

    fn shutdown(&mut self) {
        self.close_stdin();
        if !wait_for_child_exit(&mut self.child, PI_GRACEFUL_SHUTDOWN_TIMEOUT) {
            terminate_child(&mut self.child);
        }
    }
}

impl Drop for PiProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Serialize)]
struct StartResult {
    cwd: String,
    approved: bool,
    pid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    path: String,
    id: String,
    name: Option<String>,
    first_message: Option<String>,
    timestamp: Option<String>,
    activity_timestamp: Option<String>,
    modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    cwd: String,
    activity_timestamp: Option<String>,
    modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextBreakdown {
    system_prompt_tokens: u64,
    tool_definition_tokens: u64,
    approximate: bool,
}

#[tauri::command]
fn get_default_cwd() -> Result<String, String> {
    home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine the user home directory".to_string())
}

fn pi_settings_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Could not determine the user home directory".to_string())?;
    Ok(home.join(".pi").join("agent").join("settings.json"))
}

fn with_default_model(mut settings: Value, provider: &str, model_id: &str) -> Result<Value, String> {
    if !settings.is_object() {
        settings = json!({});
    }
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "Pi settings must be a JSON object".to_string())?;
    object.insert("defaultProvider".to_string(), Value::String(provider.to_string()));
    object.insert("defaultModel".to_string(), Value::String(model_id.to_string()));
    Ok(settings)
}

#[tauri::command(rename_all = "camelCase")]
fn save_default_model(provider: String, model_id: String) -> Result<(), String> {
    let provider = provider.trim();
    let model_id = model_id.trim();
    if provider.is_empty() || model_id.is_empty() {
        return Err("Provider and model ID are required".to_string());
    }

    let path = pi_settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }

    let existing = if path.is_file() {
        let text = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        if text.trim().is_empty() { json!({}) } else {
            serde_json::from_str::<Value>(&text)
                .map_err(|error| format!("Invalid Pi settings JSON in {}: {error}", path.display()))?
        }
    } else {
        json!({})
    };

    let updated = with_default_model(existing, provider, model_id)?;
    let serialized = serde_json::to_string_pretty(&updated)
        .map_err(|error| format!("Failed to serialize Pi settings: {error}"))?;
    fs::write(&path, format!("{serialized}\n"))
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn is_external_http_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed != url || trimmed.chars().any(char::is_control) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_external_http_url(&url) {
        return Err("Only http:// and https:// URLs can be opened externally".to_string());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(&url)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| format!("Could not open the default browser: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("Could not open the default browser: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("Could not open the default browser: {error}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening external URLs is not supported on this platform".to_string())
}

// Attachments are local copies owned by Molten Forge, not references to temporary
// clipboard or browser paths. Never accept a renderer-provided destination path.
const MAX_ATTACHMENT_BYTES: u64 = 50 * 1024 * 1024;
const MAX_WEBVIEW_ATTACHMENT_BYTES: usize = 16 * 1024 * 1024;
static NEXT_ATTACHMENT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedAttachment {
    id: String,
    file_name: String,
    mime_type: String,
    byte_size: u64,
    path: String,
    kind: &'static str,
}

fn attachment_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir()
        .map_err(|error| format!("Could not resolve attachment storage: {error}"))?
        .join("attachments");
    fs::create_dir_all(&root).map_err(|error| format!("Could not create attachment storage: {error}"))?;
    Ok(root)
}

fn raster_image_mime(file_name: &str, supplied_mime: Option<&str>) -> Option<&'static str> {
    let ext = Path::new(file_name).extension()?.to_str()?.to_ascii_lowercase();
    let detected = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    };
    // Do not turn a document into an image simply because its reported MIME lies.
    if supplied_mime.is_some_and(|mime| mime.starts_with("image/") && mime != detected) {
        return None;
    }
    Some(detected)
}

fn mime_from_filename(filename: &str) -> &'static str {
    match Path::new(filename).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "txt" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" | "jsonl" => "application/json",
        "csv" => "text/csv",
        "yaml" | "yml" => "application/yaml",
        "xml" => "application/xml",
        "ts" | "tsx" => "application/typescript",
        "js" | "jsx" | "mjs" => "text/javascript",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "rs" | "py" | "go" | "java" | "c" | "cpp" | "h" | "hpp" | "sh" => "text/plain",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

fn safe_attachment_name(name: &str) -> String {
    let base = name.replace('\\', "/");
    let filename = base.rsplit('/').next().unwrap_or("").trim();
    let filtered: String = filename.chars()
        .filter(|ch| !ch.is_control() && !matches!(ch, ':' | '<' | '>' | '"' | '|' | '?' | '*'))
        .take(180).collect();
    if filtered.is_empty() || filtered == "." || filtered == ".." { return "attachment.bin".into(); }
    // Windows device names cannot be used even when an extension is present.
    let stem = filtered.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit()) {
        return format!("file-{filtered}");
    }
    filtered
}

fn new_attachment_id() -> String {
    format!("{:x}-{:x}", std::time::SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_nanos(), NEXT_ATTACHMENT_ID.fetch_add(1, Ordering::Relaxed))
}

fn make_managed_attachment(app: &AppHandle, file_name: &str, mime: Option<&str>, bytes: &[u8]) -> Result<ManagedAttachment, String> {
    let safe_name = safe_attachment_name(file_name);
    let image_mime = raster_image_mime(&safe_name, mime);
    let kind = if image_mime.is_some() { "image" } else { "file" };
    let limit = if kind == "image" { MAX_WEBVIEW_ATTACHMENT_BYTES as u64 } else { MAX_ATTACHMENT_BYTES };
    if bytes.len() as u64 > limit { return Err(format!("Attachment exceeds the {} MB size limit", limit / 1_048_576)); }
    let id = new_attachment_id();
    let dir = attachment_root(app)?.join(&id);
    fs::create_dir(&dir).map_err(|error| format!("Could not create attachment directory: {error}"))?;
    let path = dir.join(&safe_name);
    if let Err(error) = fs::write(&path, bytes) {
        let _ = fs::remove_dir_all(&dir);
        return Err(format!("Could not stage attachment: {error}"));
    }
    let resolved_mime = image_mime.map(str::to_owned)
        .or_else(|| mime.filter(|m| !m.is_empty()).map(str::to_owned))
        .unwrap_or_else(|| mime_from_filename(&safe_name).to_owned());
    Ok(ManagedAttachment { id, file_name: safe_name.clone(),
        mime_type: resolved_mime,
        byte_size: bytes.len() as u64, path: path.to_string_lossy().into(), kind })
}

#[tauri::command(rename_all = "camelCase")]
fn stage_attachment_bytes(app: AppHandle, file_name: String, mime_type: String, bytes: Vec<u8>) -> Result<ManagedAttachment, String> {
    if bytes.len() > MAX_WEBVIEW_ATTACHMENT_BYTES { return Err("Webview attachments are limited to 16 MB".into()); }
    make_managed_attachment(&app, &file_name, Some(&mime_type), &bytes)
}

fn stage_file_from_path(app: &AppHandle, source_path: &str) -> Result<ManagedAttachment, String> {
    let source = Path::new(source_path);
    let name = source.file_name().and_then(|name| name.to_str()).ok_or("File has an invalid name")?;
    let safe_name = safe_attachment_name(name);
    let metadata = source.metadata().map_err(|error| format!("Could not read file metadata: {error}"))?;
    if !metadata.is_file() { return Err("Attachments must be files".into()); }
    let image_mime = raster_image_mime(&safe_name, None);
    let max_size = if image_mime.is_some() { MAX_WEBVIEW_ATTACHMENT_BYTES as u64 } else { MAX_ATTACHMENT_BYTES };
    if metadata.len() > max_size {
        return Err(format!("{} exceeds the {} MB size limit", safe_name, max_size / 1_048_576));
    }
    let id = new_attachment_id();
    let dir = attachment_root(app)?.join(&id);
    fs::create_dir(&dir).map_err(|error| format!("Could not create attachment directory: {error}"))?;
    let dest = dir.join(&safe_name);
    let result = fs::copy(source, &dest);
    match result {
        Ok(bytes) if bytes <= max_size => Ok(ManagedAttachment {
            id, file_name: safe_name.clone(),
            mime_type: image_mime.unwrap_or_else(|| mime_from_filename(&safe_name)).into(),
            byte_size: bytes,
            path: dest.to_string_lossy().into(),
            kind: if image_mime.is_some() { "image" } else { "file" },
        }),
        Ok(_) => { let _ = fs::remove_dir_all(&dir); Err("Attachment grew beyond the file size limit during copy".into()) },
        Err(error) => { let _ = fs::remove_dir_all(&dir); Err(format!("Could not copy attachment: {error}")) },
    }
}

#[tauri::command(rename_all = "camelCase")]
fn stage_attachment_path(app: AppHandle, source_path: String) -> Result<ManagedAttachment, String> {
    stage_file_from_path(&app, &source_path)
}

#[tauri::command(rename_all = "camelCase")]
fn pick_attachments(app: AppHandle, images_only: bool) -> Result<Vec<ManagedAttachment>, String> {
    let mut dialog = rfd::FileDialog::new();
    if images_only { dialog = dialog.add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"]); }
    let Some(paths) = dialog.pick_files() else { return Ok(Vec::new()); };
    if paths.len() > 12 { return Err("Select no more than 12 attachments".into()); }
    let mut staged: Vec<ManagedAttachment> = Vec::new();
    for path in paths {
        match stage_file_from_path(&app, &path.to_string_lossy()) {
            Ok(attachment) => staged.push(attachment),
            Err(error) => {
                for attachment in staged {
                    if let Some(parent) = Path::new(&attachment.path).parent() { let _ = fs::remove_dir_all(parent); }
                }
                return Err(error);
            }
        }
    }
    Ok(staged)
}

fn is_valid_managed_location(root: &Path, path: &Path) -> bool {
    path.starts_with(root) && path.parent().and_then(Path::parent) == Some(root)
}

fn validated_managed_path(app: &AppHandle, attachment_path: &str) -> Result<PathBuf, String> {
    let root = attachment_root(app)?.canonicalize().map_err(|e| e.to_string())?;
    let path = Path::new(attachment_path).canonicalize().map_err(|e| format!("Attachment unavailable: {e}"))?;
    if !is_valid_managed_location(&root, &path) || !path.is_file() {
        return Err("Not a managed attachment path".into());
    }
    Ok(path)
}

#[tauri::command(rename_all = "camelCase")]
fn read_attachment_bytes(app: AppHandle, attachment_path: String) -> Result<Vec<u8>, String> {
    let path = validated_managed_path(&app, &attachment_path)?;
    if path.metadata().map_err(|e| e.to_string())?.len() > MAX_WEBVIEW_ATTACHMENT_BYTES as u64 {
        return Err("Image too large to send to a vision model".into());
    }
    fs::read(&path).map_err(|e| format!("Could not read staged attachment: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
fn discard_attachment(app: AppHandle, attachment_path: String) -> Result<(), String> {
    let path = validated_managed_path(&app, &attachment_path)?;
    let dir = path.parent().ok_or("Invalid attachment directory")?;
    fs::remove_dir_all(dir).map_err(|e| format!("Could not discard attachment: {e}"))
}

#[tauri::command]
fn check_pi() -> Result<String, String> {
    let output = pi_version_command()
        .output()
        .map_err(|error| format!("Could not execute Pi: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Pi exited with {}", output.status)
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if stdout.is_empty() { "Pi detected".into() } else { stdout })
}

#[tauri::command]
fn pick_folder(initial: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(initial) = initial {
        let path = PathBuf::from(initial);
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        }
    }

    Ok(dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn list_sessions(cwd: String) -> Result<Vec<SessionInfo>, String> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Ok(Vec::new());
    }

    let root = pi_session_root()?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_jsonl_files(&root, &mut files, 0)?;

    let wanted_cwd = normalize_path_for_compare(Path::new(cwd));
    let mut sessions = Vec::new();

    for path in files {
        if let Some(info) = read_session_info(&path, &wanted_cwd) {
            sessions.push(info);
        }
    }

    sessions.sort_by(|left, right| {
        let left_activity = left.activity_timestamp.as_deref().or(left.timestamp.as_deref()).unwrap_or("");
        let right_activity = right.activity_timestamp.as_deref().or(right.timestamp.as_deref()).unwrap_or("");
        right_activity
            .cmp(left_activity)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(sessions)
}

// List all directories referenced in Pi's persisted session headers. No running
// agent is needed. This metadata is separate from the active conversation list.
fn collect_project_summaries(root: &Path) -> Result<Vec<ProjectSummary>, String> {
    if !root.is_dir() { return Ok(Vec::new()); }
    let mut files = Vec::new();
    collect_jsonl_files(root, &mut files, 0)?;
    let mut projects: HashMap<String, ProjectSummary> = HashMap::new();
    for path in files {
        let Ok(file) = File::open(&path) else { continue };
        let Some(Ok(header)) = BufReader::new(file).lines().next() else { continue };
        let Ok(header) = serde_json::from_str::<Value>(&header) else { continue };
        if header.get("type").and_then(Value::as_str) != Some("session") { continue; }
        let Some(cwd) = header.get("cwd").and_then(Value::as_str) else { continue };
        if cwd.trim().is_empty() { continue; }
        let key = normalize_path_for_compare(Path::new(cwd));
        let Some(session) = read_session_info(&path, &key) else { continue };
        let timestamp = session.activity_timestamp.or(session.timestamp);
        let candidate = ProjectSummary { cwd: cwd.to_string(), activity_timestamp: timestamp, modified_at: session.modified_at };
        match projects.entry(key) {
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                let existing = entry.get();
                let old = existing.activity_timestamp.as_deref().unwrap_or("");
                let new = candidate.activity_timestamp.as_deref().unwrap_or("");
                if new > old || (new == old && candidate.modified_at > existing.modified_at) {
                    entry.insert(candidate);
                }
            }
            std::collections::hash_map::Entry::Vacant(entry) => { entry.insert(candidate); }
        }
    }
    let mut result: Vec<_> = projects.into_values().collect();
    result.sort_by(|a, b| b.activity_timestamp.cmp(&a.activity_timestamp).then_with(|| b.modified_at.cmp(&a.modified_at)));
    Ok(result)
}

#[tauri::command]
async fn list_projects() -> Result<Vec<ProjectSummary>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        collect_project_summaries(&pi_session_root()?)
    }).await.map_err(|error| format!("Project discovery failed: {error}"))?
}

// Check a historical project's cwd before disposing the running Pi process.
// Missing or renamed folders are normal for session metadata: return false,
// rather than allowing a failed startup to discard the current session.

// Read-only view of Pi resources. Pi's runtime decides what is actually loaded;
// this is an inventory of conventional and explicitly configured locations.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiResourceInfo {
    name: String,
    path: String,
    scope: String,
    description: String,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PiResources {
    skills: Vec<PiResourceInfo>,
    extensions: Vec<PiResourceInfo>,
    packages: Vec<PiResourceInfo>,
    warnings: Vec<String>,
}

fn skill_frontmatter(path: &Path) -> (String, String) {
    let text = File::open(path).and_then(|file| {
        let mut buffer = String::new();
        file.take(16 * 1024).read_to_string(&mut buffer)?;
        Ok(buffer)
    }).unwrap_or_default();
    let mut name = String::new();
    let mut description = String::new();
    if !text.starts_with("---") { return (name, description); }
    for line in text.lines().skip(1) {
        if line.trim() == "---" { break; }
        if let Some(value) = line.strip_prefix("name:") {
            name = value.trim().trim_matches(&['"', '\''][..]).to_string();
        }
        if let Some(value) = line.strip_prefix("description:") {
            description = value.trim().trim_matches(&['"', '\''][..]).to_string();
        }
    }
    (name, description)
}

fn add_pi_resource(resources: &mut Vec<PiResourceInfo>, seen: &mut std::collections::HashSet<String>, path: &Path, scope: &str, kind: &str) {
    let key = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if !seen.insert(format!("{kind}:{key}")) { return; }
    let (metadata_name, description) = if kind == "skill" { skill_frontmatter(path) } else { (String::new(), String::new()) };
    let fallback = if kind == "skill" {
        path.parent().and_then(|dir| dir.file_name())
    } else if matches!(path.file_name().and_then(|name| name.to_str()), Some("index.ts" | "index.js" | "index.mjs")) {
        path.parent().and_then(|dir| dir.file_name())
    } else { path.file_stem() };
    resources.push(PiResourceInfo {
        name: if metadata_name.is_empty() { fallback.map(|value| value.to_string_lossy().into_owned()).unwrap_or_default() } else { metadata_name },
        path: path.to_string_lossy().into_owned(),
        scope: scope.to_string(),
        description,
        kind: kind.to_string(),
    });
}

fn scan_pi_resource_path(root: &Path, scope: &str, kind: &str, result: &mut Vec<PiResourceInfo>, seen: &mut std::collections::HashSet<String>, depth: usize) {
    if result.len() >= 1000 || depth > 12 || !root.exists() { return; }
    if root.is_file() {
        let file = root.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let extension = root.extension().and_then(|s| s.to_str()).unwrap_or("");
        if (kind == "skill" && file == "SKILL.md") ||
           (kind == "extension" && matches!(extension, "ts" | "js" | "mjs" | "mts" | "cjs")) {
            add_pi_resource(result, seen, root, scope, kind);
        }
        return;
    }
    if kind == "skill" {
        let skill_file = root.join("SKILL.md");
        if skill_file.is_file() { add_pi_resource(result, seen, &skill_file, scope, kind); return; }
    } else {
        for file in ["index.ts", "index.js", "index.mjs", "index.mts"] {
            let entry = root.join(file);
            if entry.is_file() { add_pi_resource(result, seen, &entry, scope, kind); return; }
        }
    }
    // Pi auto-discovers direct extension files and immediate subdirectories
    // that expose an index entry point, not arbitrary nested helper modules.
    if kind == "extension" && depth >= 1 { return; }
    let Ok(entries) = fs::read_dir(root) else { return; };
    for entry in entries.flatten() {
        if result.len() >= 1000 { break; }
        // Avoid cycles and accidentally descending into symlinked trees.
        if entry.file_type().map(|file_type| file_type.is_symlink()).unwrap_or(true) { continue; }
        scan_pi_resource_path(&entry.path(), scope, kind, result, seen, depth + 1);
    }
}

fn expand_pi_resource_path(input: &str, base: &Path, home: &Path) -> PathBuf {
    if input == "~" { return home.to_path_buf(); }
    if let Some(tail) = input.strip_prefix("~/").or_else(|| input.strip_prefix("~\\")) { return home.join(tail); }
    let path = Path::new(input);
    if path.is_absolute() { path.to_path_buf() } else { base.join(path) }
}

fn read_pi_settings(path: &Path) -> Value {
    fs::read_to_string(path).ok().and_then(|content| serde_json::from_str::<Value>(&content).ok()).unwrap_or(Value::Null)
}

fn discover_pi_resources(cwd: &Path, home: &Path) -> PiResources {
    use std::collections::HashSet;
    let mut resources = PiResources { skills: vec![], extensions: vec![], packages: vec![], warnings: vec![] };
    let mut seen = HashSet::new();
    let global = home.join(".pi").join("agent");
    for (dir, kind) in [(global.join("skills"), "skill"), (home.join(".agents").join("skills"), "skill"),
                       (global.join("extensions"), "extension")] {
        let target = if kind == "skill" { &mut resources.skills } else { &mut resources.extensions };
        scan_pi_resource_path(&dir, "Global", kind, target, &mut seen, 0);
    }
    if cwd.is_dir() {
        // Pi's project-local skill locations can be inherited from ancestors.
        // Only inspect the project subtree for executable extensions.
        for ancestor in cwd.ancestors() {
            for dir in [ancestor.join(".pi").join("skills"), ancestor.join(".agents").join("skills")] {
                scan_pi_resource_path(&dir, "Project", "skill", &mut resources.skills, &mut seen, 0);
            }
        }
        scan_pi_resource_path(&cwd.join(".pi").join("extensions"), "Project", "extension", &mut resources.extensions, &mut seen, 0);
    }
    let mut settings_sources = vec![(global.join("settings.json"), "Global", global.clone())];
    if cwd.is_dir() {
        settings_sources.push((cwd.join(".pi").join("settings.json"), "Project", cwd.join(".pi")));
    }
    for (settings_file, scope, base) in settings_sources {
        let settings = read_pi_settings(&settings_file);
        for (field, kind) in [("skills", "skill"), ("extensions", "extension")] {
            if let Some(paths) = settings.get(field).and_then(Value::as_array) {
                for path in paths.iter().filter_map(Value::as_str) {
                    // +/- patterns are Pi filtering directives, not resource files.
                    if path.starts_with('!') || path.starts_with('+') || path.starts_with('-') { continue; }
                    if path.starts_with("builtin:") { continue; }
                    if path.contains('*') || path.contains('?') {
                        resources.warnings.push(format!("Configured {field} glob is not expanded in this inventory: {path}"));
                        continue;
                    }
                    let resolved = expand_pi_resource_path(path, &base, home);
                    let target = if kind == "skill" { &mut resources.skills } else { &mut resources.extensions };
                    if kind == "skill" && resolved.is_file() && resolved.extension().and_then(|value| value.to_str()) == Some("md") {
                        add_pi_resource(target, &mut seen, &resolved, scope, kind);
                    } else {
                        scan_pi_resource_path(&resolved, scope, kind, target, &mut seen, 0);
                    }
                }
            }
        }
        if let Some(packages) = settings.get("packages").and_then(Value::as_array) {
            for package in packages {
                let source = package.as_str().or_else(|| package.get("source").and_then(Value::as_str));
                if let Some(source) = source {
                    if seen.insert(format!("package:{scope}:{source}")) {
                        resources.packages.push(PiResourceInfo {
                            name: source.to_string(), path: settings_file.to_string_lossy().into_owned(),
                            scope: scope.to_string(), description: "Configured package (may contain skills and extensions)".into(),
                            kind: "package".into(),
                        });
                    }
                }
            }
        }
    }
    for list in [&mut resources.skills, &mut resources.extensions, &mut resources.packages] {
        list.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()).then(left.path.cmp(&right.path)));
    }
    resources
}

#[tauri::command]
fn list_pi_resources(cwd: String) -> PiResources {
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"))
        .map(PathBuf::from).unwrap_or_default();
    let project = PathBuf::from(&cwd);
    discover_pi_resources(&project, &home)
}

// Read a discovered skill manifest as plain text, never execute or modify it.
// Keep the read bounded so a malformed/huge skill cannot freeze Settings.
fn read_skill_manifest(path: &Path) -> Result<String, String> {
    let manifest = if path.is_dir() { path.join("SKILL.md") } else { path.to_path_buf() };
    if manifest.file_name().and_then(|part| part.to_str()) != Some("SKILL.md") {
        return Err("Only SKILL.md manifests can be viewed here".into());
    }
    let info = fs::metadata(&manifest).map_err(|err| format!("Cannot read skill: {err}"))?;
    if !info.is_file() { return Err("Skill manifest does not exist".into()); }
    if info.len() > 256 * 1024 { return Err("Skill manifest exceeds the 256 KiB read-only preview limit".into()); }
    fs::read_to_string(manifest).map_err(|err| format!("Cannot decode SKILL.md: {err}"))
}

#[tauri::command]
fn read_pi_skill(path: String) -> Result<String, String> {
    read_skill_manifest(Path::new(path.trim()))
}

#[tauri::command]
fn open_pi_resource_root(kind: String) -> Result<(), String> {
    if kind != "skills" { return Err("Unsupported resource root".into()); }
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"))
        .map(PathBuf::from).ok_or("Home directory unavailable")?;
    let primary = home.join(".pi").join("agent").join("skills");
    let agents = home.join(".agents").join("skills");
    let directory = if primary.is_dir() { primary } else if agents.is_dir() { agents } else {
        return Err("No global skills directory found under ~/.pi/agent/skills or ~/.agents/skills".into());
    };
    open_project_in_explorer(directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn project_directory_exists(path: String) -> bool {
    !path.trim().is_empty() && Path::new(path.trim()).is_dir()
}

// Open the directory directly, without invoking a shell or switching the Pi agent.
#[tauri::command]
fn open_project_in_explorer(path: String) -> Result<(), String> {
    let directory = PathBuf::from(path.trim());
    if !directory.is_dir() { return Err(format!("Project directory does not exist: {}", directory.display())); }
    #[cfg(target_os = "windows")]
    let mut process = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut process = Command::new("open");
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut process = Command::new("xdg-open");
    process.arg(&directory).spawn().map_err(|error| format!("Could not open folder: {error}"))?;
    Ok(())
}

// Open the folder containing an installed skill or extension. A resource may be
// a SKILL.md file, an extension entrypoint, or an entire resource directory.
fn resource_directory(path: &Path) -> Result<PathBuf, String> {
    if path.is_dir() { return Ok(path.to_path_buf()); }
    if path.is_file() {
        return path.parent().map(Path::to_path_buf)
            .ok_or_else(|| format!("Resource has no parent directory: {}", path.display()));
    }
    Err(format!("Resource does not exist: {}", path.display()))
}

#[tauri::command]
fn open_resource_folder(path: String) -> Result<(), String> {
    let directory = resource_directory(Path::new(path.trim()))?;
    open_project_in_explorer(directory.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
fn analyze_session_context(session_path: String) -> Result<ContextBreakdown, String> {
    let path = PathBuf::from(session_path.trim());
    if !path.is_file() {
        return Err(format!("Session file does not exist: {}", path.display()));
    }

    let file = File::open(&path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let reader = BufReader::new(file);
    let mut sections: HashMap<String, String> = HashMap::new();
    let mut tools: HashMap<String, Value> = HashMap::new();

    for line in reader.lines().map_while(Result::ok) {
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if entry.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let Some(message) = entry.get("message") else {
            continue;
        };
        if message.get("role").and_then(Value::as_str) != Some("system") {
            continue;
        }

        if let Some(next_sections) = message.get("sections").and_then(Value::as_object) {
            for (name, value) in next_sections {
                if value.is_null() {
                    sections.remove(name);
                } else if let Some(text) = value.as_str() {
                    sections.insert(name.clone(), text.to_string());
                } else {
                    sections.insert(name.clone(), value.to_string());
                }
            }
        }

        if let Some(added) = message.get("toolsAdded").and_then(Value::as_array) {
            for tool in added {
                if let Some(name) = tool.get("name").and_then(Value::as_str) {
                    tools.insert(name.to_string(), tool.clone());
                }
            }
        }

        if let Some(removed) = message.get("toolsRemoved").and_then(Value::as_array) {
            for value in removed {
                if let Some(name) = value.as_str().or_else(|| value.get("name").and_then(Value::as_str)) {
                    tools.remove(name);
                }
            }
        }
    }

    let system_chars: usize = sections.values().map(|value| value.chars().count()).sum();
    let tool_chars: usize = tools
        .values()
        .map(|value| serde_json::to_string(value).map(|text| text.chars().count()).unwrap_or(0))
        .sum();

    Ok(ContextBreakdown {
        system_prompt_tokens: approximate_tokens(system_chars),
        tool_definition_tokens: approximate_tokens(tool_chars),
        approximate: true,
    })
}

fn approximate_tokens(char_count: usize) -> u64 {
    ((char_count as u64) + 3) / 4
}

#[tauri::command]
fn get_pi_runtime_status(state: State<'_, PiState>) -> Result<Option<StartResult>, String> {
    let mut guard = state.0.lock().map_err(|_| "Pi state lock poisoned".to_string())?;
    let Some(process) = guard.as_mut() else {
        return Ok(None);
    };

    match process.child.try_wait() {
        Ok(None) => Ok(Some(StartResult {
            cwd: process.cwd.clone(),
            approved: process.approved,
            pid: process.child.id(),
        })),
        Ok(Some(_)) | Err(_) => {
            *guard = None;
            Ok(None)
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
fn start_pi(
    app: AppHandle,
    state: State<'_, PiState>,
    cwd: String,
    approve_project: bool,
    use_diff_extension: Option<bool>,
) -> Result<StartResult, String> {
    let cwd_path = PathBuf::from(cwd.trim());
    if !cwd_path.is_dir() {
        return Err(format!("Working directory does not exist: {}", cwd_path.display()));
    }

    let mut guard = state.0.lock().map_err(|_| "Pi state lock poisoned".to_string())?;
    if let Some(process) = guard.as_mut() {
        match process.child.try_wait() {
            Ok(None) => {
                let requested = normalize_path_for_compare(&cwd_path);
                let running = normalize_path_for_compare(Path::new(&process.cwd));
                if requested == running {
                    return Ok(StartResult {
                        cwd: process.cwd.clone(),
                        approved: process.approved,
                        pid: process.child.id(),
                    });
                }
                return Err(format!(
                    "Pi is already running in {}",
                    process.cwd
                ));
            }
            Ok(Some(_)) | Err(_) => {
                *guard = None;
            }
        }
    }

    let diff_extension_path = if use_diff_extension.unwrap_or(true) {
        Some(materialize_molten_forge_diff_extension()?)
    } else {
        None
    };
    let mut command = pi_rpc_command(approve_project, diff_extension_path.as_deref());
    command
        .current_dir(&cwd_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start `pi --mode rpc`: {error}"))?;

    let stdin = child.stdin.take().ok_or("Pi stdin was not available")?;
    let stdout = child.stdout.take().ok_or("Pi stdout was not available")?;
    let stderr = child.stderr.take().ok_or("Pi stderr was not available")?;

    let pid = child.id();
    spawn_stdout_reader(app.clone(), stdout, pid);
    spawn_stderr_reader(app.clone(), stderr);

    *guard = Some(PiProcess {
        child,
        stdin: Some(Arc::new(Mutex::new(stdin))),
        cwd: cwd_path.to_string_lossy().to_string(),
        approved: approve_project,
    });
    drop(guard);

    let _ = app.emit("pi-process", json!({ "state": "started", "pid": pid }));

    Ok(StartResult {
        cwd: cwd_path.to_string_lossy().to_string(),
        approved: approve_project,
        pid,
    })
}

#[tauri::command]
fn send_rpc(state: State<'_, PiState>, record: String) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(&record)
        .map_err(|error| format!("RPC command must be valid JSON: {error}"))?;
    if !parsed.is_object() {
        return Err("RPC command must be a JSON object".into());
    }

    let guard = state.0.lock().map_err(|_| "Pi state lock poisoned".to_string())?;
    let process = guard.as_ref().ok_or("Pi is not running")?;
    let stdin = process.stdin.as_ref().ok_or("Pi stdin is closed")?;
    let mut stdin = stdin.lock().map_err(|_| "Pi stdin lock poisoned".to_string())?;

    stdin.write_all(record.as_bytes()).map_err(|error| error.to_string())?;
    stdin.write_all(b"\n").map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_pi(app: AppHandle, state: State<'_, PiState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Pi state lock poisoned".to_string())?;
    let mut process = guard.take();
    drop(guard);
    let pid = process.as_ref().map(|process| process.child.id());
    if let Some(process) = process.as_mut() {
        process.shutdown();
    }
    drop(process);
    let _ = app.emit("pi-process", json!({ "state": "stopped", "pid": pid }));
    Ok(())
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(path) = env::var_os("USERPROFILE") {
            return Some(PathBuf::from(path));
        }
        match (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
            (Some(drive), Some(path)) => {
                let mut combined = PathBuf::from(drive);
                combined.push(path);
                return Some(combined);
            }
            _ => {}
        }
    }

    env::var_os("HOME").map(PathBuf::from)
}

fn expand_tilde(path: &str, base: &Path) -> PathBuf {
    if path == "~" {
        return home_dir().unwrap_or_else(|| base.to_path_buf());
    }
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        return home_dir().unwrap_or_else(|| base.to_path_buf()).join(rest);
    }

    let candidate = PathBuf::from(path);
    if candidate.is_absolute() {
        candidate
    } else {
        base.join(candidate)
    }
}

fn pi_session_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Could not determine the user home directory".to_string())?;
    let agent_dir = home.join(".pi").join("agent");

    if let Some(value) = env::var_os("PI_CODING_AGENT_SESSION_DIR") {
        let value = value.to_string_lossy();
        if !value.trim().is_empty() {
            return Ok(expand_tilde(value.trim(), &agent_dir));
        }
    }

    let settings_path = agent_dir.join("settings.json");
    if let Ok(text) = fs::read_to_string(&settings_path) {
        if let Ok(settings) = serde_json::from_str::<Value>(&text) {
            if let Some(session_dir) = settings.get("sessionDir").and_then(Value::as_str) {
                if !session_dir.trim().is_empty() {
                    return Ok(expand_tilde(session_dir.trim(), &agent_dir));
                }
            }
        }
    }

    Ok(agent_dir.join("sessions"))
}

fn collect_jsonl_files(dir: &Path, output: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to read {}: {error}", dir.display())),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, output, depth + 1)?;
        } else if path.extension().and_then(|value| value.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl")) {
            output.push(path);
        }
    }

    Ok(())
}

fn normalize_path_for_compare(path: &Path) -> String {
    let value = path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();

    #[cfg(windows)]
    {
        value.to_lowercase()
    }

    #[cfg(not(windows))]
    {
        value
    }
}

fn session_entry_counts_as_activity(entry: &Value) -> bool {
    match entry.get("type").and_then(Value::as_str) {
        Some("message") => entry
            .get("message")
            .and_then(|message| message.get("role"))
            .and_then(Value::as_str)
            .is_some_and(|role| role != "system"),
        Some("compaction") | Some("branch_summary") => true,
        Some("custom_message") => entry.get("display").and_then(Value::as_bool).unwrap_or(false),
        // model/thinking/default-state/session-name/labels/custom metadata should
        // not make a chat look newly active in the sidebar.
        _ => false,
    }
}

fn read_session_info(path: &Path, wanted_cwd: &str) -> Option<SessionInfo> {
    let file = File::open(path).ok()?;
    let metadata = file.metadata().ok();
    let mut lines = BufReader::new(file).lines();
    let header: Value = serde_json::from_str(&lines.next()?.ok()?).ok()?;

    if header.get("type").and_then(Value::as_str) != Some("session") {
        return None;
    }

    let session_cwd = header.get("cwd").and_then(Value::as_str)?;
    if normalize_path_for_compare(Path::new(session_cwd)) != wanted_cwd {
        return None;
    }

    let mut name: Option<String> = None;
    let mut first_message: Option<String> = None;
    let mut activity_timestamp: Option<String> = None;

    for line in lines.map_while(Result::ok) {
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        if session_entry_counts_as_activity(&entry) {
            if let Some(timestamp) = entry.get("timestamp").and_then(Value::as_str) {
                activity_timestamp = Some(timestamp.to_string());
            }
        }

        match entry.get("type").and_then(Value::as_str) {
            Some("session_info") => {
                name = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned);
            }
            Some("message") if first_message.is_none() => {
                let message = entry.get("message")?;
                if message.get("role").and_then(Value::as_str) == Some("user") {
                    first_message = extract_message_text(message.get("content"));
                }
            }
            _ => {}
        }
    }

    let modified_at = metadata
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    Some(SessionInfo {
        path: path.to_string_lossy().to_string(),
        id: header.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
        name,
        first_message,
        timestamp: header.get("timestamp").and_then(Value::as_str).map(ToOwned::to_owned),
        activity_timestamp,
        modified_at,
    })
}

fn extract_message_text(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::String(value) => {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(" ");
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        _ => None,
    }
}

fn spawn_stdout_reader<R: Read + Send + 'static>(app: AppHandle, stdout: R, pid: u32) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            match reader.read_until(b'\n', &mut bytes) {
                Ok(0) => break,
                Ok(_) => {
                    if bytes.last() == Some(&b'\n') {
                        bytes.pop();
                    }
                    if bytes.last() == Some(&b'\r') {
                        bytes.pop();
                    }
                    if bytes.is_empty() {
                        continue;
                    }
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    let _ = app.emit("pi-record", line);
                }
                Err(error) => {
                    let _ = app.emit("pi-stderr", format!("Failed reading Pi stdout: {error}"));
                    break;
                }
            }
        }
        let _ = app.emit("pi-process", json!({ "state": "exited", "pid": pid }));
    });
}

fn spawn_stderr_reader<R: Read + Send + 'static>(app: AppHandle, stderr: R) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        loop {
            let mut bytes = Vec::new();
            match reader.read_until(b'\n', &mut bytes) {
                Ok(0) => break,
                Ok(_) => {
                    if bytes.last() == Some(&b'\n') {
                        bytes.pop();
                    }
                    if bytes.last() == Some(&b'\r') {
                        bytes.pop();
                    }
                    if !bytes.is_empty() {
                        let _ = app.emit("pi-stderr", String::from_utf8_lossy(&bytes).to_string());
                    }
                }
                Err(_) => break,
            }
        }
    });
}

#[cfg(windows)]
fn windows_pi_program() -> PathBuf {
    if let Some(path_value) = env::var_os("PATH") {
        for directory in env::split_paths(&path_value) {
            // npm installs Pi as pi.cmd on Windows, while a native install may
            // provide pi.exe. Resolve the actual launcher first so Rust can
            // pass each RPC argument separately instead of routing an entire
            // command line through cmd.exe /C (whose quote parsing is different).
            for file_name in ["pi.exe", "pi.cmd", "pi.bat", "pi.com"] {
                let candidate = directory.join(file_name);
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }

    // Keep the normal npm-installed launcher as the final PATH-resolved fallback.
    PathBuf::from("pi.cmd")
}

#[cfg(windows)]
fn pi_version_command() -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut command = Command::new(windows_pi_program());
    command.arg("--version");
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn pi_version_command() -> Command {
    let mut command = Command::new("pi");
    command.arg("--version");
    command
}

#[cfg(windows)]
fn pi_rpc_command(approve_project: bool, extension_path: Option<&Path>) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut command = Command::new(windows_pi_program());
    command.args(["--mode", "rpc"]);
    if let Some(extension_path) = extension_path {
        command.arg("-e");
        command.arg(extension_path);
    }
    if approve_project {
        command.arg("--approve");
    }
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn pi_rpc_command(approve_project: bool, extension_path: Option<&Path>) -> Command {
    let mut command = Command::new("pi");
    command.args(["--mode", "rpc"]);
    if let Some(extension_path) = extension_path {
        command.arg("-e");
        command.arg(extension_path);
    }
    if approve_project {
        command.arg("--approve");
    }
    command
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if Instant::now() >= deadline {
                    return false;
                }
                thread::sleep(PI_EXIT_POLL_INTERVAL);
            }
            Err(_) => return false,
        }
    }
}

#[cfg(windows)]
fn terminate_child(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let pid = child.id().to_string();
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid, "/T", "/F"]);
    command.creation_flags(CREATE_NO_WINDOW);
    let _ = command.status();
    let _ = child.wait();
}

#[cfg(not(windows))]
fn terminate_child(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(windows)]
            apply_windows_taskbar_icon(app);
            Ok(())
        })
        .manage(PiState::default())
        .invoke_handler(tauri::generate_handler![
            get_default_cwd,
            pick_attachments,
            stage_attachment_path,
            stage_attachment_bytes,
            read_attachment_bytes,
            discard_attachment,
            save_default_model,
            open_external_url,
            check_pi,
            pick_folder,
            list_sessions,
            list_projects,
            list_pi_resources,
            read_pi_skill,
            open_pi_resource_root,
            project_directory_exists,
            open_project_in_explorer,
            open_resource_folder,
            analyze_session_context,
            get_pi_runtime_status,
            start_pi,
            send_rpc,
            stop_pi,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Molten Forge");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn project_directory_preflight_checks_current_path() {
        let path = std::env::temp_dir();
        assert!(project_directory_exists(path.to_string_lossy().to_string()));
        assert!(!project_directory_exists(String::new()));
        assert!(!project_directory_exists(path.join("molten-forge-never-existing-project")
            .to_string_lossy().to_string()));
    }


    #[test]
    fn read_only_skill_preview_requires_a_small_manifest() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let folder = env::temp_dir().join(format!("molten-forge-skill-preview-{}-{unique}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let manifest = folder.join("SKILL.md");
        fs::write(&manifest, "---\nname: test\n---\n# Content").unwrap();
        assert!(read_skill_manifest(&folder).unwrap().contains("# Content"));
        assert!(read_skill_manifest(&manifest).unwrap().contains("# Content"));
        assert!(read_skill_manifest(&folder.join("other.md")).is_err());
        fs::write(&manifest, "x".repeat(256 * 1024 + 1)).unwrap();
        assert!(read_skill_manifest(&manifest).is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn resource_folders_resolve_files_and_directories() {
        let directory = std::env::temp_dir();
        let file = directory.join(format!("molten-forge-resource-{}", std::process::id()));
        std::fs::write(&file, b"test").expect("write temp resource");
        assert_eq!(resource_directory(&file).unwrap(), directory);
        assert_eq!(resource_directory(&directory).unwrap(), directory);
        assert!(resource_directory(&directory.join("molten-forge-resource-missing")).is_err());
        std::fs::remove_file(file).expect("remove temp resource");
    }

    #[test]
    fn attachment_filename_and_kind_are_conservative() {
        assert_eq!(safe_attachment_name("C:\\Users\\test\\log.txt"), "log.txt");
        assert_eq!(safe_attachment_name("../../CON.txt"), "file-CON.txt");
        assert_eq!(safe_attachment_name("???"), "attachment.bin");
        assert_eq!(raster_image_mime("shot.PNG", None), Some("image/png"));
        assert_eq!(raster_image_mime("photo.jpg", Some("image/png")), None);
        assert_eq!(raster_image_mime("malicious.svg", None), None);
        assert_eq!(mime_from_filename("sample.json"), "application/json");
    }

    #[test]
    fn managed_attachment_location_never_accepts_siblings_or_nested_paths() {
        let root = Path::new("/app/attachments");
        assert!(is_valid_managed_location(root, Path::new("/app/attachments/id/file.txt")));
        assert!(!is_valid_managed_location(root, Path::new("/app/other/id/file.txt")));
        assert!(!is_valid_managed_location(root, Path::new("/app/attachments/id/extra/file.txt")));
        assert!(!is_valid_managed_location(root, Path::new("/app/attachments/file.txt")));
    }

    #[test]
    fn external_url_validation_only_accepts_http_and_https() {
        assert!(is_external_http_url("https://example.com/path?q=1"));
        assert!(is_external_http_url("http://localhost:3000"));
        assert!(!is_external_http_url("javascript:alert(1)"));
        assert!(!is_external_http_url("file:///tmp/test"));
        assert!(!is_external_http_url("https://example.com\nnext"));
    }

    #[test]
    fn materializes_the_bundled_diff_extension_for_pi() {
        let path = materialize_molten_forge_diff_extension().expect("materialized diff extension");
        let source = fs::read_to_string(&path).expect("read materialized diff extension");
        assert_eq!(source, MOLTEN_FORGE_DIFF_EXTENSION_SOURCE);
        assert_eq!(path.extension().and_then(|value| value.to_str()), Some("js"));
        assert!(path.file_name().and_then(|value| value.to_str()).unwrap_or_default().contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn approximate_tokens_rounds_up_by_four_chars() {
        assert_eq!(approximate_tokens(0), 0);
        assert_eq!(approximate_tokens(1), 1);
        assert_eq!(approximate_tokens(4), 1);
        assert_eq!(approximate_tokens(5), 2);
        assert_eq!(approximate_tokens(17), 5);
    }

    #[test]
    fn extract_message_text_supports_string_and_text_parts() {
        let string = Value::String("  hello  ".into());
        assert_eq!(extract_message_text(Some(&string)).as_deref(), Some("hello"));

        let parts = json!([
            {"type": "text", "text": "first"},
            {"type": "image", "url": "ignored"},
            {"type": "text", "text": "second"}
        ]);
        assert_eq!(extract_message_text(Some(&parts)).as_deref(), Some("first second"));

        let empty = Value::String("   ".into());
        assert_eq!(extract_message_text(Some(&empty)), None);
    }

    #[test]
    fn normalize_path_removes_trailing_separator() {
        let normalized = normalize_path_for_compare(Path::new("folder/subfolder/"));
        assert!(normalized.ends_with("folder/subfolder"));
        assert!(!normalized.ends_with('/'));
    }

    #[cfg(windows)]
    #[test]
    fn normalize_path_is_case_insensitive_on_windows() {
        assert_eq!(
            normalize_path_for_compare(Path::new(r"C:\\Users\\Acer")),
            normalize_path_for_compare(Path::new(r"c:\\users\\acer\\")),
        );
    }


    #[cfg(windows)]
    #[test]
    fn taskbar_icon_size_matches_common_windows_taskbar_dpi_targets() {
        assert_eq!(taskbar_icon_size_for_scale(1.0), 24);
        assert_eq!(taskbar_icon_size_for_scale(1.25), 30);
        assert_eq!(taskbar_icon_size_for_scale(1.5), 36);
        assert_eq!(taskbar_icon_size_for_scale(2.0), 48);
        assert_eq!(taskbar_icon_size_for_scale(2.5), 60);
        assert_eq!(taskbar_icon_size_for_scale(3.0), 72);
        assert_eq!(taskbar_icon_size_for_scale(4.0), 96);
    }

    #[test]
    fn with_default_model_preserves_other_settings() {
        let settings = json!({
            "theme": "dark",
            "compaction": {"enabled": true},
            "defaultProvider": "old",
            "defaultModel": "old-model"
        });
        let updated = with_default_model(settings, "Llama.cpp", "ornith").expect("settings update");
        assert_eq!(updated.get("defaultProvider").and_then(Value::as_str), Some("Llama.cpp"));
        assert_eq!(updated.get("defaultModel").and_then(Value::as_str), Some("ornith"));
        assert_eq!(updated.get("theme").and_then(Value::as_str), Some("dark"));
        assert_eq!(updated.pointer("/compaction/enabled").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn read_session_info_extracts_name_and_first_user_message() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let dir = env::temp_dir().join(format!("molten-forge-pi-test-{}-{unique}", std::process::id()));
        fs::create_dir_all(&dir).expect("test temp directory");
        let session_path = dir.join("session.jsonl");
        let cwd = dir.join("project");
        fs::create_dir_all(&cwd).expect("project temp directory");

        let content = format!(
            "{}\n{}\n{}\n{}\n",
            json!({"type":"session","id":"session-1","cwd":cwd,"timestamp":"2026-09-24T00:00:00Z"}),
            json!({"type":"session_info","name":"  My session  ","timestamp":"2026-09-24T00:00:00.500Z"}),
            json!({"type":"message","timestamp":"2026-09-24T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"First prompt"}]}}),
            json!({"type":"model_change","timestamp":"2026-09-24T00:10:00.000Z","provider":"openai","modelId":"gpt-test"}),
        );
        fs::write(&session_path, content).expect("write session fixture");

        let wanted = normalize_path_for_compare(&cwd);
        let info = read_session_info(&session_path, &wanted).expect("session should match cwd");
        assert_eq!(info.id, "session-1");
        assert_eq!(info.name.as_deref(), Some("My session"));
        assert_eq!(info.first_message.as_deref(), Some("First prompt"));
        assert_eq!(info.activity_timestamp.as_deref(), Some("2026-09-24T00:00:01.000Z"));

        let other = normalize_path_for_compare(&dir.join("other"));
        assert!(read_session_info(&session_path, &other).is_none());

        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn project_discovery_groups_session_headers_and_uses_message_activity() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let root = env::temp_dir().join(format!("molten-forge-projects-{}-{unique}", std::process::id()));
        let a = root.join("alpha");
        let b = root.join("beta");
        fs::create_dir_all(&a).expect("create a");
        fs::create_dir_all(&b).expect("create b");
        let a_cwd = root.join("work-a").to_string_lossy().to_string();
        let b_cwd = root.join("work-b").to_string_lossy().to_string();
        let session = |cwd: &str, timestamp: &str| format!("{}\n{}\n{}\n",
            json!({"type":"session","id":"session-1","cwd":cwd,"timestamp":"2026-01-01T00:00:00Z"}),
            json!({"type":"message","timestamp":timestamp,"message":{"role":"user","content":"hello"}}),
            json!({"type":"model_change","timestamp":"2026-12-31T00:00:00Z"}),
        );
        fs::write(a.join("one.jsonl"), session(&a_cwd, "2026-01-02T00:00:00Z")).expect("a1");
        fs::write(a.join("two.jsonl"), session(&a_cwd, "2026-01-04T00:00:00Z")).expect("a2");
        fs::write(b.join("one.jsonl"), session(&b_cwd, "2026-01-03T00:00:00Z")).expect("b1");
        let summaries = collect_project_summaries(&root).expect("project discovery");
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].cwd, a_cwd);
        assert_eq!(summaries[0].activity_timestamp.as_deref(), Some("2026-01-04T00:00:00Z"));
        assert_eq!(summaries[1].cwd, b_cwd);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pi_resource_inventory_finds_project_and_global_resources_without_executing() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let root = env::temp_dir().join(format!("mf-pi-resources-{}-{unique}", std::process::id()));
        let home = root.join("home");
        let cwd = root.join("project");
        let global_skill = home.join(".pi/agent/skills/coding");
        let project_skill = cwd.join(".agents/skills/markdown");
        let extension = cwd.join(".pi/extensions/custom");
        for path in [&global_skill, &project_skill, &extension] { fs::create_dir_all(path).expect("create resource dir"); }
        fs::write(global_skill.join("SKILL.md"), "---\nname: coding\ndescription: Improve code\n---\n").expect("global skill");
        fs::write(project_skill.join("SKILL.md"), "---\nname: markdown\ndescription: Render Markdown\n---\n").expect("project skill");
        fs::write(extension.join("index.ts"), "export default () => {};").expect("extension");
        fs::write(extension.join("README.md"), "not a skill").expect("readme");
        fs::write(cwd.join(".pi/settings.json"), r#"{"packages":["npm:example-pkg"],"extensions":["extensions/custom"]}"#).expect("settings");
        let inventory = discover_pi_resources(&cwd, &home);
        // Ancestor walking is real Pi behavior: a cwd nested under the user home
        // also inherits that home's own `.agents/skills`, so assert on the entries
        // this fixture created instead of on a machine-dependent total.
        let skill_names: Vec<&str> = inventory.skills.iter().map(|skill| skill.name.as_str()).collect();
        assert!(skill_names.contains(&"coding"), "missing global skill: {skill_names:?}");
        assert!(skill_names.contains(&"markdown"), "missing project skill: {skill_names:?}");
        let coding = inventory.skills.iter().find(|skill| skill.name == "coding").expect("global skill entry");
        assert_eq!(coding.scope, "Global");
        let markdown = inventory.skills.iter().find(|skill| skill.name == "markdown").expect("project skill entry");
        assert_eq!(markdown.scope, "Project");
        // `README.md` beside the extension entry point is not itself a skill.
        assert!(!skill_names.contains(&"README"), "README was misclassified as a skill: {skill_names:?}");
        assert_eq!(inventory.extensions.len(), 1);
        assert_eq!(inventory.extensions[0].name, "custom");
        assert_eq!(inventory.packages[0].name, "npm:example-pkg");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pi_resource_inventory_does_not_escape_into_unrelated_ancestor_skill_dirs() {
        // A project outside the user home must not inherit skills from the home
        // directory; only the fixture's own global and project skills are visible.
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let root = env::temp_dir().join(format!("mf-pi-isolated-{}-{unique}", std::process::id()));
        let home = root.join("home");
        let cwd = root.join("project");
        let global_skill = home.join(".pi/agent/skills/coding");
        let project_skill = cwd.join(".agents/skills/markdown");
        for path in [&global_skill, &project_skill, &cwd] { fs::create_dir_all(path).expect("create resource dir"); }
        fs::write(global_skill.join("SKILL.md"), "---\nname: coding\n---\n").expect("global skill");
        fs::write(project_skill.join("SKILL.md"), "---\nname: markdown\n---\n").expect("project skill");
        let inventory = discover_pi_resources(&cwd, &home);
        let skill_names: Vec<&str> = inventory.skills.iter().map(|skill| skill.name.as_str()).collect();
        // `coding` appears once through the explicit global path, not twice via ancestry.
        assert_eq!(skill_names.iter().filter(|name| **name == "coding").count(), 1, "{skill_names:?}");
        assert_eq!(skill_names.iter().filter(|name| **name == "markdown").count(), 1, "{skill_names:?}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn session_activity_ignores_state_only_model_changes() {
        let user = json!({
            "type":"message",
            "timestamp":"2026-09-24T10:00:00.000Z",
            "message":{"role":"user","content":"hello"}
        });
        let model = json!({
            "type":"model_change",
            "timestamp":"2026-09-24T12:00:00.000Z",
            "provider":"openai",
            "modelId":"gpt-test"
        });
        let compact = json!({
            "type":"compaction",
            "timestamp":"2026-09-24T13:00:00.000Z",
            "tokensBefore":120000
        });

        assert!(session_entry_counts_as_activity(&user));
        assert!(!session_entry_counts_as_activity(&model));
        assert!(session_entry_counts_as_activity(&compact));
    }

}
