//! Pure policy shared by the Windows adapter and host-side recovery tests.
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaybackKind {
    Playing,
    Paused,
    Stopped,
    Unknown,
    Closed,
}

/// A current playing session wins; retained paused sessions avoid idle tab churn.
pub fn candidate_rank(status: PlaybackKind, current: bool, retained: bool) -> Option<u8> {
    let preference = if current {
        0
    } else if retained {
        1
    } else {
        2
    };
    match status {
        PlaybackKind::Playing => Some(preference),
        PlaybackKind::Paused => Some(
            3 + if retained {
                0
            } else if current {
                1
            } else {
                2
            },
        ),
        PlaybackKind::Stopped => Some(6 + preference),
        PlaybackKind::Unknown => Some(9 + preference),
        PlaybackKind::Closed => None,
    }
}

pub enum CandidateRead<T> {
    Ready(T),
    Skip,
    Exhausted,
}

/// Rotate only equally ranked candidates, so a broken first tab cannot starve
/// later tabs across polls while playing sessions retain their priority.
pub fn select_candidate<T>(
    ranks: &[u8],
    rotation: usize,
    mut read: impl FnMut(usize) -> CandidateRead<T>,
) -> Option<(usize, T)> {
    let mut order: Vec<usize> = (0..ranks.len()).collect();
    order.sort_by_key(|index| ranks[*index]);
    let mut start = 0;
    while start < order.len() {
        let rank = ranks[order[start]];
        let end = start + order[start..].partition_point(|index| ranks[*index] == rank);
        order[start..end].rotate_left(rotation % (end - start));
        start = end;
    }
    for index in order {
        match read(index) {
            CandidateRead::Ready(value) => return Some((index, value)),
            CandidateRead::Skip => (),
            CandidateRead::Exhausted => break,
        }
    }
    None
}

pub struct ReadBudget {
    deadline: Instant,
}

impl ReadBudget {
    pub fn new(start: Instant) -> Self {
        Self {
            deadline: start + Duration::from_millis(2_500),
        }
    }

    pub fn has_time(&self, now: Instant) -> bool {
        now < self.deadline
    }

    pub fn candidate_deadline(&self, now: Instant, remaining_candidates: usize) -> Option<Instant> {
        // Leave room to try other tabs, but do not permanently exclude a lone
        // legitimate provider that needs the original two-second native limit.
        let limit = if remaining_candidates <= 1 {
            2_000
        } else {
            700
        };
        self.has_time(now)
            .then(|| self.deadline.min(now + Duration::from_millis(limit)))
    }

    pub fn artwork_deadline(&self, now: Instant) -> Option<Instant> {
        (now < self.deadline).then(|| self.deadline.min(now + Duration::from_millis(300)))
    }
}

pub struct Selection<K, H> {
    pub identity: K,
    pub handle: H,
    pub token: String,
}

/// Tokens identify one retained native object incarnation, never an app name.
/// Clearing a selection deliberately does not reset the issuance counter.
pub struct SelectionTracker<K, H> {
    current: Option<Selection<K, H>>,
    issued: u128,
}

impl<K: PartialEq, H> Default for SelectionTracker<K, H> {
    fn default() -> Self {
        Self {
            current: None,
            issued: 0,
        }
    }
}

impl<K: PartialEq, H> SelectionTracker<K, H> {
    pub fn current(&self) -> Option<&Selection<K, H>> {
        self.current.as_ref()
    }

    pub fn select(&mut self, identity: K, handle: H) -> &Selection<K, H> {
        let token = match &self.current {
            Some(current) if current.identity == identity => current.token.clone(),
            _ => {
                self.issued += 1;
                format!("media-{:032x}", self.issued)
            }
        };
        self.current = Some(Selection {
            identity,
            handle,
            token,
        });
        self.current.as_ref().unwrap()
    }

    pub fn handle_for(&self, token: Option<&str>) -> Option<&H> {
        self.current
            .as_ref()
            .filter(|current| Some(current.token.as_str()) == token)
            .map(|current| &current.handle)
    }

    pub fn clear(&mut self) {
        self.current = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_metadata_falls_back_to_another_playing_tab_before_paused_tabs() {
        let mut visited = Vec::new();
        let found = select_candidate(&[5, 0, 2], 0, |index| {
            visited.push(index);
            if index == 1 {
                CandidateRead::Skip
            } else {
                CandidateRead::Ready("valid metadata")
            }
        });
        assert_eq!(found, Some((2, "valid metadata")));
        assert_eq!(visited, vec![1, 2]);
        assert_eq!(candidate_rank(PlaybackKind::Closed, true, true), None);
        assert!(
            candidate_rank(PlaybackKind::Playing, false, false)
                < candidate_rank(PlaybackKind::Paused, true, true)
        );
    }

    #[test]
    fn budget_exhaustion_stops_reads_and_next_poll_rotates_equally_ranked_tabs() {
        let mut visited = Vec::new();
        assert_eq!(
            select_candidate::<()>(&[2, 2, 2, 5], 0, |index| {
                visited.push(index);
                CandidateRead::Exhausted
            }),
            None
        );
        assert_eq!(visited, vec![0]);
        let found = select_candidate(&[2, 2, 2, 5], 1, |index| CandidateRead::Ready(index));
        assert_eq!(found, Some((1, 1)));
        assert_eq!(
            select_candidate(&[5, 0, 2], 100, |index| CandidateRead::Ready(index)),
            Some((1, 1))
        );
    }

    #[test]
    fn candidate_and_artwork_deadlines_share_one_absolute_budget() {
        let start = Instant::now();
        let budget = ReadBudget::new(start);
        assert_eq!(
            budget.candidate_deadline(start, 2),
            Some(start + Duration::from_millis(700))
        );
        let late = start + Duration::from_millis(2_400);
        assert_eq!(
            budget.candidate_deadline(late, 2),
            Some(start + Duration::from_millis(2_500))
        );
        assert_eq!(
            budget.artwork_deadline(start),
            Some(start + Duration::from_millis(300))
        );
        assert_eq!(
            budget.artwork_deadline(late),
            Some(start + Duration::from_millis(2_500))
        );
        assert_eq!(
            budget.candidate_deadline(start + Duration::from_millis(2_500), 2),
            None
        );
        assert_eq!(
            budget.artwork_deadline(start + Duration::from_secs(3)),
            None
        );
        assert_eq!(
            budget.candidate_deadline(start, 1),
            Some(start + Duration::from_secs(2))
        );
        assert_eq!(
            budget.candidate_deadline(late, 1),
            Some(start + Duration::from_millis(2_500))
        );
    }

    #[test]
    fn same_app_tabs_and_reopened_native_objects_never_share_a_control_token() {
        let mut selected = SelectionTracker::default();
        let first = selected.select(("Opera", 1), "tab A").token.clone();
        assert_eq!(selected.select(("Opera", 1), "tab A updated").token, first);
        assert_eq!(selected.handle_for(Some(&first)), Some(&"tab A updated"));
        let second = selected.select(("Opera", 2), "tab B").token.clone();
        assert_ne!(first, second);
        assert_eq!(selected.handle_for(Some(&first)), None);
        assert_eq!(selected.handle_for(None), None);
        assert_eq!(selected.handle_for(Some(&second)), Some(&"tab B"));
        selected.clear();
        assert_eq!(selected.handle_for(Some(&second)), None);
        let reopened = selected
            .select(("Opera", 2), "new incarnation")
            .token
            .clone();
        assert_ne!(reopened, second);
        assert_eq!(selected.handle_for(Some(&second)), None);
    }
}
