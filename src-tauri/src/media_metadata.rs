//! Per-object metadata lifecycle shared by the WinRT adapter and host tests.
//!
//! Playback/timeline polls do not invalidate metadata. Native change events do,
//! and an in-flight read survives worker ticks until completion or its deadline.
use std::time::Duration;

const SAFETY_REFRESH: Duration = Duration::from_secs(30);
const OPERATION_DEADLINE: Duration = Duration::from_secs(8);
const DIRTY_CONTEXT_LIFETIME: Duration = Duration::from_secs(12);
const UNREADABLE_CONTEXT_LIFETIME: Duration = Duration::from_secs(4);

pub enum MetadataPoll<M> {
    Pending,
    Ready(M),
    Failed(i32),
}

pub trait MetadataProvider {
    type Identity: Clone + PartialEq;
    type Handle: Clone;
    /// Owns the change subscription. Dropping it must unsubscribe the callback.
    type Watch;
    type Operation;
    type Metadata: Clone;

    fn watch(&mut self, handle: &Self::Handle) -> Self::Watch;
    fn version(&self, watch: &Self::Watch) -> u64;
    fn refresh_interval(&self, _watch: &Self::Watch) -> Duration {
        SAFETY_REFRESH
    }
    fn start(&mut self, handle: &Self::Handle) -> Result<Self::Operation, i32>;
    /// Must not wait for completion; the native adapter checks AsyncStatus first.
    fn poll(&mut self, operation: &mut Self::Operation) -> MetadataPoll<Self::Metadata>;
    fn cancel(&mut self, operation: &mut Self::Operation);
    fn has_content(&self, metadata: &Self::Metadata) -> bool;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MetadataFailure {
    pub stage: &'static str,
    pub code: Option<i32>,
}

pub struct MetadataState<M> {
    pub metadata: Option<M>,
    pub updating: bool,
    pub error: Option<MetadataFailure>,
    pub recover_manager: bool,
}

struct Cached<M> {
    value: M,
    version: u64,
    refreshed_at: Duration,
}

struct InFlight<O> {
    operation: O,
    version: u64,
    generation: u64,
    started_at: Duration,
}

struct Entry<P: MetadataProvider> {
    identity: P::Identity,
    watch: P::Watch,
    observed_version: u64,
    generation: u64,
    cache: Option<Cached<P::Metadata>>,
    in_flight: Option<InFlight<P::Operation>>,
    dirty_since: Option<Duration>,
    unreadable_since: Option<Duration>,
    failures: u32,
    retry_at: Duration,
    error: Option<MetadataFailure>,
}

pub struct MetadataCoordinator<P: MetadataProvider> {
    provider: P,
    entries: Vec<Entry<P>>,
}

impl<P: MetadataProvider> MetadataCoordinator<P> {
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            entries: Vec::new(),
        }
    }

    /// A change between publication and a click must not authorize old controls.
    pub fn is_ready(&self, identity: &P::Identity, _now: Duration) -> bool {
        self.entries.iter().any(|entry| {
            &entry.identity == identity
                && entry.dirty_since.is_none()
                && entry.unreadable_since.is_none()
                && entry
                    .cache
                    .as_ref()
                    .is_some_and(|cache| cache.version == self.provider.version(&entry.watch))
        })
    }

    /// Next/previous invalidate once after the transport attempt, including when
    /// a browser fails to emit its change event. This never repeats the command.
    pub fn invalidate(&mut self, identity: &P::Identity, now: Duration) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|entry| &entry.identity == identity)
        {
            mark_dirty(entry, now);
        }
    }

    /// Observe completions and expire pending operations even when another
    /// candidate currently wins. No new requests are started here.
    pub fn tick(&mut self, now: Duration) {
        for entry in &mut self.entries {
            let version = self.provider.version(&entry.watch);
            if version != entry.observed_version {
                entry.observed_version = version;
                mark_dirty(entry, now);
            }
            poll_in_flight(&mut self.provider, entry, now);
        }
    }

    /// The catalog, not cached metadata or app name, decides object lifetime.
    /// Closed objects must be excluded by the adapter before reconciliation.
    pub fn reconcile(&mut self, identities: &[P::Identity]) {
        let provider = &mut self.provider;
        self.entries.retain_mut(|entry| {
            let retain = identities.contains(&entry.identity);
            if !retain {
                cancel(provider, entry);
            }
            retain
        });
    }

    pub fn clear(&mut self) {
        for entry in &mut self.entries {
            cancel(&mut self.provider, entry);
        }
        self.entries.clear();
    }

    pub fn read(
        &mut self,
        identity: P::Identity,
        handle: P::Handle,
        live_readable: bool,
        now: Duration,
    ) -> MetadataState<P::Metadata> {
        self.tick(now);
        let index = match self
            .entries
            .iter()
            .position(|entry| entry.identity == identity)
        {
            Some(index) => index,
            None => {
                let watch = self.provider.watch(&handle);
                let observed_version = self.provider.version(&watch);
                self.entries.push(Entry {
                    identity,
                    watch,
                    observed_version,
                    generation: 0,
                    cache: None,
                    in_flight: None,
                    dirty_since: Some(now),
                    unreadable_since: None,
                    failures: 0,
                    retry_at: now,
                    error: None,
                });
                self.entries.len() - 1
            }
        };
        let entry = &mut self.entries[index];
        let version = self.provider.version(&entry.watch);
        if version != entry.observed_version {
            entry.observed_version = version;
            // A stream of change events cannot prolong stale presentation.
            mark_dirty(entry, now);
        }
        if live_readable {
            entry.unreadable_since = None;
        } else {
            entry.unreadable_since.get_or_insert(now);
        }

        // A just-completed background read reset refreshed_at. Compute after
        // polling so the old deadline cannot start a redundant second request.
        let refresh_due = entry.cache.as_ref().is_some_and(|cache| {
            now.saturating_sub(cache.refreshed_at) >= self.provider.refresh_interval(&entry.watch)
        });
        if live_readable
            && entry.in_flight.is_none()
            && (entry.dirty_since.is_some() || refresh_due)
            && now >= entry.retry_at
        {
            let requested_version = self.provider.version(&entry.watch);
            if requested_version != entry.observed_version {
                entry.observed_version = requested_version;
                mark_dirty(entry, now);
            }
            match self.provider.start(&handle) {
                Ok(operation) => {
                    entry.in_flight = Some(InFlight {
                        operation,
                        version: requested_version,
                        generation: entry.generation,
                        started_at: now,
                    });
                    // Completed synchronous/native-cache reads need no extra tick.
                    poll_in_flight(&mut self.provider, entry, now);
                }
                Err(code) => fail(entry, now, "metadata-start", Some(code)),
            }
        }

        // An event can race GetResults. Sample again before authorizing transport.
        let latest_version = self.provider.version(&entry.watch);
        if latest_version != entry.observed_version {
            entry.observed_version = latest_version;
            mark_dirty(entry, now);
        }
        let dirty_expired = entry
            .dirty_since
            .is_some_and(|since| now.saturating_sub(since) >= DIRTY_CONTEXT_LIFETIME);
        let unreadable_expired = entry
            .unreadable_since
            .is_some_and(|since| now.saturating_sub(since) >= UNREADABLE_CONTEXT_LIFETIME);
        MetadataState {
            metadata: (!dirty_expired && !unreadable_expired)
                .then(|| entry.cache.as_ref().map(|cache| cache.value.clone()))
                .flatten(),
            updating: entry.dirty_since.is_some() || !live_readable,
            error: if live_readable {
                entry.error.clone()
            } else {
                Some(MetadataFailure {
                    stage: "playback-read",
                    code: None,
                })
            },
            recover_manager: entry.failures >= 3 || dirty_expired || unreadable_expired,
        }
    }
}

impl<P: MetadataProvider> Drop for MetadataCoordinator<P> {
    fn drop(&mut self) {
        self.clear();
    }
}

fn cancel<P: MetadataProvider>(provider: &mut P, entry: &mut Entry<P>) {
    if let Some(mut pending) = entry.in_flight.take() {
        provider.cancel(&mut pending.operation);
    }
}

fn mark_dirty<P: MetadataProvider>(entry: &mut Entry<P>, now: Duration) {
    entry.generation = entry.generation.wrapping_add(1);
    entry.dirty_since.get_or_insert(now);
}

fn fail<P: MetadataProvider>(
    entry: &mut Entry<P>,
    now: Duration,
    stage: &'static str,
    code: Option<i32>,
) {
    entry.failures = entry.failures.saturating_add(1);
    let seconds = match entry.failures {
        1 => 1,
        2 => 2,
        3 => 4,
        _ => 5,
    };
    entry.retry_at = now.saturating_add(Duration::from_secs(seconds));
    entry.error = Some(MetadataFailure { stage, code });
    // One failed background refresh is observable but does not interrupt an
    // otherwise unchanged, readable session. Repeated failures revoke controls.
    if entry.cache.is_none() || entry.dirty_since.is_some() || entry.failures >= 2 {
        entry.dirty_since.get_or_insert(now);
    }
}

fn poll_in_flight<P: MetadataProvider>(provider: &mut P, entry: &mut Entry<P>, now: Duration) {
    let Some(mut pending) = entry.in_flight.take() else {
        return;
    };
    match provider.poll(&mut pending.operation) {
        MetadataPoll::Pending => {
            if now.saturating_sub(pending.started_at) >= OPERATION_DEADLINE {
                provider.cancel(&mut pending.operation);
                fail(entry, now, "metadata-timeout", None);
            } else {
                entry.in_flight = Some(pending);
            }
        }
        MetadataPoll::Ready(metadata) => {
            let version = provider.version(&entry.watch);
            if version != pending.version || entry.generation != pending.generation {
                // Old-generation completion never becomes current, even briefly.
                entry.observed_version = version;
                entry.dirty_since.get_or_insert(now);
            } else if provider.has_content(&metadata) {
                entry.cache = Some(Cached {
                    value: metadata,
                    version,
                    refreshed_at: now,
                });
                entry.dirty_since = None;
                entry.failures = 0;
                entry.retry_at = now;
                entry.error = None;
            } else {
                fail(entry, now, "metadata-empty", None);
            }
        }
        MetadataPoll::Failed(code) => fail(entry, now, "metadata-read", Some(code)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::RefCell,
        collections::{HashMap, VecDeque},
        rc::Rc,
    };

    #[derive(Clone)]
    struct Handle {
        id: u32,
        app: &'static str,
    }

    #[derive(Clone)]
    enum Plan {
        StartFailure(i32),
        Complete {
            after: Duration,
            result: Result<&'static str, i32>,
            change: bool,
        },
    }

    fn complete(seconds: u64, title: &'static str) -> Plan {
        Plan::Complete {
            after: Duration::from_secs(seconds),
            result: Ok(title),
            change: false,
        }
    }

    #[derive(Default)]
    struct FakeState {
        now: Duration,
        versions: HashMap<u32, u64>,
        plans: HashMap<u32, VecDeque<Plan>>,
        starts: Vec<u32>,
        polls: Vec<u32>,
        canceled: Vec<u32>,
        unsubscribed: Vec<u32>,
        fallback: bool,
    }

    #[derive(Clone, Default)]
    struct Fake(Rc<RefCell<FakeState>>);

    struct Watch {
        id: u32,
        state: Rc<RefCell<FakeState>>,
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            self.state.borrow_mut().unsubscribed.push(self.id);
        }
    }

    struct Operation {
        id: u32,
        at: Duration,
        plan: Plan,
        canceled: bool,
    }

    impl Fake {
        fn plan(&self, id: u32, plans: impl IntoIterator<Item = Plan>) {
            self.0
                .borrow_mut()
                .plans
                .entry(id)
                .or_default()
                .extend(plans);
        }

        fn at(&self, milliseconds: u64) -> Duration {
            let now = Duration::from_millis(milliseconds);
            self.0.borrow_mut().now = now;
            now
        }

        fn change(&self, id: u32) {
            *self.0.borrow_mut().versions.entry(id).or_default() += 1;
        }
    }

    impl MetadataProvider for Fake {
        type Identity = u32;
        type Handle = Handle;
        type Watch = Watch;
        type Operation = Operation;
        type Metadata = &'static str;

        fn watch(&mut self, handle: &Handle) -> Watch {
            assert_eq!(handle.app, "Opera");
            Watch {
                id: handle.id,
                state: self.0.clone(),
            }
        }

        fn version(&self, watch: &Watch) -> u64 {
            self.0
                .borrow()
                .versions
                .get(&watch.id)
                .copied()
                .unwrap_or_default()
        }

        fn refresh_interval(&self, _watch: &Watch) -> Duration {
            if self.0.borrow().fallback {
                Duration::from_secs(8)
            } else {
                SAFETY_REFRESH
            }
        }

        fn start(&mut self, handle: &Handle) -> Result<Operation, i32> {
            let mut state = self.0.borrow_mut();
            state.starts.push(handle.id);
            let plan = state
                .plans
                .entry(handle.id)
                .or_default()
                .pop_front()
                .unwrap_or_else(|| complete(100, "unexpected extra read"));
            if let Plan::StartFailure(code) = plan {
                return Err(code);
            }
            Ok(Operation {
                id: handle.id,
                at: state.now,
                plan,
                canceled: false,
            })
        }

        fn poll(&mut self, operation: &mut Operation) -> MetadataPoll<&'static str> {
            assert!(!operation.canceled, "a canceled operation was polled again");
            let mut state = self.0.borrow_mut();
            state.polls.push(operation.id);
            match operation.plan {
                Plan::Complete {
                    after,
                    result,
                    change,
                } if state.now.saturating_sub(operation.at) >= after => {
                    if change {
                        *state.versions.entry(operation.id).or_default() += 1;
                    }
                    match result {
                        Ok(value) => MetadataPoll::Ready(value),
                        Err(code) => MetadataPoll::Failed(code),
                    }
                }
                _ => MetadataPoll::Pending,
            }
        }

        fn cancel(&mut self, operation: &mut Operation) {
            assert!(!operation.canceled);
            operation.canceled = true;
            self.0.borrow_mut().canceled.push(operation.id);
        }

        fn has_content(&self, metadata: &&'static str) -> bool {
            !metadata.trim().is_empty()
        }
    }

    fn handle(id: u32) -> Handle {
        Handle { id, app: "Opera" }
    }

    #[test]
    fn repeated_playback_seek_polls_reuse_metadata_without_starting_native_reads() {
        let provider = Fake::default();
        provider.plan(1, [complete(0, "current track")]);
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        let initial = coordinator.read(1, handle(1), true, provider.at(0));
        assert_eq!(initial.metadata, Some("current track"));
        assert!(!initial.updating);
        // The adapter may report any timeline position (zero, forward, backward
        // or absent); none of those is a MediaPropertiesChanged invalidation.
        for milliseconds in [900, 1_800, 2_700, 3_600, 7_200, 15_000, 29_999] {
            let state = coordinator.read(1, handle(1), true, provider.at(milliseconds));
            assert_eq!(state.metadata, Some("current track"));
            assert!(!state.updating);
            assert!(coordinator.is_ready(&1, provider.at(milliseconds)));
        }
        assert_eq!(provider.0.borrow().starts, [1]);
    }

    #[test]
    fn one_slow_native_read_completes_after_two_seconds_without_cancel_or_restart() {
        let provider = Fake::default();
        provider.plan(1, [complete(3, "slow SoundCloud")]);
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        for milliseconds in [0, 900, 1_800, 2_700] {
            let state = coordinator.read(1, handle(1), true, provider.at(milliseconds));
            assert!(state.metadata.is_none());
            assert!(state.updating);
            assert!(!coordinator.is_ready(&1, provider.at(milliseconds)));
        }
        let state = coordinator.read(1, handle(1), true, provider.at(3_600));
        assert_eq!(state.metadata, Some("slow SoundCloud"));
        assert!(!state.updating);
        assert_eq!(provider.0.borrow().starts, [1]);
        assert!(provider.0.borrow().canceled.is_empty());
    }

    #[test]
    fn event_during_pending_read_discards_old_completion_and_never_authorizes_it() {
        let provider = Fake::default();
        provider.plan(
            1,
            [
                complete(0, "old track"),
                complete(3, "obsolete track"),
                complete(1, "new track"),
            ],
        );
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        provider.change(1);
        assert!(!coordinator.is_ready(&1, provider.at(1_000)));
        let pending = coordinator.read(1, handle(1), true, provider.at(1_000));
        assert_eq!(pending.metadata, Some("old track"));
        assert!(pending.updating);
        provider.change(1);
        let stale = coordinator.read(1, handle(1), true, provider.at(4_000));
        assert_eq!(stale.metadata, Some("old track"));
        assert!(stale.updating);
        assert!(!coordinator.is_ready(&1, provider.at(4_000)));
        let ready = coordinator.read(1, handle(1), true, provider.at(5_000));
        assert_eq!(ready.metadata, Some("new track"));
        assert!(!ready.updating);
        assert_eq!(provider.0.borrow().starts, [1, 1, 1]);
    }

    #[test]
    fn event_racing_native_get_results_is_checked_after_completion() {
        let provider = Fake::default();
        provider.plan(
            1,
            [
                Plan::Complete {
                    after: Duration::ZERO,
                    result: Ok("obsolete"),
                    change: true,
                },
                complete(0, "current"),
            ],
        );
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        let state = coordinator.read(1, handle(1), true, provider.at(0));
        assert!(state.metadata.is_none());
        assert!(state.updating);
        assert!(!coordinator.is_ready(&1, provider.at(0)));
        let ready = coordinator.read(1, handle(1), true, provider.at(900));
        assert_eq!(ready.metadata, Some("current"));
        assert!(!ready.updating);
    }

    #[test]
    fn repeated_change_events_cannot_extend_the_twelve_second_stale_context_limit() {
        let provider = Fake::default();
        provider.plan(
            1,
            [
                complete(0, "cached track"),
                complete(100, "never"),
                complete(100, "still pending"),
            ],
        );
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        for milliseconds in [1_000, 3_000, 5_000, 7_000, 9_000, 11_000, 12_999] {
            provider.change(1);
            let state = coordinator.read(1, handle(1), true, provider.at(milliseconds));
            assert_eq!(state.metadata, Some("cached track"));
            assert!(state.updating);
        }
        provider.change(1);
        let expired = coordinator.read(1, handle(1), true, provider.at(13_000));
        assert!(expired.metadata.is_none());
        assert!(expired.updating);
        assert!(expired.recover_manager);
        assert_eq!(provider.0.borrow().canceled, [1]);
    }

    #[test]
    fn failures_back_off_one_two_four_then_five_seconds_and_success_recovers() {
        let provider = Fake::default();
        provider.plan(
            1,
            [
                Plan::StartFailure(-1),
                Plan::StartFailure(-2),
                Plan::StartFailure(-3),
                Plan::StartFailure(-4),
                complete(0, "recovered"),
            ],
        );
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        for (milliseconds, starts, recovery) in [
            (0, 1, false),
            (999, 1, false),
            (1_000, 2, false),
            (2_999, 2, false),
            (3_000, 3, true),
            (6_999, 3, true),
            (7_000, 4, true),
            (11_999, 4, true),
        ] {
            let state = coordinator.read(1, handle(1), true, provider.at(milliseconds));
            assert!(state.metadata.is_none());
            assert!(state.updating);
            assert_eq!(state.recover_manager, recovery);
            assert_eq!(state.error.unwrap().stage, "metadata-start");
            assert_eq!(provider.0.borrow().starts.len(), starts);
        }
        let ready = coordinator.read(1, handle(1), true, provider.at(12_000));
        assert_eq!(ready.metadata, Some("recovered"));
        assert!(!ready.updating);
        assert!(!ready.recover_manager);
        assert!(ready.error.is_none());
    }

    #[test]
    fn completion_failure_and_empty_metadata_never_replace_valid_context() {
        let provider = Fake::default();
        provider.plan(
            1,
            [
                complete(0, "known title"),
                Plan::Complete {
                    after: Duration::ZERO,
                    result: Err(-77),
                    change: false,
                },
                complete(0, "   "),
                complete(0, "next title"),
            ],
        );
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        provider.change(1);
        let failure = coordinator.read(1, handle(1), true, provider.at(1_000));
        assert_eq!(failure.metadata, Some("known title"));
        assert_eq!(
            failure.error.unwrap(),
            MetadataFailure {
                stage: "metadata-read",
                code: Some(-77)
            }
        );
        let empty = coordinator.read(1, handle(1), true, provider.at(2_000));
        assert_eq!(empty.metadata, Some("known title"));
        assert_eq!(empty.error.unwrap().stage, "metadata-empty");
        assert!(!coordinator.is_ready(&1, provider.at(2_000)));
        let ready = coordinator.read(1, handle(1), true, provider.at(4_000));
        assert_eq!(ready.metadata, Some("next title"));
        assert!(!ready.updating);
    }

    #[test]
    fn unreadable_playback_retains_context_only_four_seconds_and_disables_transport() {
        let provider = Fake::default();
        provider.plan(1, [complete(0, "known title")]);
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        for milliseconds in [1_000, 2_000, 4_999] {
            let state = coordinator.read(1, handle(1), false, provider.at(milliseconds));
            assert_eq!(state.metadata, Some("known title"));
            assert!(state.updating);
            assert_eq!(state.error.unwrap().stage, "playback-read");
            assert!(!coordinator.is_ready(&1, provider.at(milliseconds)));
        }
        let expired = coordinator.read(1, handle(1), false, provider.at(5_000));
        assert!(expired.metadata.is_none());
        assert!(expired.recover_manager);
        assert_eq!(provider.0.borrow().starts, [1]);
        let recovered = coordinator.read(1, handle(1), true, provider.at(6_000));
        assert_eq!(recovered.metadata, Some("known title"));
        assert!(!recovered.updating);
        assert!(recovered.error.is_none());
    }

    #[test]
    fn removal_closed_or_replacement_cancels_unsubscribes_and_discards_late_results() {
        let provider = Fake::default();
        provider.plan(1, [complete(3, "closed tab title")]);
        provider.plan(2, [complete(0, "reopened tab title")]);
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        // The adapter excludes Closed and removed identities from its catalog.
        coordinator.reconcile(&[]);
        assert_eq!(provider.0.borrow().canceled, [1]);
        assert_eq!(provider.0.borrow().unsubscribed, [1]);
        let reopened = coordinator.read(2, handle(2), true, provider.at(1_000));
        assert_eq!(reopened.metadata, Some("reopened tab title"));
        let polls_after_removal = provider.0.borrow().polls.len();
        let later = coordinator.read(2, handle(2), true, provider.at(5_000));
        assert_eq!(later.metadata, Some("reopened tab title"));
        assert_eq!(provider.0.borrow().polls.len(), polls_after_removal);
        assert!(!coordinator.is_ready(&1, provider.at(5_000)));
    }

    #[test]
    fn two_tabs_of_same_application_have_separate_cache_and_change_generations() {
        let provider = Fake::default();
        provider.plan(1, [complete(0, "tab one"), complete(1, "tab one new")]);
        provider.plan(2, [complete(0, "tab two")]);
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        assert_eq!(
            coordinator
                .read(1, handle(1), true, provider.at(0))
                .metadata,
            Some("tab one")
        );
        assert_eq!(
            coordinator
                .read(2, handle(2), true, provider.at(0))
                .metadata,
            Some("tab two")
        );
        provider.change(1);
        let one = coordinator.read(1, handle(1), true, provider.at(1_000));
        let two = coordinator.read(2, handle(2), true, provider.at(1_000));
        assert!(one.updating);
        assert_eq!(one.metadata, Some("tab one"));
        assert!(!two.updating);
        assert_eq!(two.metadata, Some("tab two"));
        assert!(coordinator.is_ready(&2, provider.at(1_000)));
        assert!(!coordinator.is_ready(&1, provider.at(1_000)));
    }

    #[test]
    fn tick_cancels_overdue_unvisited_operations_and_retry_does_not_spin() {
        let provider = Fake::default();
        provider.plan(1, [complete(100, "hung"), complete(0, "retry")]);
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        coordinator.tick(provider.at(8_000));
        coordinator.tick(provider.at(8_500));
        assert_eq!(provider.0.borrow().canceled, [1]);
        let cooling = coordinator.read(1, handle(1), true, provider.at(8_999));
        assert_eq!(cooling.error.unwrap().stage, "metadata-timeout");
        assert_eq!(provider.0.borrow().starts, [1]);
        let ready = coordinator.read(1, handle(1), true, provider.at(9_000));
        assert_eq!(ready.metadata, Some("retry"));
        assert_eq!(provider.0.borrow().starts, [1, 1]);
    }

    #[test]
    fn safety_refresh_and_event_subscription_fallback_have_bounded_intervals() {
        for (fallback, seconds) in [(false, 30), (true, 8)] {
            let provider = Fake::default();
            provider.0.borrow_mut().fallback = fallback;
            provider.plan(1, [complete(0, "initial"), complete(1, "refreshed")]);
            let mut coordinator = MetadataCoordinator::new(provider.clone());
            coordinator.read(1, handle(1), true, provider.at(0));
            assert!(coordinator.is_ready(&1, provider.at(seconds * 1_000 - 1)));
            assert!(coordinator.is_ready(&1, provider.at(seconds * 1_000)));
            let refreshing = coordinator.read(1, handle(1), true, provider.at(seconds * 1_000));
            assert_eq!(refreshing.metadata, Some("initial"));
            assert!(!refreshing.updating);
            assert!(coordinator.is_ready(&1, provider.at(seconds * 1_000)));
            let ready = coordinator.read(1, handle(1), true, provider.at((seconds + 1) * 1_000));
            assert_eq!(ready.metadata, Some("refreshed"));
            assert!(!ready.updating);
            assert_eq!(provider.0.borrow().starts, [1, 1]);
            let later = coordinator.read(1, handle(1), true, provider.at((seconds + 10) * 1_000));
            assert!(later.error.is_none());
            assert!(!later.updating);
        }
    }

    #[test]
    fn tick_collects_completed_metadata_from_an_unvisited_candidate_before_timeout() {
        let provider = Fake::default();
        provider.plan(1, [complete(3, "completed background candidate")]);
        provider.plan(2, [complete(0, "currently selected candidate")]);
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        coordinator.read(2, handle(2), true, provider.at(0));
        // Candidate one is not visited by selection again; global tick still
        // collects its result instead of inventing an eight-second timeout.
        coordinator.tick(provider.at(8_000));
        assert!(coordinator.is_ready(&1, provider.at(8_000)));
        assert!(provider.0.borrow().canceled.is_empty());
        let state = coordinator.read(1, handle(1), true, provider.at(8_900));
        assert_eq!(state.metadata, Some("completed background candidate"));
        assert!(state.error.is_none());
        assert!(!state.updating);
        assert_eq!(provider.0.borrow().starts, [1, 2]);
    }

    #[test]
    fn isolated_background_refresh_failure_keeps_controls_but_repeated_failures_revoke_them() {
        let provider = Fake::default();
        provider.plan(
            1,
            [
                complete(0, "initial"),
                Plan::StartFailure(-1),
                complete(0, "refreshed"),
                Plan::StartFailure(-2),
                Plan::StartFailure(-3),
                complete(0, "recovered"),
            ],
        );
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        let transient = coordinator.read(1, handle(1), true, provider.at(30_000));
        assert_eq!(transient.metadata, Some("initial"));
        assert_eq!(transient.error.unwrap().code, Some(-1));
        assert!(!transient.updating);
        assert!(coordinator.is_ready(&1, provider.at(30_000)));
        let refreshed = coordinator.read(1, handle(1), true, provider.at(31_000));
        assert_eq!(refreshed.metadata, Some("refreshed"));
        assert!(refreshed.error.is_none());
        let first_again = coordinator.read(1, handle(1), true, provider.at(61_000));
        assert!(
            !first_again.updating,
            "success resets the consecutive failure count"
        );
        assert!(coordinator.is_ready(&1, provider.at(61_000)));
        let sustained = coordinator.read(1, handle(1), true, provider.at(62_000));
        assert_eq!(sustained.metadata, Some("refreshed"));
        assert!(sustained.updating);
        assert!(!coordinator.is_ready(&1, provider.at(62_000)));
        let recovered = coordinator.read(1, handle(1), true, provider.at(64_000));
        assert_eq!(recovered.metadata, Some("recovered"));
        assert!(!recovered.updating);
        assert!(recovered.error.is_none());
    }

    #[test]
    fn manual_skip_invalidation_rejects_pre_skip_completion_even_without_event() {
        let provider = Fake::default();
        provider.plan(
            1,
            [
                complete(0, "old track"),
                complete(3, "pre skip result"),
                complete(1, "post skip result"),
            ],
        );
        let mut coordinator = MetadataCoordinator::new(provider.clone());
        coordinator.read(1, handle(1), true, provider.at(0));
        coordinator.invalidate(&1, provider.at(1_000));
        coordinator.read(1, handle(1), true, provider.at(1_000));
        coordinator.invalidate(&1, provider.at(2_000));
        assert!(!coordinator.is_ready(&1, provider.at(2_000)));
        let stale = coordinator.read(1, handle(1), true, provider.at(4_000));
        assert_eq!(stale.metadata, Some("old track"));
        assert!(stale.updating);
        let ready = coordinator.read(1, handle(1), true, provider.at(5_000));
        assert_eq!(ready.metadata, Some("post skip result"));
        assert!(coordinator.is_ready(&1, provider.at(5_000)));
    }

    #[test]
    fn clearing_and_drop_release_all_pending_operations_and_subscriptions() {
        let provider = Fake::default();
        {
            let mut coordinator = MetadataCoordinator::new(provider.clone());
            coordinator.read(1, handle(1), true, provider.at(0));
            coordinator.clear();
            assert_eq!(provider.0.borrow().canceled, [1]);
            assert_eq!(provider.0.borrow().unsubscribed, [1]);
            coordinator.read(2, handle(2), true, provider.at(1_000));
        }
        assert_eq!(provider.0.borrow().canceled, [1, 2]);
        assert_eq!(provider.0.borrow().unsubscribed, [1, 2]);
    }
}
