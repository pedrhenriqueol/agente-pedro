//! One Windows media worker serves every Pedro window. Browser players expose
//! metadata and transport controls through GSMTC; no service token is required.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

#[cfg(any(windows, test))]
#[path = "media_metadata.rs"]
mod metadata;
#[cfg(any(windows, test))]
#[path = "media_policy.rs"]
mod policy;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    pub id: String,
    pub source_app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork: Option<String>,
    pub playback_status: String,
    pub can_play: bool,
    pub can_pause: bool,
    pub can_go_next: bool,
    pub can_go_previous: bool,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    pub revision: u64,
    pub sequence: u64,
    pub supported: bool,
    pub session: Option<MediaSession>,
    pub session_updating: bool,
    /// System master volume for the default multimedia output, in 0..=100.
    pub volume: Option<f64>,
    pub muted: Option<bool>,
    pub error: Option<String>,
}

impl Default for MediaSnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            sequence: 0,
            supported: cfg!(windows),
            session: None,
            session_updating: false,
            volume: None,
            muted: None,
            error: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MediaAction {
    Play,
    Pause,
    Next,
    Previous,
    Volume,
}

#[derive(Clone)]
pub struct MediaState {
    snapshot: Arc<Mutex<MediaSnapshot>>,
    #[cfg(windows)]
    sender: Arc<Mutex<Option<std::sync::mpsc::SyncSender<platform::Request>>>>,
}

impl Default for MediaState {
    fn default() -> Self {
        Self {
            snapshot: Arc::new(Mutex::new(MediaSnapshot {
                // A newly mounted WebView may read before RequestAsync finishes.
                session_updating: cfg!(windows),
                ..MediaSnapshot::default()
            })),
            #[cfg(windows)]
            sender: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub fn media_snapshot(state: State<'_, MediaState>) -> MediaSnapshot {
    state
        .snapshot
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn validate_control(
    action: MediaAction,
    value: Option<f64>,
    session_id: Option<&str>,
) -> Result<(), String> {
    if action == MediaAction::Volume {
        match value {
            Some(value) if value.is_finite() && (0.0..=100.0).contains(&value) => Ok(()),
            _ => Err("O volume deve estar entre 0 e 100.".into()),
        }
    } else if session_id.is_some_and(|id| !id.is_empty()) {
        Ok(())
    } else {
        Err("A sessão de música não está disponível. Aguarde a atualização.".into())
    }
}

#[tauri::command]
pub async fn media_control(
    state: State<'_, MediaState>,
    action: MediaAction,
    value: Option<f64>,
    session_id: Option<String>,
) -> Result<MediaSnapshot, String> {
    validate_control(action, value, session_id.as_deref())?;
    #[cfg(windows)]
    {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};
        let sender = state
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or("A integração de música está iniciando. Tente novamente em instantes.")?;
        let (reply, receiver) = mpsc::channel();
        sender
            .try_send(platform::Request {
                action,
                value,
                session_id,
                expires_at: Instant::now() + Duration::from_secs(6),
                reply,
            })
            .map_err(|error| {
                match error {
                    mpsc::TrySendError::Full(_) => {
                        "Há muitos comandos pendentes. Aguarde um instante."
                    }
                    mpsc::TrySendError::Disconnected(_) => "O serviço de música foi interrompido.",
                }
                .to_string()
            })?;
        // Waiting for native work never blocks the Tauri UI or async executor.
        tauri::async_runtime::spawn_blocking(move || {
            // Queue deadline (6s) + transport (2s) + metadata/artwork (6s).
            receiver
                .recv_timeout(Duration::from_secs(16))
                .map_err(|_| "O Windows demorou para responder ao comando de música.".to_string())?
        })
        .await
        .map_err(|_| "O comando de música foi interrompido.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err("A integração automática de música está disponível no Windows 10 e 11.".into())
    }
}

pub fn start(app: &AppHandle) {
    #[cfg(windows)]
    platform::start(app);
    #[cfg(not(windows))]
    let _ = app;
}

// Kept outside the platform module so validation can run on any host.
#[cfg(any(windows, test))]
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

#[cfg(any(windows, test))]
fn timeline_seconds(
    start: i64,
    end: i64,
    position: i64,
    last_updated: i64,
    now: i64,
    playing: bool,
    playback_rate: f64,
) -> (Option<f64>, Option<f64>) {
    if end <= start {
        return (None, None);
    }
    let duration = end.saturating_sub(start) as f64 / 10_000_000.0;
    let mut position = position.saturating_sub(start) as f64 / 10_000_000.0;
    // Microsoft defines Position as current at LastUpdatedTime, not at read time.
    // Ignore absent/future timestamps and malformed playback rates.
    if playing && last_updated > 0 && now >= last_updated {
        let rate = if playback_rate.is_finite() && playback_rate > 0.0 {
            playback_rate
        } else {
            1.0
        };
        position += now.saturating_sub(last_updated) as f64 / 10_000_000.0 * rate;
    }
    (Some(position.clamp(0.0, duration)), Some(duration))
}

#[cfg(windows)]
mod platform {
    use super::metadata::{MetadataCoordinator, MetadataFailure, MetadataPoll, MetadataProvider};
    use super::policy::{
        candidate_rank, select_candidate, CandidateRead, PlaybackKind, ReadBudget, SelectionTracker,
    };
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use tauri::{Emitter, Manager};
    use windows::core::{IUnknown, Interface};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        MediaPropertiesChangedEventArgs,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
    use windows_future::IAsyncOperation;

    const MAX_ARTWORK_BYTES: u64 = 2 * 1024 * 1024;
    const POLL_INTERVAL: Duration = Duration::from_millis(900);
    const NATIVE_TIMEOUT: Duration = Duration::from_secs(2);

    // Polling on the dedicated MTA thread gives every WinRT operation a deadline;
    // calling .get() directly would allow a broken provider to stall forever.
    macro_rules! bounded_until {
        ($operation:expr, $deadline:expr) => {{
            (|| -> windows::core::Result<_> {
                let deadline = $deadline;
                if Instant::now() >= deadline {
                    return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                        0x800705B4u32 as i32,
                    )));
                }
                let operation = $operation?;
                while operation.Status()?.0 == 0 {
                    if Instant::now() >= deadline {
                        let _ = operation.Cancel();
                        return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                            0x800705B4u32 as i32,
                        )));
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                operation.GetResults()
            })()
        }};
    }

    macro_rules! bounded {
        ($operation:expr) => {
            bounded_until!($operation, Instant::now() + NATIVE_TIMEOUT)
        };
    }

    pub(super) struct Request {
        pub action: MediaAction,
        pub value: Option<f64>,
        pub session_id: Option<String>,
        pub expires_at: Instant,
        pub reply: Sender<Result<MediaSnapshot, String>>,
    }

    struct Apartment;
    impl Apartment {
        fn initialize() -> windows::core::Result<Self> {
            // This thread is new, so it cannot inherit an incompatible STA.
            unsafe {
                RoInitialize(RO_INIT_MULTITHREADED)?;
            }
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }

    pub(super) fn start(app: &AppHandle) {
        let state = app.state::<MediaState>().inner().clone();
        let (sender, receiver) = mpsc::sync_channel(8);
        let mut sender_slot = state.sender.lock().unwrap_or_else(|e| e.into_inner());
        if sender_slot.is_some() {
            return;
        }
        *sender_slot = Some(sender);
        drop(sender_slot);
        let app = app.clone();
        let worker_state = state.clone();
        let worker_app = app.clone();
        if let Err(error) = thread::Builder::new()
            .name("pedro-media".into())
            .spawn(move || run(worker_app, worker_state, receiver))
        {
            *state.sender.lock().unwrap_or_else(|e| e.into_inner()) = None;
            publish(
                &app,
                &state,
                MediaSnapshot {
                    error: Some(format!(
                        "Não foi possível iniciar a integração de música: {error}"
                    )),
                    ..MediaSnapshot::default()
                },
            );
        }
    }

    #[derive(Default)]
    struct ArtworkCache {
        key: String,
        artwork: Option<String>,
        read_at: Option<Instant>,
    }

    impl ArtworkCache {
        fn read(
            &mut self,
            key: String,
            properties: &Properties,
            deadline: Instant,
        ) -> Option<String> {
            let retry_after = if self.artwork.is_some() {
                Duration::from_secs(30)
            } else {
                Duration::from_secs(5)
            };
            let fresh = self.key == key
                && self
                    .read_at
                    .is_some_and(|time| time.elapsed() < retry_after);
            if !fresh {
                if self.key != key {
                    self.artwork = None;
                    self.read_at = None;
                }
                self.key = key;
                // Invalid/missing artwork must not prevent transport controls.
                if Instant::now() < deadline {
                    if let Ok(artwork) = read_artwork(properties, deadline) {
                        self.artwork = artwork;
                    }
                    // A refresh timeout keeps a known image for this exact
                    // track, and is retried later without flashing the cover.
                    self.read_at = Some(Instant::now());
                }
            }
            self.artwork.clone()
        }
    }

    fn read_artwork(
        properties: &Properties,
        deadline: Instant,
    ) -> windows::core::Result<Option<String>> {
        let Ok(reference) = properties.Thumbnail() else {
            return Ok(None);
        };
        let stream = bounded_until!(reference.OpenReadAsync(), deadline)?;
        let size = stream.Size()?;
        if size == 0 || size > MAX_ARTWORK_BYTES {
            return Ok(None);
        }
        let declared_mime = stream.ContentType()?.to_string().to_ascii_lowercase();
        let input = stream.GetInputStreamAt(0)?;
        let reader = DataReader::CreateDataReader(&input)?;
        let loaded = bounded_until!(reader.LoadAsync(size as u32), deadline)?;
        if u64::from(loaded) != size {
            return Ok(None);
        }
        let mut bytes = vec![0; loaded as usize];
        reader.ReadBytes(&mut bytes)?;
        let Some(mime) = image_mime(&bytes) else {
            return Ok(None);
        };
        // Only inert raster formats are embedded. No SVG, HTML, or remote URL.
        if !declared_mime.is_empty()
            && declared_mime != "application/octet-stream"
            && declared_mime != mime
        {
            return Ok(None);
        }
        Ok(Some(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(bytes)
        )))
    }

    type SelectedSession = SelectionTracker<IUnknown, Session>;

    #[derive(Clone)]
    struct NativeMetadata {
        title: String,
        artist: String,
        album: String,
        properties: Properties,
    }

    struct MetadataWatch {
        session: Session,
        token: Option<i64>,
        generation: Arc<AtomicU64>,
    }

    impl Drop for MetadataWatch {
        fn drop(&mut self) {
            if let Some(token) = self.token {
                let _ = self.session.RemoveMediaPropertiesChanged(token);
            }
        }
    }

    #[derive(Default)]
    struct MediaDiagnostics {
        last: Vec<(&'static str, Instant)>,
    }

    impl MediaDiagnostics {
        fn record(&mut self, stage: &'static str, code: Option<i32>, count: usize) {
            if let Some((_, previous)) = self.last.iter_mut().find(|(key, _)| *key == stage) {
                if previous.elapsed() < Duration::from_secs(10) {
                    return;
                }
                *previous = Instant::now();
            } else {
                self.last.push((stage, Instant::now()));
            }
            let code = code
                .map(|code| format!("0x{:08X}", code as u32))
                .unwrap_or_else(|| "none".into());
            crate::diagnostics::write(
                "media",
                format!("stage={stage} hresult={code} candidates={count}"),
            );
        }
    }

    #[derive(Default)]
    struct WindowsMetadataProvider {
        diagnostics: MediaDiagnostics,
    }

    impl MetadataProvider for WindowsMetadataProvider {
        type Identity = IUnknown;
        type Handle = Session;
        type Watch = MetadataWatch;
        type Operation = IAsyncOperation<Properties>;
        type Metadata = NativeMetadata;

        fn watch(&mut self, session: &Session) -> MetadataWatch {
            let generation = Arc::new(AtomicU64::new(0));
            let signal = Arc::clone(&generation);
            let handler =
                TypedEventHandler::<Session, MediaPropertiesChangedEventArgs>::new(move |_, _| {
                    signal.fetch_add(1, Ordering::Release);
                    Ok(())
                });
            let token = match session.MediaPropertiesChanged(&handler) {
                Ok(token) => Some(token),
                Err(error) => {
                    self.diagnostics
                        .record("metadata-watch", Some(error.code().0), 1);
                    None
                }
            };
            MetadataWatch {
                session: session.clone(),
                token,
                generation,
            }
        }

        fn version(&self, watch: &MetadataWatch) -> u64 {
            watch.generation.load(Ordering::Acquire)
        }

        fn refresh_interval(&self, watch: &MetadataWatch) -> Duration {
            if watch.token.is_some() {
                Duration::from_secs(30)
            } else {
                Duration::from_secs(8)
            }
        }

        fn start(&mut self, session: &Session) -> Result<Self::Operation, i32> {
            session
                .TryGetMediaPropertiesAsync()
                .map_err(|error| error.code().0)
        }

        fn poll(&mut self, operation: &mut Self::Operation) -> MetadataPoll<NativeMetadata> {
            match operation.Status() {
                Ok(status) if status.0 == 0 => MetadataPoll::Pending,
                Ok(status) if status.0 == 1 => match operation.GetResults() {
                    Ok(properties) => MetadataPoll::Ready(NativeMetadata {
                        title: properties
                            .Title()
                            .map(|value| value.to_string())
                            .unwrap_or_default(),
                        artist: properties
                            .Artist()
                            .map(|value| value.to_string())
                            .unwrap_or_default(),
                        album: properties
                            .AlbumTitle()
                            .map(|value| value.to_string())
                            .unwrap_or_default(),
                        properties,
                    }),
                    Err(error) => MetadataPoll::Failed(error.code().0),
                },
                Ok(_) => MetadataPoll::Failed(
                    operation
                        .ErrorCode()
                        .map(|code| code.0)
                        .unwrap_or(0x80004005u32 as i32),
                ),
                Err(error) => MetadataPoll::Failed(error.code().0),
            }
        }

        fn cancel(&mut self, operation: &mut Self::Operation) {
            let _ = operation.Cancel();
        }

        fn has_content(&self, metadata: &NativeMetadata) -> bool {
            !metadata.title.trim().is_empty() || !metadata.artist.trim().is_empty()
        }
    }

    struct SessionReader {
        selected: SelectedSession,
        metadata: MetadataCoordinator<WindowsMetadataProvider>,
        transport_ready: bool,
        artwork: ArtworkCache,
        rotation: usize,
        started: Instant,
        diagnostics: MediaDiagnostics,
        catalog_present: Option<bool>,
    }

    impl Default for SessionReader {
        fn default() -> Self {
            Self {
                selected: SelectedSession::default(),
                metadata: MetadataCoordinator::new(WindowsMetadataProvider::default()),
                transport_ready: false,
                artwork: ArtworkCache::default(),
                rotation: 0,
                started: Instant::now(),
                diagnostics: MediaDiagnostics::default(),
                catalog_present: None,
            }
        }
    }

    impl SessionReader {
        fn invalidate(&mut self) {
            self.selected.clear();
            self.metadata.clear();
            self.transport_ready = false;
        }
    }

    fn playback_kind(status: PlaybackStatus) -> PlaybackKind {
        if status == PlaybackStatus::Playing {
            PlaybackKind::Playing
        } else if status == PlaybackStatus::Paused {
            PlaybackKind::Paused
        } else if status == PlaybackStatus::Stopped {
            PlaybackKind::Stopped
        } else if status == PlaybackStatus::Closed {
            PlaybackKind::Closed
        } else {
            PlaybackKind::Unknown
        }
    }

    struct Candidate {
        session: Session,
        identity: IUnknown,
        rank: u8,
        live: Option<MediaSession>,
    }

    fn candidates(
        manager: &SessionManager,
        selected: &SelectedSession,
        budget: &ReadBudget,
    ) -> windows::core::Result<Vec<Candidate>> {
        // These errors belong to the manager and must trigger recovery. A
        // failed/null current-session hint or an individual dead tab does not.
        let sessions = manager.GetSessions()?;
        let count = sessions.Size()?;
        if count == 0 {
            return Ok(Vec::new());
        }
        let current = manager
            .GetCurrentSession()
            .ok()
            .and_then(|session| session.cast::<IUnknown>().ok());
        let mut result = Vec::new();
        let mut add = |session: Session| {
            let Ok(identity) = session.cast::<IUnknown>() else {
                return;
            };
            if result
                .iter()
                .any(|candidate: &Candidate| candidate.identity == identity)
            {
                return;
            }
            // A transient playback getter failure is not a Closed session.
            let live = read_live(&session).ok();
            let kind = live
                .as_ref()
                .map(|(kind, _)| *kind)
                .unwrap_or(PlaybackKind::Unknown);
            let retained = selected
                .current()
                .is_some_and(|previous| previous.identity == identity);
            if let Some(rank) = candidate_rank(kind, current.as_ref() == Some(&identity), retained)
            {
                result.push(Candidate {
                    session,
                    identity,
                    rank,
                    live: live.map(|(_, session)| session),
                });
            }
        };
        // A provider can disappear while this view is enumerated. Skip that
        // entry, rather than aborting the other browser/player sessions.
        for index in 0..count {
            if !budget.has_time(Instant::now()) {
                break;
            }
            if let Ok(session) = sessions.GetAt(index) {
                add(session);
            }
        }
        Ok(result)
    }

    fn read_live(session: &Session) -> windows::core::Result<(PlaybackKind, MediaSession)> {
        let info = session.GetPlaybackInfo()?;
        let controls = info.Controls().ok();
        let status = info.PlaybackStatus()?;
        let (position_seconds, duration_seconds) = session
            .GetTimelineProperties()
            .ok()
            .and_then(|timeline| {
                let start = timeline.StartTime().ok()?.Duration;
                let end = timeline.EndTime().ok()?.Duration;
                let position = timeline.Position().ok()?.Duration;
                let updated = timeline.LastUpdatedTime().ok()?.UniversalTime;
                let epoch_offset: u128 = 116_444_736_000_000_000;
                let since_unix = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
                let now = i64::try_from(since_unix.as_nanos() / 100 + epoch_offset).ok()?;
                let rate = info
                    .PlaybackRate()
                    .ok()
                    .and_then(|rate| rate.Value().ok())
                    .unwrap_or(1.0);
                Some(timeline_seconds(
                    start,
                    end,
                    position,
                    updated,
                    now,
                    status == PlaybackStatus::Playing,
                    rate,
                ))
            })
            .unwrap_or((None, None));
        Ok((
            playback_kind(status),
            MediaSession {
                // Assigned only after usable metadata chooses the retained object.
                id: String::new(),
                source_app: session
                    .SourceAppUserModelId()
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                title: String::new(),
                artist: String::new(),
                album: String::new(),
                artwork: None,
                playback_status: if status == PlaybackStatus::Playing {
                    "playing"
                } else if status == PlaybackStatus::Paused {
                    "paused"
                } else if status == PlaybackStatus::Stopped || status == PlaybackStatus::Closed {
                    "stopped"
                } else {
                    "unknown"
                }
                .into(),
                can_play: controls
                    .as_ref()
                    .and_then(|controls| controls.IsPlayEnabled().ok())
                    .unwrap_or(false),
                can_pause: controls
                    .as_ref()
                    .and_then(|controls| controls.IsPauseEnabled().ok())
                    .unwrap_or(false),
                can_go_next: controls
                    .as_ref()
                    .and_then(|controls| controls.IsNextEnabled().ok())
                    .unwrap_or(false),
                can_go_previous: controls
                    .as_ref()
                    .and_then(|controls| controls.IsPreviousEnabled().ok())
                    .unwrap_or(false),
                position_seconds,
                duration_seconds,
            },
        ))
    }

    fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
        // The default can change when headphones connect; resolve it each time.
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)?
                .Activate(CLSCTX_ALL, None)
        }
    }

    struct SnapshotRead {
        snapshot: MediaSnapshot,
        manager_failed: bool,
    }

    fn read_snapshot(
        manager: Option<&SessionManager>,
        manager_error: Option<&str>,
        reader: &mut SessionReader,
    ) -> SnapshotRead {
        let (volume, muted) = match endpoint() {
            Ok(endpoint) => unsafe {
                (
                    endpoint
                        .GetMasterVolumeLevelScalar()
                        .ok()
                        .map(|value| (f64::from(value) * 1000.0).round() / 10.0),
                    endpoint.GetMute().ok().map(|value| value.as_bool()),
                )
            },
            Err(_) => (None, None),
        };
        let mut snapshot = MediaSnapshot {
            volume,
            muted,
            ..MediaSnapshot::default()
        };
        let Some(manager) = manager else {
            reader.invalidate();
            snapshot.error = Some(
                manager_error
                    .unwrap_or("A integração de mídia do Windows está iniciando.")
                    .into(),
            );
            return SnapshotRead {
                snapshot,
                manager_failed: false,
            };
        };
        let budget = ReadBudget::new(Instant::now());
        let candidates = match candidates(manager, &reader.selected, &budget) {
            Ok(candidates) => candidates,
            Err(error) => {
                reader.invalidate();
                reader
                    .diagnostics
                    .record("session-enumeration", Some(error.code().0), 0);
                snapshot.error = Some(format!(
                    "Não foi possível consultar a mídia do Windows: {error}"
                ));
                return SnapshotRead {
                    snapshot,
                    manager_failed: true,
                };
            }
        };
        let identities: Vec<_> = candidates
            .iter()
            .map(|candidate| candidate.identity.clone())
            .collect();
        let present = !candidates.is_empty();
        if reader.catalog_present != Some(present) {
            reader.catalog_present = Some(present);
            reader.diagnostics.record(
                if present {
                    "live-candidates-found"
                } else {
                    "no-live-candidates"
                },
                None,
                candidates.len(),
            );
        }
        reader.metadata.reconcile(&identities);
        let now = reader.started.elapsed();
        reader.metadata.tick(now);
        let ranks: Vec<_> = candidates.iter().map(|candidate| candidate.rank).collect();
        let mut recovering = false;
        let mut pending = false;
        let mut viable_pending = false;
        let mut failure: Option<MetadataFailure> = None;
        let chosen = select_candidate(&ranks, reader.rotation, |index| {
            if !budget.has_time(Instant::now()) {
                return CandidateRead::Exhausted;
            }
            let candidate = &candidates[index];
            let state = reader.metadata.read(
                candidate.identity.clone(),
                candidate.session.clone(),
                candidate.live.is_some(),
                reader.started.elapsed(),
            );
            pending |= state.updating;
            recovering |= state.recover_manager;
            viable_pending |= state.updating && !state.recover_manager;
            if failure.is_none() {
                failure = state.error;
            }
            if state.recover_manager {
                return CandidateRead::Skip;
            }
            match state.metadata {
                Some(metadata) => CandidateRead::Ready((metadata, state.updating)),
                None => CandidateRead::Skip,
            }
        });
        reader.rotation = reader.rotation.wrapping_add(1);
        if recovering && chosen.is_none() && !viable_pending {
            reader.diagnostics.record(
                "metadata-manager-recovery",
                failure.as_ref().and_then(|failure| failure.code),
                candidates.len(),
            );
            reader.invalidate();
            snapshot.error =
                Some("A integração de música está se recuperando. Aguarde um instante.".into());
            snapshot.session_updating = true;
            return SnapshotRead {
                snapshot,
                manager_failed: true,
            };
        }
        if let Some(failure) = failure.as_ref() {
            reader
                .diagnostics
                .record(failure.stage, failure.code, candidates.len());
        }
        if let Some((index, (metadata, updating))) = chosen {
            let candidate = &candidates[index];
            let mut session = candidate.live.clone().unwrap_or_else(|| MediaSession {
                source_app: candidate
                    .session
                    .SourceAppUserModelId()
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                playback_status: "unknown".into(),
                ..MediaSession::default()
            });
            session.id = reader
                .selected
                .select(candidate.identity.clone(), candidate.session.clone())
                .token
                .clone();
            session.title = metadata.title;
            session.artist = metadata.artist;
            session.album = metadata.album;
            let now = Instant::now();
            let deadline = budget.artwork_deadline(now).unwrap_or(now);
            let key = format!(
                "{}\0{}\0{}\0{}",
                session.id, session.title, session.artist, session.album
            );
            session.artwork = reader.artwork.read(key, &metadata.properties, deadline);
            snapshot.session_updating = updating || candidate.live.is_none();
            reader.transport_ready = !snapshot.session_updating;
            if snapshot.session_updating {
                session.can_play = false;
                session.can_pause = false;
                session.can_go_next = false;
                session.can_go_previous = false;
            }
            snapshot.session = Some(session);
        } else {
            reader.selected.clear();
            reader.transport_ready = false;
            snapshot.session_updating = pending;
            if failure.is_some() && !viable_pending {
                snapshot.error = Some(
                    "Não foi possível atualizar a música. A integração tentará novamente.".into(),
                );
            }
        }
        SnapshotRead {
            snapshot,
            manager_failed: false,
        }
    }

    fn same_semantics(previous: &MediaSnapshot, next: &MediaSnapshot) -> bool {
        if previous.supported != next.supported
            || previous.session_updating != next.session_updating
            || previous.volume != next.volume
            || previous.muted != next.muted
            || previous.error != next.error
        {
            return false;
        }
        match (&previous.session, &next.session) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                a.id == b.id
                    && a.source_app == b.source_app
                    && a.title == b.title
                    && a.artist == b.artist
                    && a.album == b.album
                    && a.artwork == b.artwork
                    && a.playback_status == b.playback_status
                    && a.can_play == b.can_play
                    && a.can_pause == b.can_pause
                    && a.can_go_next == b.can_go_next
                    && a.can_go_previous == b.can_go_previous
                    && a.duration_seconds == b.duration_seconds
            }
            _ => false,
        }
    }

    fn publish(app: &AppHandle, state: &MediaState, mut snapshot: MediaSnapshot) -> MediaSnapshot {
        let mut cached = state.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        let changed = !same_semantics(&cached, &snapshot);
        let position_changed = match (&cached.session, &snapshot.session) {
            (Some(a), Some(b)) => {
                a.position_seconds != b.position_seconds || a.duration_seconds != b.duration_seconds
            }
            _ => false,
        };
        snapshot.revision = cached.revision + u64::from(changed);
        snapshot.sequence = cached.sequence + 1;
        *cached = snapshot.clone();
        drop(cached);
        if changed {
            let _ = app.emit("pedro:media", &snapshot);
        } else if position_changed {
            if let Some(session) = &snapshot.session {
                #[derive(Clone, Serialize)]
                #[serde(rename_all = "camelCase")]
                struct PositionUpdate<'a> {
                    revision: u64,
                    sequence: u64,
                    session_id: &'a str,
                    position_seconds: Option<f64>,
                    duration_seconds: Option<f64>,
                }
                let _ = app.emit(
                    "pedro:media-position",
                    PositionUpdate {
                        revision: snapshot.revision,
                        sequence: snapshot.sequence,
                        session_id: &session.id,
                        position_seconds: session.position_seconds,
                        duration_seconds: session.duration_seconds,
                    },
                );
            }
        }
        snapshot
    }

    fn apply(reader: &mut SessionReader, request: &Request) -> Result<(), String> {
        if Instant::now() >= request.expires_at {
            return Err("O comando expirou. Tente novamente.".into());
        }
        if request.action == MediaAction::Volume {
            let value = request.value.ok_or("Volume ausente.")?;
            let endpoint = endpoint().map_err(|error| {
                format!("Não foi possível controlar o volume do sistema: {error}")
            })?;
            unsafe {
                endpoint.SetMasterVolumeLevelScalar((value / 100.0) as f32, std::ptr::null())
            }
            .map_err(|error| format!("Não foi possível ajustar o volume do sistema: {error}"))?;
            if value > 0.0 {
                unsafe { endpoint.SetMute(false, std::ptr::null()) }
                    .map_err(|error| format!("O volume foi ajustado, mas não foi possível reativar a saída de áudio: {error}"))?;
            }
            return Ok(());
        }

        // Execute on the exact object that supplied the displayed token. App IDs
        // are shared by tabs, and re-electing a session can skip the wrong tab.
        // A fresh COM enumeration is not a prerequisite for controlling this
        // retained handle; recreated proxies cannot redirect or reject it.
        let session = reader
            .selected
            .handle_for(request.session_id.as_deref())
            .cloned()
            .ok_or("A sessão de música mudou. Aguarde a atualização e tente novamente.")?;
        let identity = reader
            .selected
            .current()
            .ok_or("A reprodução está sendo atualizada.")?
            .identity
            .clone();
        if !reader.transport_ready
            || !reader
                .metadata
                .is_ready(&identity, reader.started.elapsed())
        {
            return Err("A reprodução está sendo atualizada. Aguarde um instante.".into());
        }
        let info = session
            .GetPlaybackInfo()
            .map_err(|error| error.to_string())?;
        if info.PlaybackStatus().map_err(|error| error.to_string())? == PlaybackStatus::Closed {
            return Err("A sessão de música foi fechada. Aguarde a próxima reprodução.".into());
        }
        let controls = info.Controls().map_err(|error| error.to_string())?;
        let allowed = match request.action {
            MediaAction::Play => controls.IsPlayEnabled(),
            MediaAction::Pause => controls.IsPauseEnabled(),
            MediaAction::Next => controls.IsNextEnabled(),
            MediaAction::Previous => controls.IsPreviousEnabled(),
            MediaAction::Volume => unreachable!(),
        }
        .map_err(|error| error.to_string())?;
        if !allowed {
            return Err("O player atual não oferece esse comando.".into());
        }
        if Instant::now() >= request.expires_at {
            return Err("O comando expirou. Tente novamente.".into());
        }
        if !reader
            .metadata
            .is_ready(&identity, reader.started.elapsed())
        {
            return Err("A reprodução está sendo atualizada. Aguarde um instante.".into());
        }
        let result = match request.action {
            MediaAction::Play => bounded!(session.TryPlayAsync()),
            MediaAction::Pause => bounded!(session.TryPauseAsync()),
            MediaAction::Next => bounded!(session.TrySkipNextAsync()),
            MediaAction::Previous => bounded!(session.TrySkipPreviousAsync()),
            MediaAction::Volume => unreachable!(),
        };
        // Invalidate after exactly one transport attempt, including an ambiguous
        // timeout. Some browsers do not emit MediaPropertiesChanged for skip.
        if matches!(request.action, MediaAction::Next | MediaAction::Previous) {
            reader
                .metadata
                .invalidate(&identity, reader.started.elapsed());
            reader.transport_ready = false;
        }
        let result =
            result.map_err(|error| format!("O player não respondeu ao comando: {error}"))?;
        if result {
            Ok(())
        } else {
            Err("O player recusou o comando de música.".into())
        }
    }

    fn run(app: AppHandle, state: MediaState, receiver: Receiver<Request>) {
        let _apartment = match Apartment::initialize() {
            Ok(apartment) => apartment,
            Err(error) => {
                publish(
                    &app,
                    &state,
                    MediaSnapshot {
                        error: Some(format!(
                            "Não foi possível inicializar a mídia do Windows: {error}"
                        )),
                        ..MediaSnapshot::default()
                    },
                );
                return;
            }
        };
        let mut manager: Option<SessionManager> = None;
        let mut last_manager_attempt: Option<Instant> = None;
        let mut manager_error: Option<String> = None;
        let mut reader = SessionReader::default();
        let mut poll_due = true;
        loop {
            // Failed startup remains observable and is retried, never reported as
            // an ordinary empty player or hidden behind a fake supported=false.
            if manager.is_none()
                && last_manager_attempt.is_none_or(|time| time.elapsed() >= Duration::from_secs(5))
            {
                last_manager_attempt = Some(Instant::now());
                match bounded!(SessionManager::RequestAsync()) {
                    Ok(ready) => {
                        manager = Some(ready);
                        manager_error = None;
                        reader.diagnostics.record("manager-ready", None, 0);
                    }
                    Err(error) => {
                        reader
                            .diagnostics
                            .record("manager-request", Some(error.code().0), 0);
                        manager_error = Some(format!(
                            "A integração de mídia do Windows está indisponível: {error}"
                        ));
                    }
                }
                poll_due = true;
            }
            if poll_due {
                let read = read_snapshot(manager.as_ref(), manager_error.as_deref(), &mut reader);
                if read.manager_failed {
                    manager = None;
                    manager_error = read.snapshot.error.clone();
                    last_manager_attempt = Some(Instant::now());
                }
                publish(&app, &state, read.snapshot);
            }
            match receiver.recv_timeout(POLL_INTERVAL) {
                Ok(request) => {
                    // Volume is independent of GSMTC availability. Transport is
                    // attempted once, then both success and failure rescan state;
                    // a timed-out skip must never be resent automatically.
                    let result = apply(&mut reader, &request);
                    let read =
                        read_snapshot(manager.as_ref(), manager_error.as_deref(), &mut reader);
                    if read.manager_failed {
                        manager = None;
                        manager_error = read.snapshot.error.clone();
                        last_manager_attempt = Some(Instant::now());
                    }
                    let snapshot = publish(&app, &state, read.snapshot);
                    let _ = request.reply.send(result.map(|()| snapshot));
                    // The command already sampled the latest state. Avoid a
                    // second metadata/artwork pass before the next queued input.
                    poll_due = false;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => poll_due = true,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_rejects_missing_non_finite_and_out_of_range_values() {
        for value in [
            None,
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(-1.0),
            Some(100.1),
        ] {
            assert!(validate_control(MediaAction::Volume, value, None).is_err());
        }
        for value in [0.0, 25.5, 100.0] {
            assert!(validate_control(MediaAction::Volume, Some(value), None).is_ok());
        }
    }

    #[test]
    fn transport_commands_require_an_explicit_session() {
        for action in [
            MediaAction::Play,
            MediaAction::Pause,
            MediaAction::Next,
            MediaAction::Previous,
        ] {
            assert!(validate_control(action, None, None).is_err());
            assert!(validate_control(action, None, Some("")).is_err());
            assert!(validate_control(action, None, Some("current-session")).is_ok());
        }
    }

    #[test]
    fn artwork_accepts_only_known_raster_signatures() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(image_mime(b"\xff\xd8\xff"), Some("image/jpeg"));
        assert_eq!(image_mime(b"GIF89a"), Some("image/gif"));
        assert_eq!(image_mime(b"RIFF1234WEBP"), Some("image/webp"));
        for bytes in [b"<svg><script>".as_slice(), b"<html>", b"RIFF", b"", b"ID3"] {
            assert_eq!(image_mime(bytes), None);
        }
    }

    #[test]
    fn timeline_advances_from_provider_timestamp_and_preserves_pause_or_seek() {
        let second = 10_000_000;
        assert_eq!(
            timeline_seconds(
                0,
                100 * second,
                10 * second,
                1000 * second,
                1005 * second,
                true,
                1.0
            ),
            (Some(15.0), Some(100.0))
        );
        assert_eq!(
            timeline_seconds(
                0,
                100 * second,
                10 * second,
                1000 * second,
                1005 * second,
                true,
                2.0
            ),
            (Some(20.0), Some(100.0))
        );
        assert_eq!(
            timeline_seconds(
                0,
                100 * second,
                10 * second,
                1000 * second,
                1005 * second,
                false,
                1.0
            ),
            (Some(10.0), Some(100.0))
        );
        assert_eq!(
            timeline_seconds(
                0,
                100 * second,
                60 * second,
                1005 * second,
                1005 * second,
                true,
                1.0
            ),
            (Some(60.0), Some(100.0))
        );
    }

    #[test]
    fn timeline_bounds_bad_provider_data_without_overflow() {
        let second = 10_000_000;
        assert_eq!(
            timeline_seconds(0, 100 * second, 99 * second, second, 5 * second, true, 1.0),
            (Some(100.0), Some(100.0))
        );
        assert_eq!(
            timeline_seconds(0, 100 * second, -second, 0, second, true, 1.0),
            (Some(0.0), Some(100.0))
        );
        assert_eq!(
            timeline_seconds(0, 100 * second, second, second * 5, second, true, 1.0),
            (Some(1.0), Some(100.0))
        );
        assert_eq!(timeline_seconds(0, 0, 0, 0, 0, true, 1.0), (None, None));
        assert_eq!(
            timeline_seconds(0, 100 * second, second, second, 2 * second, true, f64::NAN),
            (Some(2.0), Some(100.0))
        );
        let (position, duration) = timeline_seconds(
            i64::MIN,
            i64::MAX,
            i64::MAX,
            i64::MIN,
            i64::MAX,
            true,
            f64::INFINITY,
        );
        assert!(position.unwrap().is_finite());
        assert!(duration.unwrap().is_finite());
        assert!(position <= duration);
    }
}
