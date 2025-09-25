use tauri::{AppHandle, Manager};
use tauri::async_runtime;
use tauri::Emitter;
use tauri_plugin_shell::{process::{CommandEvent, CommandChild}, ShellExt};
use std::sync::Mutex;

// Application state management
struct ProcState {
    child: Mutex<Option<CommandChild>>,
    peer_info: Mutex<Option<String>>,
    fetching_peer_info: Mutex<bool>,
}

// Constants
const DEFRA_KEYRING_SECRET: &str = "your-secret-key-here";
const SCHEMA_DEFINITION: &str = r#"type Note {
    title: String
    content: String
    workspace: String
    createdAt: DateTime
    updatedAt: DateTime
    authorId: String
}"#;

// Helper function to create DefraDB command with common settings
fn create_defradb_command(app_handle: &AppHandle, args: &[&str]) -> tauri_plugin_shell::process::Command {
    app_handle
        .shell()
        .sidecar("defradb")
        .expect("failed to locate defradb sidecar")
        .args(args)
        .env("DEFRA_KEYRING_SECRET", DEFRA_KEYRING_SECRET)
}

// Helper function to emit logs to frontend
fn emit_log(app_handle: &AppHandle, message: &str) {
    let _ = app_handle.emit("defradb-log", message);
}

// Schema management functions
async fn check_schema_exists(app_handle: &AppHandle) -> bool {
    let cmd = create_defradb_command(app_handle, &["client", "schema", "list"]);

    match cmd.spawn() {
        Ok((mut rx, _child)) => {
            let mut output = String::new();
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        output.push_str(&line_str);
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        output.push_str(&line_str);
                    }
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
            output.contains("\"Name\": \"Note\"") || output.contains("Note")
        }
        Err(e) => {
            emit_log(app_handle, &format!("Schema check failed: {}", e));
            false
        }
    }
}

async fn create_note_schema(app_handle: &AppHandle) -> bool {
    if check_schema_exists(app_handle).await {
        emit_log(app_handle, "Note schema already exists");
        return true;
    }

    let cmd = create_defradb_command(app_handle, &["client", "schema", "add", SCHEMA_DEFINITION]);

    match cmd.spawn() {
        Ok((mut rx, _child)) => {
            let mut success = false;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let output = String::from_utf8_lossy(&line).to_string();
                        emit_log(app_handle, &output);
                        if output.contains("successfully") || output.contains("already exists") {
                            success = true;
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        let output = String::from_utf8_lossy(&line).to_string();
                        if output.contains("already exists") {
                            emit_log(app_handle, &output);
                            success = true;
                        } else {
                            eprintln!("DefraDB Schema Error: {}", output);
                            emit_log(app_handle, &output);
                        }
                    }
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
            success
        }
        Err(e) => {
            emit_log(app_handle, &format!("Schema creation error: {}", e));
            false
        }
    }
}

// Peer management functions
async fn fetch_peer_info(app_handle: &AppHandle) -> Option<String> {
    let cmd = create_defradb_command(app_handle, &["client", "p2p", "info"]);

    let (mut rx, _child) = match cmd.spawn() {
        Ok(res) => res,
        Err(e) => {
            emit_log(app_handle, &format!("Peer info spawn error: {}", e));
            return None;
        }
    };

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                output.push_str(&String::from_utf8_lossy(&line));
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }

    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }

    println!("DefraDB Peer Info (raw): {}", trimmed);

    // Validate JSON structure
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let has_id = val.get("ID").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
        let has_addrs = val.get("Addrs").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        if has_id || has_addrs {
            return Some(val.to_string());
        }
    }

    None
}

async fn fetch_and_store_peer_info_with_retries(app_handle: &AppHandle) {
    // Prevent concurrent fetches
    {
        let state = app_handle.state::<ProcState>();
        if state.peer_info.lock().unwrap().is_some() {
            return;
        }
        let mut fetching = state.fetching_peer_info.lock().unwrap();
        if *fetching {
            return;
        }
        *fetching = true;
    }

    const MAX_ATTEMPTS: u32 = 8;
    const BACKOFF_MS: u64 = 500;

    for attempt in 1..=MAX_ATTEMPTS {
        if let Some(info) = fetch_peer_info(app_handle).await {
            let state = app_handle.state::<ProcState>();
            {
                let mut store = state.peer_info.lock().unwrap();
                *store = Some(info.clone());
            }

            println!("Emitting peer info event: {}", info);
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&info) {
                println!("Emitting parsed peer info: {:?}", parsed);
                let _ = app_handle.emit("defradb-peer-info", parsed);
            } else {
                let _ = app_handle.emit("defradb-peer-info", info);
            }
            break;
        }

        if attempt < MAX_ATTEMPTS {
            emit_log(app_handle, &format!("Peer info not ready (attempt {}/{})", attempt, MAX_ATTEMPTS));
            tokio::time::sleep(std::time::Duration::from_millis(BACKOFF_MS)).await;
        }
    }

    // Reset fetching flag
    let state = app_handle.state::<ProcState>();
    let mut fetching = state.fetching_peer_info.lock().unwrap();
    *fetching = false;
}

// Keyring management
async fn run_keyring_generate(app_handle: &AppHandle) -> bool {
    let cmd = create_defradb_command(app_handle, &["keyring", "generate"]);

    match cmd.spawn() {
        Ok((mut rx, _child)) => {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                        let output = String::from_utf8_lossy(&line).to_string();
                        println!("DefraDB Keyring: {}", output);
                        emit_log(app_handle, &output);
                    }
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
            true
        }
        Err(e) => {
            emit_log(app_handle, &format!("Keyring generation error: {}", e));
            false
        }
    }
}

// DefraDB process management
async fn start_defradb_with_keyring_retry(app_handle: &AppHandle) {
    let mut tried_keygen = false;

    'start: loop {
        let cmd = create_defradb_command(app_handle, &[
            "start", 
            "--allowed-origins", "http://localhost:1420", 
            "--rootdir", "./.defradb"
        ]);

        let (mut rx, child) = match cmd.spawn() {
            Ok(res) => res,
            Err(e) => {
                emit_log(app_handle, &format!("Spawn error: {}", e));
                if !tried_keygen && run_keyring_generate(app_handle).await {
                    tried_keygen = true;
                    continue 'start;
                }
                return;
            }
        };

        // Store child process for cleanup
        {
            let state = app_handle.state::<ProcState>();
            let mut lock = state.child.lock().unwrap();
            *lock = Some(child);
        }

        // Reset peer info state
        {
            let state = app_handle.state::<ProcState>();
            {
                let mut store = state.peer_info.lock().unwrap();
                *store = None;
            }
            {
                let mut fetching = state.fetching_peer_info.lock().unwrap();
                *fetching = false;
            }
        }

        // Start background tasks
        {
            let app_handle_clone = app_handle.clone();
            async_runtime::spawn(async move {
                fetch_and_store_peer_info_with_retries(&app_handle_clone).await;
            });
        }

        // Create schema after DefraDB starts
        {
            let app_handle_clone = app_handle.clone();
            async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                emit_log(&app_handle_clone, "Checking Note schema...");
                
                const MAX_SCHEMA_ATTEMPTS: u32 = 3;
                for attempt in 1..=MAX_SCHEMA_ATTEMPTS {
                    if create_note_schema(&app_handle_clone).await {
                        emit_log(&app_handle_clone, "Note schema ready");
                        break;
                    } else if attempt < MAX_SCHEMA_ATTEMPTS {
                        emit_log(&app_handle_clone, &format!("Schema creation attempt {}/{} failed, retrying...", attempt, MAX_SCHEMA_ATTEMPTS));
                        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                    } else {
                        emit_log(&app_handle_clone, "Failed to create Note schema after multiple attempts");
                    }
                }
            });
        }

        // Process DefraDB output
        let mut saw_any_output = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    saw_any_output = true;
                    let output = String::from_utf8_lossy(&line).to_string();
                    println!("DefraDB: {}", output);
                    emit_log(app_handle, &output);
                }
                CommandEvent::Stderr(line) => {
                    saw_any_output = true;
                    let output = String::from_utf8_lossy(&line).to_string();
                    eprintln!("DefraDB Error: {}", output);
                    emit_log(app_handle, &output);
                }
                CommandEvent::Terminated(_) => {
                    if !saw_any_output && !tried_keygen {
                        if run_keyring_generate(app_handle).await {
                            tried_keygen = true;
                            continue 'start;
                        }
                    } else {
                        let _ = app_handle.emit("defradb-exit", ());
                    }
                    
                    // Clear stored child on termination
                    {
                        let state = app_handle.state::<ProcState>();
                        let mut lock = state.child.lock().unwrap();
                        let _ = lock.take();
                    }
                    break;
                }
                _ => {}
            }
        }

        // Cleanup and exit
        {
            let state = app_handle.state::<ProcState>();
            let mut lock = state.child.lock().unwrap();
            let _ = lock.take();
        }
        break;
    }
}

// Tauri command handlers
#[tauri::command]
async fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
async fn get_peer_info(app_handle: AppHandle) -> Option<String> {
    let state = app_handle.state::<ProcState>();
    let guard = state.peer_info.lock().unwrap();
    guard.clone()
}

#[tauri::command]
async fn create_schema(app_handle: AppHandle) -> bool {
    create_note_schema(&app_handle).await
}

#[tauri::command]
async fn connect_to_peer(app_handle: AppHandle, peer_id: String) -> Result<String, String> {
    println!("Connecting to peer: {}", peer_id);
    
    let cmd = create_defradb_command(&app_handle, &["client", "p2p", "replicator", "set", "-c", "Note", &peer_id]);

    match cmd.output().await {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let exit_status = output.status;
            
            println!("Command completed with exit status: {:?}", exit_status);
            println!("STDOUT: '{}'", stdout);
            println!("STDERR: '{}'", stderr);
            
            // Success = empty output AND successful exit status
            let has_output = !stdout.trim().is_empty() || !stderr.trim().is_empty();
            let success = !has_output && exit_status.success();
            
            println!("Peer connection result - success: {}, has_output: {}, exit_status: {:?}", 
                    success, has_output, exit_status);
            
            if success {
                Ok(format!("Successfully connected to peer: {}", peer_id))
            } else {
                let error_msg = if has_output {
                    format!("Failed to connect to peer. Error: stdout='{}', stderr='{}'", stdout, stderr)
                } else {
                    format!("Failed to connect to peer. Exit status: {:?}", exit_status)
                };
                Err(error_msg)
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to execute defradb command: {}", e);
            eprintln!("{}", error_msg);
            emit_log(&app_handle, &error_msg);
            Err(error_msg)
        }
    }
}

#[tauri::command]
async fn check_peer_connections(app_handle: AppHandle) -> Result<bool, String> {
    let cmd = create_defradb_command(&app_handle, &["client", "p2p", "replicator", "getall"]);

    match cmd.spawn() {
        Ok((mut rx, _child)) => {
            let mut output = String::new();
            
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line).to_string();
                        output.push_str(&line_str);
                        println!("DefraDB Peer Connections: {}", line_str);
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line).to_string();
                        output.push_str(&line_str);
                        eprintln!("DefraDB Peer Connections Error: {}", line_str);
                    }
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }

            let trimmed = output.trim();
            println!("Raw peer connections output: {}", trimmed);

            // Parse as JSON array
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if let Some(array) = parsed.as_array() {
                    let has_connections = !array.is_empty();
                    println!("Peer connections found: {}", has_connections);
                    return Ok(has_connections);
                }
            }

            // Fallback check
            let has_connections = !trimmed.is_empty() && trimmed != "[]" && trimmed != "null";
            println!("Peer connections (fallback check): {}", has_connections);
            Ok(has_connections)
        }
        Err(e) => {
            let error_msg = format!("Failed to check peer connections: {}", e);
            eprintln!("{}", error_msg);
            Err(error_msg)
        }
    }
}

// Application entry point
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(ProcState { 
            child: Mutex::new(None), 
            peer_info: Mutex::new(None), 
            fetching_peer_info: Mutex::new(false)
        })
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
                window.close_devtools();
            }

            let app_handle = app.handle().clone();

            // Cleanup on window close
            {
                let app_handle_clone = app.handle().clone();
                window.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { .. } = e {
                        let state = app_handle_clone.state::<ProcState>();
                        let mut lock = state.child.lock().unwrap();
                        if let Some(child) = lock.take() {
                            let _ = child.kill();
                        }
                    }
                });
            }

            // Handle Ctrl+C
            {
                let app_handle_clone = app.handle().clone();
                async_runtime::spawn(async move {
                    if tokio::signal::ctrl_c().await.is_ok() {
                        let state = app_handle_clone.state::<ProcState>();
                        let mut lock = state.child.lock().unwrap();
                        if let Some(child) = lock.take() {
                            let _ = child.kill();
                        }
                    }
                });
            }

            // Start DefraDB
            async_runtime::spawn(async move {
                start_defradb_with_keyring_retry(&app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping, 
            get_peer_info, 
            create_schema, 
            connect_to_peer, 
            check_peer_connections
        ])
        .run(tauri::generate_context!());
}