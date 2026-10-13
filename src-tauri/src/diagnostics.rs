//! Startup diagnostics available before Tauri creates its first window.
//!
//! Logging is intentionally independent of the frontend and best effort: a
//! locked file or unwritable profile must never stop the application starting.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, Once, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_LOG_BYTES: u64 = 256 * 1024;
const MAX_MESSAGE_CHARS: usize = 2_000;
const MAX_STAGE_CHARS: usize = 80;

static INITIALIZE: Once = Once::new();
static LOG: OnceLock<Option<LogSink>> = OnceLock::new();
static ERROR_SHOWN: AtomicBool = AtomicBool::new(false);

struct LogSink {
    path: PathBuf,
    lock: Mutex<()>,
}

impl LogSink {
    fn append(&self, stage: &str, message: &str) -> io::Result<()> {
        // A panic on another thread must not make diagnostics unusable.
        let _guard = match self.lock.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let line = format!(
            "{}.{:03} pid={} [{}] {}\n",
            timestamp.as_secs(),
            timestamp.subsec_millis(),
            std::process::id(),
            single_line(stage, MAX_STAGE_CHARS),
            single_line(message, MAX_MESSAGE_CHARS),
        );
        append_bounded(&self.path, line.as_bytes(), MAX_LOG_BYTES)
    }
}

/// Call before building Tauri, so configuration/runtime failures are recorded.
pub(crate) fn initialize() {
    INITIALIZE.call_once(|| {
        let primary = std::env::var_os("LOCALAPPDATA")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .map(|path| path.join("com.pedro.agente-pedro").join("logs"));
        let fallback = std::env::temp_dir().join("agente-pedro").join("logs");
        let _ = LOG.set(choose_log_sink(primary.as_deref(), &fallback));

        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let message = info.to_string();
            write("panic", &message);
            show_error_once(&message);
            previous(info);
        }));

        let executable = std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|error| format!("indisponivel: {error}"));
        write(
            "process-start",
            format!(
                "version={} debug={} custom-protocol={} executable={executable}",
                option_env!("CARGO_PKG_VERSION").unwrap_or("unknown"),
                cfg!(debug_assertions),
                cfg!(feature = "custom-protocol"),
            ),
        );
    });
}

pub(crate) fn write(stage: &str, message: impl AsRef<str>) {
    if let Some(Some(log)) = LOG.get() {
        let _ = log.append(stage, message.as_ref());
    }
}

pub(crate) fn log_path() -> Option<&'static Path> {
    LOG.get()
        .and_then(|log| log.as_ref())
        .map(|log| log.path.as_path())
}

/// Persist a startup failure and make it visible in a Windows release build.
pub(crate) fn fatal(message: &str) {
    write("fatal", message);
    // append() releases its mutex before a modal native message box is shown.
    show_error_once(message);
}

fn choose_log_sink(primary: Option<&Path>, fallback: &Path) -> Option<LogSink> {
    primary
        .into_iter()
        .chain(std::iter::once(fallback))
        .find_map(|directory| open_log_sink(directory).ok())
}

fn open_log_sink(directory: &Path) -> io::Result<LogSink> {
    // Malformed environment variables must not create files under the checkout.
    if !directory.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "diagnostic directory must be absolute",
        ));
    }
    fs::create_dir_all(directory)?;
    let path = directory.join("startup.log");
    // Probe write permission now, so initialization can select the fallback.
    let _file = OpenOptions::new().create(true).append(true).open(&path)?;
    Ok(LogSink {
        path,
        lock: Mutex::new(()),
    })
}

fn append_bounded(path: &Path, line: &[u8], limit: u64) -> io::Result<()> {
    if fs::metadata(path)
        .map(|metadata| metadata.len().saturating_add(line.len() as u64) > limit)
        .unwrap_or(false)
    {
        let previous = path.with_file_name("startup.previous.log");
        match fs::remove_file(&previous) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        fs::rename(path, previous)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line)?;
    file.flush()
}

fn single_line(input: &str, limit: usize) -> String {
    let mut result = String::new();
    let mut chars = input.chars();
    for character in chars.by_ref().take(limit) {
        match character {
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            '\0' => result.push_str("\\0"),
            character if character.is_control() => {
                result.push_str(&format!("\\u{{{:x}}}", character as u32));
            }
            character => result.push(character),
        }
    }
    if chars.next().is_some() {
        result.push_str("... [truncado]");
    }
    result
}

fn show_error_once(message: &str) {
    if ERROR_SHOWN
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let destination = log_path()
        .map(|path| format!("Diagnostico salvo em:\n{}", path.display()))
        .unwrap_or_else(|| "Nao foi possivel criar o arquivo de diagnostico.".into());
    let text = format!(
        "O Agente Pedro encontrou um erro.\n\n{}\n\n{destination}\n\nEnvie esse arquivo para analisar a falha.",
        single_line(message, MAX_MESSAGE_CHARS),
    );
    native_error_dialog(&text);
}

#[cfg(windows)]
fn native_error_dialog(text: &str) {
    use windows::{
        core::PCWSTR,
        Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
    };

    let text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let title: Vec<u16> = "Agente Pedro — erro de inicializacao"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // Both UTF-16 buffers remain alive until the synchronous dialog returns.
    unsafe {
        let _ = MessageBoxW(
            None,
            PCWSTR(text.as_ptr()),
            PCWSTR(title.as_ptr()),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
fn native_error_dialog(text: &str) {
    eprintln!("{text}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicU64, Arc};

    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "pedro-diagnostics-test-{}-{nonce}-{}",
                std::process::id(),
                NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).expect("create isolated test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writes_one_line_per_event_and_keeps_existing_entries() {
        let directory = TestDirectory::new();
        let sink = open_log_sink(&directory.0).unwrap();
        sink.append("setup\nwindow", "erro\r\nlinha\tcom\0controle\\")
            .unwrap();
        sink.append("ready", "inicializacao concluida").unwrap();
        let content = fs::read_to_string(&sink.path).unwrap();
        assert_eq!(content.lines().count(), 2);
        assert!(content.contains("[setup\\nwindow] erro\\r\\nlinha\\tcom\\0controle\\\\"));
        assert!(content.contains("[ready] inicializacao concluida"));
        assert!(!content.contains('\0'));
    }

    #[test]
    fn falls_back_when_primary_directory_cannot_be_created() {
        let directory = TestDirectory::new();
        let blocker = directory.0.join("profile-is-a-file");
        fs::write(&blocker, b"block directory creation").unwrap();
        let primary = blocker.join("logs");
        let fallback = directory.0.join("fallback");
        let sink = choose_log_sink(Some(&primary), &fallback).unwrap();
        assert_eq!(sink.path, fallback.join("startup.log"));
        sink.append("fallback", "continua sem interromper o app")
            .unwrap();
        assert!(fs::read_to_string(sink.path)
            .unwrap()
            .contains("[fallback]"));
    }

    #[test]
    fn rejects_relative_paths_and_tolerates_both_candidates_failing() {
        let directory = TestDirectory::new();
        let blocker = directory.0.join("blocked");
        fs::write(&blocker, b"not a directory").unwrap();
        assert!(open_log_sink(Path::new("relative-diagnostics")).is_err());
        assert!(choose_log_sink(Some(&blocker), &blocker).is_none());
    }

    #[test]
    fn rotates_before_crossing_limit_and_replaces_only_previous_log() {
        let directory = TestDirectory::new();
        let path = directory.0.join("startup.log");
        let previous = directory.0.join("startup.previous.log");
        fs::write(&previous, b"older").unwrap();
        append_bounded(&path, b"first\n", 12).unwrap();
        append_bounded(&path, b"second\n", 12).unwrap();
        assert_eq!(fs::read(&previous).unwrap(), b"first\n");
        assert_eq!(fs::read(&path).unwrap(), b"second\n");
        append_bounded(&path, b"third\n", 12).unwrap();
        assert_eq!(fs::read(&previous).unwrap(), b"second\n");
        assert_eq!(fs::read(&path).unwrap(), b"third\n");
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 2);
    }

    #[test]
    fn caps_multibyte_messages_without_invalid_utf8_or_extra_lines() {
        assert_eq!(single_line("á界🙂", 2), "á界... [truncado]");
        assert_eq!(single_line("á界", 2), "á界");
        assert_eq!(single_line("\u{001b}\n", 2), "\\u{1b}\\n");
        let directory = TestDirectory::new();
        let sink = open_log_sink(&directory.0).unwrap();
        sink.append("test", &"🙂\n".repeat(MAX_MESSAGE_CHARS))
            .unwrap();
        let content = fs::read_to_string(sink.path).unwrap();
        assert_eq!(content.lines().count(), 1);
        assert!(content.ends_with("... [truncado]\n"));
        assert!(content.len() < MAX_LOG_BYTES as usize);
    }

    #[test]
    fn serializes_concurrent_writers_without_interleaving_records() {
        let directory = TestDirectory::new();
        let sink = Arc::new(open_log_sink(&directory.0).unwrap());
        let threads: Vec<_> = (0..8)
            .map(|thread| {
                let sink = Arc::clone(&sink);
                std::thread::spawn(move || {
                    for event in 0..20 {
                        sink.append("concurrent", &format!("thread={thread} event={event}"))
                            .unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let content = fs::read_to_string(&sink.path).unwrap();
        assert_eq!(content.lines().count(), 160);
        for thread in 0..8 {
            for event in 0..20 {
                assert_eq!(
                    content
                        .lines()
                        .filter(|line| line.ends_with(&format!("thread={thread} event={event}")))
                        .count(),
                    1,
                );
            }
        }
    }
}
