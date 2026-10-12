//! One Windows media worker serves every Pedro window. Browser players expose
//! metadata and transport controls through GSMTC; no service token is required.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

#[derive(Clone, Debug, PartialEq, Serialize)]
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

#[derive(Clone, Default)]
pub struct MediaState {
    snapshot: Arc<Mutex<MediaSnapshot>>,
    #[cfg(windows)]
    sender: Arc<Mutex<Option<std::sync::mpsc::SyncSender<platform::Request>>>>,
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
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use tauri::{Emitter, Manager};
    use windows::core::{IUnknown, Interface};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

    const MAX_ARTWORK_BYTES: u64 = 2 * 1024 * 1024;
    const POLL_INTERVAL: Duration = Duration::from_millis(900);
    const NATIVE_TIMEOUT: Duration = Duration::from_secs(2);

    // Polling on the dedicated MTA thread gives every WinRT operation a deadline;
    // calling .get() directly would allow a broken provider to stall forever.
    macro_rules! bounded {
        ($operation:expr) => {{
            (|| -> windows::core::Result<_> {
                let operation = $operation?;
                let deadline = Instant::now() + NATIVE_TIMEOUT;
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
        fn read(&mut self, key: String, properties: &Properties) -> Option<String> {
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
                self.key = key;
                // Invalid/missing artwork must not prevent transport controls.
                self.artwork = read_artwork(properties).ok().flatten();
                self.read_at = Some(Instant::now());
            }
            self.artwork.clone()
        }
    }

    fn read_artwork(properties: &Properties) -> windows::core::Result<Option<String>> {
        let Ok(reference) = properties.Thumbnail() else {
            return Ok(None);
        };
        let stream = bounded!(reference.OpenReadAsync())?;
        let size = stream.Size()?;
        if size == 0 || size > MAX_ARTWORK_BYTES {
            return Ok(None);
        }
        let declared_mime = stream.ContentType()?.to_string().to_ascii_lowercase();
        let input = stream.GetInputStreamAt(0)?;
        let reader = DataReader::CreateDataReader(&input)?;
        let loaded = bounded!(reader.LoadAsync(size as u32))?;
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

    fn is_playing(session: &Session) -> bool {
        session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
            .is_ok_and(|status| status == PlaybackStatus::Playing)
    }

    fn select_session(manager: &SessionManager) -> windows::core::Result<Option<Session>> {
        let sessions = manager.GetSessions()?;
        let count = sessions.Size()?;
        if count == 0 {
            return Ok(None);
        }
        // GSMTC returns a null object when no current session was designated.
        let current = match manager.GetCurrentSession() {
            Ok(current) => Some(current),
            Err(error) if error.code() == windows::core::HRESULT(0x80004003u32 as i32) => None,
            Err(error) => return Err(error),
        };
        if current.as_ref().is_some_and(is_playing) {
            return Ok(current);
        }
        for index in 0..count {
            let candidate = sessions.GetAt(index)?;
            if is_playing(&candidate) {
                return Ok(Some(candidate));
            }
        }
        match current {
            Some(current) => Ok(Some(current)),
            None => Ok(Some(sessions.GetAt(0)?)),
        }
    }

    fn session_id(session: &Session) -> windows::core::Result<String> {
        // COM IUnknown identity distinguishes two sessions from the same browser.
        // Hashing makes the opaque UI token independent of pointer formatting.
        let identity: IUnknown = session.cast()?;
        let mut hasher = DefaultHasher::new();
        (identity.as_raw() as usize).hash(&mut hasher);
        session
            .SourceAppUserModelId()?
            .to_string()
            .hash(&mut hasher);
        Ok(format!("{:016x}", hasher.finish()))
    }

    fn read_session(
        session: &Session,
        artwork: &mut ArtworkCache,
    ) -> windows::core::Result<MediaSession> {
        let id = session_id(session)?;
        let properties = bounded!(session.TryGetMediaPropertiesAsync())?;
        let info = session.GetPlaybackInfo()?;
        let controls = info.Controls()?;
        let status = info.PlaybackStatus()?;
        let title = properties.Title()?.to_string();
        let artist = properties.Artist()?.to_string();
        let album = properties.AlbumTitle()?.to_string();
        let artwork_key = format!("{id}\0{title}\0{artist}\0{album}");
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
        Ok(MediaSession {
            id,
            source_app: session.SourceAppUserModelId()?.to_string(),
            title,
            artist,
            album,
            artwork: artwork.read(artwork_key, &properties),
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
            can_play: controls.IsPlayEnabled()?,
            can_pause: controls.IsPauseEnabled()?,
            can_go_next: controls.IsNextEnabled()?,
            can_go_previous: controls.IsPreviousEnabled()?,
            position_seconds,
            duration_seconds,
        })
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

    fn read_snapshot(
        manager: &SessionManager,
        artwork: &mut ArtworkCache,
        retained_session: &mut Option<Session>,
    ) -> MediaSnapshot {
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
        match select_session(manager).and_then(|session| {
            // Keep the COM object alive between polls. Canonical IUnknown identity
            // is stable while held, even when GSMTC returns another wrapper.
            *retained_session = session;
            retained_session
                .as_ref()
                .map(|session| read_session(session, artwork))
                .transpose()
        }) {
            Ok(session) => MediaSnapshot {
                session,
                volume,
                muted,
                ..MediaSnapshot::default()
            },
            Err(error) => MediaSnapshot {
                volume,
                muted,
                error: Some(format!(
                    "Não foi possível consultar a mídia do Windows: {error}"
                )),
                ..MediaSnapshot::default()
            },
        }
    }

    fn same_semantics(previous: &MediaSnapshot, next: &MediaSnapshot) -> bool {
        if previous.supported != next.supported
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

    fn apply(manager: &SessionManager, request: &Request) -> Result<(), String> {
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
        let session = select_session(manager)
            .map_err(|error| format!("Não foi possível localizar a sessão: {error}"))?
            .ok_or("Nenhuma música está disponível para controlar.")?;
        let id = session_id(&session).map_err(|error| error.to_string())?;
        if request.session_id.as_deref() != Some(&id) {
            return Err(
                "A sessão de música mudou. Aguarde a atualização e tente novamente.".into(),
            );
        }
        let controls = session
            .GetPlaybackInfo()
            .and_then(|info| info.Controls())
            .map_err(|error| error.to_string())?;
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
        let result = match request.action {
            MediaAction::Play => bounded!(session.TryPlayAsync()),
            MediaAction::Pause => bounded!(session.TryPauseAsync()),
            MediaAction::Next => bounded!(session.TrySkipNextAsync()),
            MediaAction::Previous => bounded!(session.TrySkipPreviousAsync()),
            MediaAction::Volume => unreachable!(),
        }
        .map_err(|error| format!("O player não respondeu ao comando: {error}"))?;
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
        let mut artwork = ArtworkCache::default();
        let mut retained_session = None;
        loop {
            // Failed startup remains observable and is retried, never reported as
            // an ordinary empty player or hidden behind a fake supported=false.
            if manager.is_none()
                && last_manager_attempt.is_none_or(|time| time.elapsed() >= Duration::from_secs(5))
            {
                last_manager_attempt = Some(Instant::now());
                match bounded!(SessionManager::RequestAsync()) {
                    Ok(ready) => manager = Some(ready),
                    Err(error) => {
                        publish(
                            &app,
                            &state,
                            MediaSnapshot {
                                error: Some(format!(
                                    "A integração de mídia do Windows está indisponível: {error}"
                                )),
                                ..MediaSnapshot::default()
                            },
                        );
                    }
                }
            }
            if let Some(manager) = &manager {
                publish(
                    &app,
                    &state,
                    read_snapshot(manager, &mut artwork, &mut retained_session),
                );
            }
            match receiver.recv_timeout(POLL_INTERVAL) {
                Ok(request) => {
                    let result = match &manager {
                        Some(manager) => apply(manager, &request).map(|()| {
                            publish(&app, &state, read_snapshot(manager, &mut artwork, &mut retained_session))
                        }),
                        None => Err("A integração de mídia do Windows está indisponível. Tente novamente em instantes.".into()),
                    };
                    let _ = request.reply.send(result);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => (),
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
