//! Physical geometry shared by the reserved viewport and its native input region.
//! Kept independent of Tauri/Win32 so anchor, DPI and clipping can be tested.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PixelRect { pub x: i32, pub y: i32, pub width: u32, pub height: u32 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FrameGeometry {
    pub viewport: PixelRect,
    /// Window-local coordinates, including the existing transparent shadow margin.
    pub region: PixelRect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Anchor { Left, Center, Right }

pub(crate) struct Reservation {
    pub anchor: Anchor,
    pub maximum_width: f64,
    pub maximum_height: f64,
    pub horizontal_inset: f64,
    pub top_inset: f64,
    pub bottom_inset: f64,
}

/// A normal opening changes only `region`; the monitor-dependent viewport stays fixed.
pub(crate) fn layout(area: PixelRect, scale: f64, policy: Reservation, width: f64, height: f64) -> FrameGeometry {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let pixels = |value: f64| (value.max(0.0) * scale).round().min(f64::from(i32::MAX)) as u32;
    let inset_x = pixels(policy.horizontal_inset).min(area.width.saturating_sub(1) / 2);
    let inset_top = pixels(policy.top_inset).min(area.height.saturating_sub(1));
    let inset_bottom = pixels(policy.bottom_inset).min(area.height.saturating_sub(inset_top + 1));
    let viewport_width = pixels(policy.maximum_width).max(1).min(area.width.saturating_sub(inset_x * 2).max(1));
    let viewport_height = pixels(policy.maximum_height).max(1).min(area.height.saturating_sub(inset_top + inset_bottom).max(1));
    let region_width = pixels(width).max(1).min(viewport_width);
    let region_height = pixels(height).max(1).min(viewport_height);
    let (frame_offset, region_offset) = match policy.anchor {
        Anchor::Left => (inset_x, 0),
        Anchor::Center => ((area.width.saturating_sub(viewport_width)) / 2, (viewport_width - region_width) / 2),
        Anchor::Right => (area.width.saturating_sub(inset_x + viewport_width), viewport_width - region_width),
    };
    FrameGeometry {
        viewport: PixelRect { x: area.x.saturating_add(frame_offset as i32), y: area.y.saturating_add(inset_top as i32), width: viewport_width, height: viewport_height },
        region: PixelRect { x: region_offset as i32, y: 0, width: region_width, height: region_height },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn policy(anchor: Anchor) -> Reservation {
        Reservation { anchor, maximum_width: if anchor == Anchor::Center { 664.0 } else { 384.0 }, maximum_height: 424.0, horizontal_inset: if anchor == Anchor::Center { 0.0 } else { 2.0 }, top_inset: 2.0, bottom_inset: if anchor == Anchor::Center { 0.0 } else { 2.0 } }
    }
    #[test]
    fn opening_does_not_move_or_resize_any_reserved_viewport() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            for anchor in [Anchor::Left, Anchor::Center, Anchor::Right] {
                let area = PixelRect { x: -1920, y: 40, width: 1920, height: 1040 };
                let compact = layout(area, scale, policy(anchor), 120.0, 48.0);
                let expanded = layout(area, scale, policy(anchor), 580.0, 390.0);
                assert_eq!(compact.viewport, expanded.viewport);
                assert!(expanded.region.width >= compact.region.width);
                assert!(expanded.region.height >= compact.region.height);
                match anchor {
                    Anchor::Left => assert_eq!(compact.region.x, expanded.region.x),
                    Anchor::Right => assert_eq!(compact.region.x + compact.region.width as i32, expanded.region.x + expanded.region.width as i32),
                    Anchor::Center => assert!((compact.region.x * 2 + compact.region.width as i32 - expanded.region.x * 2 - expanded.region.width as i32).abs() <= 1),
                }
            }
        }
    }
    #[test]
    fn all_regions_remain_inside_small_work_areas_and_reserved_frames() {
        for (width, height) in [(160, 140), (1, 1), (1920, 1040)] {
            for scale in [1.0, 1.25, 1.5, 2.0] {
                for anchor in [Anchor::Left, Anchor::Center, Anchor::Right] {
                    let area = PixelRect { x: -2000, y: -40, width, height };
                    for (requested_width, requested_height) in [(120.0, 48.0), (664.0, 424.0), (5000.0, 5000.0)] {
                        let frame = layout(area, scale, policy(anchor), requested_width, requested_height);
                        assert!(frame.viewport.x >= area.x && frame.viewport.y >= area.y);
                        assert!(i64::from(frame.viewport.x) + i64::from(frame.viewport.width) <= i64::from(area.x) + i64::from(area.width));
                        assert!(i64::from(frame.viewport.y) + i64::from(frame.viewport.height) <= i64::from(area.y) + i64::from(area.height));
                        assert!(frame.region.x >= 0 && frame.region.y >= 0);
                        assert!(frame.region.x as u32 + frame.region.width <= frame.viewport.width);
                        assert!(frame.region.y as u32 + frame.region.height <= frame.viewport.height);
                    }
                }
            }
        }
    }
    #[test]
    fn footprint_rounding_is_physical_and_does_not_enlarge_the_reservation() {
        let area = PixelRect { x: 0, y: 0, width: 1920, height: 1080 };
        let frame = layout(area, 1.25, policy(Anchor::Center), 121.0, 49.0);
        assert_eq!((frame.region.width, frame.region.height), (151, 61));
        assert_eq!((frame.viewport.width, frame.viewport.height), (830, 530));
    }
}

/// Ephemeral logical dimensions survive a DPI event whose HRGN is still in old pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LogicalFootprint { pub width: f64, pub height: f64, pub scale: f64 }

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct FrameVersion {
    pub generation: u64,
    pub logical: Option<LogicalFootprint>,
    pending_dpi: Option<u64>,
}
impl FrameVersion {
    pub fn begin(&mut self) -> u64 { self.generation = self.generation.wrapping_add(1); self.generation }
    pub fn commit(&mut self, generation: u64, logical: Option<LogicalFootprint>) {
        if generation == self.generation { self.logical = logical; }
    }
    pub fn restore(&mut self, generation: u64, logical: Option<LogicalFootprint>, current_scale: f64) {
        if generation != self.generation { return; }
        self.logical = logical;
        // The restored HRGN may still contain pixels from the previous DPI.
        if logical.is_some_and(|value| (value.scale - current_scale).abs() > f64::EPSILON) { self.schedule_dpi(); }
    }
    pub fn abort(&mut self, generation: u64) {
        // An unsuccessful superseding resize has not satisfied pending DPI work.
        if generation == self.generation && self.pending_dpi.is_some() { self.pending_dpi = Some(generation); }
    }
    pub fn clear_dpi(&mut self, generation: u64) {
        if generation == self.generation { self.pending_dpi = None; }
    }
    pub fn schedule_dpi(&mut self) { self.pending_dpi = Some(self.generation); }
    pub fn take_dpi(&mut self) -> Option<(u64, LogicalFootprint)> {
        let generation = self.pending_dpi.take()?;
        (generation == self.generation).then_some(self.logical).flatten().map(|logical| (generation, logical))
    }
}

#[cfg(test)]
mod dpi_tests {
    use super::*;
    #[test]
    fn dpi_reflow_preserves_logical_footprint_instead_of_dividing_old_pixels_by_new_scale() {
        let area = PixelRect { x: 0, y: 0, width: 2560, height: 1440 };
        let policy = || Reservation { anchor: Anchor::Center, maximum_width: 664.0, maximum_height: 424.0, horizontal_inset: 0.0, top_inset: 2.0, bottom_inset: 0.0 };
        let mut state = FrameVersion::default();
        let generation = state.begin();
        state.commit(generation, Some(LogicalFootprint { width: 580.0, height: 300.0, scale: 1.0 }));
        state.schedule_dpi();
        let (_, logical) = state.take_dpi().unwrap();
        let after = layout(area, 1.5, policy(), logical.width, logical.height);
        assert_eq!((after.region.width, after.region.height), (870, 450));
        assert_eq!((after.viewport.width, after.viewport.height), (996, 636));
    }
    #[test]
    fn late_cursor_or_show_failure_restores_logical_size_and_refreshes_old_dpi_pixels() {
        let mut state = FrameVersion::default();
        let previous = LogicalFootprint { width: 120.0, height: 48.0, scale: 1.0 };
        let first = state.begin(); state.commit(first, Some(previous));
        state.schedule_dpi();
        let prepared = state.begin();
        state.commit(prepared, Some(LogicalFootprint { width: 304.0, height: 200.0, scale: 1.5 }));
        let restored = state.begin(); state.restore(restored, Some(previous), 1.5);
        assert_eq!(state.take_dpi(), Some((restored, previous)));
        let latest = state.begin();
        let active = LogicalFootprint { width: 304.0, height: 200.0, scale: 1.5 };
        state.commit(latest, Some(active));
        state.restore(restored, Some(previous), 1.5);
        assert_eq!(state.logical, Some(active));
        assert!(state.take_dpi().is_none());
    }

    #[test]
    fn failed_resize_keeps_confirmed_metadata_and_allows_one_pending_dpi_refresh() {
        let mut state = FrameVersion::default();
        let logical = LogicalFootprint { width: 580.0, height: 300.0, scale: 1.0 };
        let initial = state.begin(); state.commit(initial, Some(logical));
        state.schedule_dpi();
        let failed = state.begin(); state.abort(failed);
        assert_eq!(state.take_dpi(), Some((failed, logical)));
        // The refresh itself fails; clear reentrant DPI marks to avoid retry loops.
        let refresh = state.begin(); state.schedule_dpi(); state.abort(refresh); state.clear_dpi(refresh);
        assert_eq!(state.logical, Some(logical));
        assert!(state.take_dpi().is_none());
    }

    #[test]
    fn newer_presentation_or_reentrant_commit_supersedes_queued_dpi_work() {
        let mut state = FrameVersion::default();
        let older = state.begin();
        state.commit(older, Some(LogicalFootprint { width: 120.0, height: 48.0, scale: 1.0 }));
        state.schedule_dpi();
        let latest = state.begin();
        let logical = LogicalFootprint { width: 580.0, height: 300.0, scale: 1.5 };
        state.commit(latest, Some(logical));
        state.commit(older, Some(LogicalFootprint { width: 96.0, height: 48.0, scale: 1.0 }));
        assert_eq!(state.logical, Some(logical));
        assert!(state.take_dpi().is_none());
        state.schedule_dpi();
        assert_eq!(state.take_dpi(), Some((latest, logical)));
        assert!(state.take_dpi().is_none());
    }
}
