//! AUTO-SLICE-1 spectral-flux baseline, computed on the source PCM grid.
//! Features are independent of proposal parameters and reusable across edits.
use crate::pcm::{PcmError, PcmRegion};
use crate::AudioError;
use ot_domain::onsets::{
    BoundaryWarning, OnsetCandidate, OnsetParameters, OnsetProposal, SuppressedOnset,
    SuppressionReason, MAX_ONSET_CANDIDATES, ONSET_ALGORITHM_VERSION,
};
use ot_domain::slicing::{FrameRange, PcmFrame};
use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const HOP: u64 = 128;
const LONG_FFT: usize = 2048;
const SHORT_FFT: usize = 1024;
const CONTEXT_US: u64 = 500_000;

#[derive(Clone, Copy)]
struct AnalysisFrameIndex(u64);
impl AnalysisFrameIndex {
    fn pcm(self) -> u64 {
        self.0 * HOP
    }
}

#[derive(Clone, Copy)]
struct Feature {
    center: u64,
    bands: [f32; 3],
    score: f32,
}

pub struct OnsetAnalysis {
    pcm: PcmRegion,
    region: FrameRange,
    features: Vec<Feature>,
    // The binding is backend-only. Candidate IDs contain a one-way digest.
    candidate_namespace: String,
}

struct Spectrum {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    gain: f32,
    buffer: Vec<Complex32>,
    scratch: Vec<Complex32>,
    previous: Vec<Vec<f32>>,
    current: Vec<f32>,
}

impl Spectrum {
    fn new(size: usize, channels: usize, planner: &mut FftPlanner<f32>) -> Self {
        let fft = planner.plan_fft_forward(size);
        let window = (0..size)
            .map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / size as f32).cos())
            .collect::<Vec<_>>();
        let gain = window.iter().sum();
        let scratch = vec![Complex32::default(); fft.get_inplace_scratch_len()];
        Self {
            fft,
            window,
            gain,
            buffer: vec![Complex32::default(); size],
            scratch,
            previous: vec![vec![0.0; size / 2 + 1]; channels],
            current: vec![0.0; size / 2 + 1],
        }
    }

    fn flux(
        &mut self,
        pcm: &PcmRegion,
        center: u64,
        channel: usize,
        bands: &[(f32, f32)],
    ) -> [f32; 2] {
        let size = self.buffer.len();
        for (i, value) in self.buffer.iter_mut().enumerate() {
            let frame = center as i64 + i as i64 - (size / 2) as i64;
            *value = Complex32::new(sample(pcm, frame, channel) * self.window[i], 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buffer, &mut self.scratch);
        for (value, spectrum) in self.current.iter_mut().zip(&self.buffer) {
            *value = (1.0 + 1000.0 * spectrum.norm() / self.gain).ln();
        }
        let previous = &mut self.previous[channel];
        let mut result = [0.0; 2];
        for (band, &(low, high)) in bands.iter().enumerate() {
            let mut sum = 0.0;
            let mut count = 0;
            for (k, value) in self.current.iter().enumerate() {
                let frequency = k as f32 * pcm.source.sample_rate as f32 / size as f32;
                if frequency >= low && frequency < high {
                    let reference = previous[k.saturating_sub(1)..=(k + 1).min(previous.len() - 1)]
                        .iter()
                        .copied()
                        .fold(0.0_f32, f32::max);
                    sum += (value - reference).max(0.0);
                    count += 1;
                }
            }
            result[band] = if count == 0 { 0.0 } else { sum / count as f32 };
        }
        previous.copy_from_slice(&self.current);
        result
    }
}

impl OnsetAnalysis {
    pub fn build(
        pcm: PcmRegion,
        region: FrameRange,
        source_binding: &str,
        cancelled: &AtomicBool,
    ) -> Result<Self, PcmError> {
        validate_pcm(&pcm, region)?;
        check_cancel(cancelled)?;
        let rate = pcm.source.sample_rate;
        let context = frames(CONTEXT_US, rate);
        if pcm.range.start().get() > region.start().get().saturating_sub(context)
            || pcm.range.end_exclusive().get()
                < region
                    .end_exclusive()
                    .get()
                    .saturating_add(context)
                    .min(pcm.source.frame_count)
        {
            return Err(invalid(
                "analysis PCM does not include the required context",
            ));
        }
        let channels = usize::from(pcm.source.channels);
        let mut planner = FftPlanner::<f32>::new();
        let mut long = Spectrum::new(LONG_FFT, channels, &mut planner);
        let mut short = Spectrum::new(SHORT_FFT, channels, &mut planner);
        // Leave a full FFT half-window at an artificial PCM edge. Statistics for
        // selected frames still have >200ms of real context on each side.
        let first_pcm = if pcm.range.start().get() == 0 {
            0
        } else {
            pcm.range.start().get() + LONG_FFT as u64 / 2
        };
        let first = first_pcm.div_ceil(HOP);
        let end_pcm = if pcm.range.end_exclusive().get() == pcm.source.frame_count {
            pcm.source.frame_count
        } else {
            pcm.range.end_exclusive().get() - LONG_FFT as u64 / 2
        };
        let count = end_pcm.div_ceil(HOP).saturating_sub(first) as usize;
        let mut raw = Vec::<[f32; 3]>::with_capacity(count);
        for index in first..end_pcm.div_ceil(HOP) {
            check_cancel(cancelled)?;
            let center = AnalysisFrameIndex(index).pcm();
            let mut values = [0.0_f32; 3];
            for channel in 0..channels {
                let low = long.flux(&pcm, center, channel, &[(30.0, 180.0)]);
                let upper = short.flux(
                    &pcm,
                    center,
                    channel,
                    &[
                        (180.0, 2500.0),
                        (2500.0, 18000.0_f32.min(0.45 * rate as f32)),
                    ],
                );
                values[0] = values[0].max(low[0]);
                values[1] = values[1].max(upper[0]);
                values[2] = values[2].max(upper[1]);
            }
            raw.push(values);
        }
        let radius = (frames(200_000, rate) / HOP) as usize;
        let mut values = Vec::with_capacity(2 * radius + 1);
        let mut deviations = Vec::with_capacity(2 * radius + 1);
        let mut features = Vec::with_capacity(raw.len());
        for index in 0..raw.len() {
            check_cancel(cancelled)?;
            let mut z = [0.0; 3];
            for band in 0..3 {
                values.clear();
                values.extend(
                    raw[index.saturating_sub(radius)..=(index + radius).min(raw.len() - 1)]
                        .iter()
                        .map(|v| v[band]),
                );
                let median = median(&mut values);
                deviations.clear();
                deviations.extend(values.iter().map(|v| (v - median).abs()));
                let mad = self::median(&mut deviations);
                z[band] = ((raw[index][band] - median) / (1.4826 * mad + 0.0001)).clamp(0.0, 20.0);
            }
            features.push(Feature {
                center: AnalysisFrameIndex(first + index as u64).pcm(),
                bands: z,
                score: (0.35 * z[0] + 0.40 * z[1] + 0.25 * z[2])
                    .max(0.70 * z.into_iter().fold(0.0_f32, f32::max)),
            });
        }
        use sha2::{Digest, Sha256};
        let candidate_namespace = format!(
            "{:x}",
            Sha256::digest(format!("{ONSET_ALGORITHM_VERSION}:{source_binding}").as_bytes())
        );
        check_cancel(cancelled)?;
        Ok(Self {
            pcm,
            region,
            features,
            candidate_namespace,
        })
    }

    pub fn region(&self) -> FrameRange {
        self.region
    }
    pub fn pcm(&self) -> &PcmRegion {
        &self.pcm
    }

    pub fn propose(
        &self,
        parameters: OnsetParameters,
        protected: &[PcmFrame],
        cancelled: &AtomicBool,
    ) -> Result<OnsetProposal, PcmError> {
        let parameters = parameters.validate().map_err(invalid)?;
        if protected.len() > ot_domain::onsets::MAX_DRAFT_MARKERS {
            return Err(invalid("too many protected markers"));
        }
        check_cancel(cancelled)?;
        let rate = self.pcm.source.sample_rate;
        let radius = frames(8_000, rate);
        let threshold = parameters.threshold();
        let silence = 10.0_f32.powf(f32::from(parameters.silence_floor_db) / 20.0);
        let mut candidates = Vec::new();
        let mut raw_count = 0;
        for (index, feature) in self.features.iter().enumerate() {
            check_cancel(cancelled)?;
            // Refine context peaks as well: a center outside the ROI can refer
            // to an attack inside it. Membership is tested after refinement.
            if feature.center.saturating_add(LONG_FFT as u64) < self.region.start().get()
                || feature.center
                    > self
                        .region
                        .end_exclusive()
                        .get()
                        .saturating_add(LONG_FFT as u64)
                || feature.score < threshold
            {
                continue;
            }
            let nearby = (radius / HOP) as usize;
            if self.features
                [index.saturating_sub(nearby)..=(index + nearby).min(self.features.len() - 1)]
                .iter()
                .any(|other| {
                    other.score > feature.score
                        || (other.score == feature.score && other.center < feature.center)
                })
            {
                continue;
            }
            raw_count += 1;
            if raw_count > MAX_ONSET_CANDIDATES {
                return Err(invalid("ANALYSIS_COMPLEXITY_LIMIT"));
            }
            let (attack, uncertainty, mut warnings) = refine(&self.pcm, feature.center);
            // Centered FFT windows can peak before the actual sound. Apply the
            // 10ms silence gate at the refined attack, not at the FFT center.
            if rms(
                &self.pcm,
                attack.saturating_sub(frames(5_000, rate)),
                attack
                    .saturating_add(frames(5_000, rate))
                    .min(self.pcm.source.frame_count),
            ) < silence
            {
                continue;
            }
            if !self.region.contains(PcmFrame::new(attack)) {
                continue;
            }
            let before = attack.saturating_sub(frames(u64::from(parameters.pre_roll_us), rate));
            let mut start = before.max(self.region.start().get());
            if start != before {
                warnings.push(BoundaryWarning::PreRollClipped);
            }
            if parameters.snap_radius_us > 0 {
                start = snap(
                    &self.pcm,
                    start,
                    attack,
                    self.region,
                    frames(u64::from(parameters.snap_radius_us), rate),
                );
            }
            candidates.push(OnsetCandidate {
                id: format!("onset:{}:{}", self.candidate_namespace, feature.center),
                novelty_peak: PcmFrame::new(feature.center),
                estimated_attack: PcmFrame::new(attack),
                suggested_start: PcmFrame::new(start),
                uncertainty,
                score: feature.score,
                strength: feature.score / (feature.score + threshold),
                band_scores: feature.bands,
                threshold_margin: feature.score - threshold,
                warnings,
            });
            if candidates.len() > MAX_ONSET_CANDIDATES {
                return Err(invalid("ANALYSIS_COMPLEXITY_LIMIT"));
            }
        }
        // Audio already active at the true file edge has no observable attack.
        // This is a flagged proposal, never an inferred hit at an arbitrary ROI.
        let active_edge = self.region.start().get() == 0
            && (0..self.pcm.source.channels)
                .any(|c| sample(&self.pcm, 0, usize::from(c)).abs() >= silence);
        if active_edge {
            for candidate in &mut candidates {
                if candidate.estimated_attack.get() <= frames(500, rate) {
                    candidate.estimated_attack = PcmFrame::new(0);
                    candidate.suggested_start = PcmFrame::new(0);
                    candidate.warnings.push(BoundaryWarning::LeftEdgeTruncated);
                }
            }
        }
        if active_edge
            && (0..self.pcm.source.channels)
                .any(|c| sample(&self.pcm, 0, usize::from(c)).abs() >= silence)
            && !candidates.iter().any(|c| c.estimated_attack.get() == 0)
        {
            candidates.push(OnsetCandidate {
                id: format!("onset:{}:left-edge", self.candidate_namespace),
                novelty_peak: PcmFrame::new(0),
                estimated_attack: PcmFrame::new(0),
                suggested_start: PcmFrame::new(0),
                uncertainty: FrameRange::new(PcmFrame::new(0), PcmFrame::new(1))
                    .expect("one frame"),
                score: 0.0,
                strength: 0.0,
                band_scores: [0.0; 3],
                threshold_margin: 0.0,
                warnings: vec![BoundaryWarning::LeftEdgeTruncated],
            });
        }
        candidates.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then(a.estimated_attack.cmp(&b.estimated_attack))
                .then(a.id.cmp(&b.id))
        });
        let minimum = frames(u64::from(parameters.minimum_interval_ms) * 1000, rate);
        let mut accepted: BTreeMap<u64, OnsetCandidate> = BTreeMap::new();
        let mut starts = std::collections::BTreeSet::new();
        let mut suppressed = Vec::new();
        for candidate in candidates {
            check_cancel(cancelled)?;
            let attack = candidate.estimated_attack.get();
            let reason = if protected.iter().any(|f| f.get().abs_diff(attack) < minimum) {
                Some(SuppressionReason::ProtectedBoundary)
            } else if accepted.contains_key(&attack) {
                Some(SuppressionReason::SameRise)
            } else if accepted
                .range(attack.saturating_sub(minimum - 1)..=attack.saturating_add(minimum - 1))
                .next()
                .is_some()
            {
                Some(SuppressionReason::MinimumInterval)
            } else if starts.contains(&candidate.suggested_start) {
                Some(SuppressionReason::StartCollision)
            } else {
                None
            };
            if let Some(reason) = reason {
                suppressed.push(SuppressedOnset {
                    candidate_id: candidate.id,
                    reason,
                });
            } else {
                starts.insert(candidate.suggested_start);
                accepted.insert(attack, candidate);
            }
        }
        let mut candidates = accepted.into_values().collect::<Vec<_>>();
        candidates.sort_by_key(|c| c.suggested_start);
        check_cancel(cancelled)?;
        Ok(OnsetProposal {
            candidates,
            suppressed,
        })
    }
}

fn validate_pcm(pcm: &PcmRegion, region: FrameRange) -> Result<(), PcmError> {
    if !matches!(pcm.source.bits_per_sample, 16 | 24)
        || pcm.source.frame_count > i64::MAX as u64
        || !matches!(pcm.source.sample_rate, 44_100 | 48_000)
        || !matches!(pcm.source.channels, 1 | 2)
        || pcm.range.within(pcm.source.frame_count).is_err()
        || region.start() < pcm.range.start()
        || region.end_exclusive() > pcm.range.end_exclusive()
        || region.frame_count() > u64::from(pcm.source.sample_rate) * 600
        || pcm
            .range
            .frame_count()
            .checked_mul(u64::from(pcm.source.channels))
            != Some(pcm.samples.len() as u64)
        || pcm.samples.iter().any(|v| !v.is_finite())
    {
        return Err(invalid("invalid or oversized analysis PCM"));
    }
    Ok(())
}

fn sample(pcm: &PcmRegion, frame: i64, channel: usize) -> f32 {
    if frame < pcm.range.start().get() as i64 || frame >= pcm.range.end_exclusive().get() as i64 {
        return 0.0;
    }
    pcm.samples[(frame as u64 - pcm.range.start().get()) as usize
        * usize::from(pcm.source.channels)
        + channel]
}
fn frames(us: u64, rate: u32) -> u64 {
    PcmFrame::from_microseconds(us, rate)
        .expect("bounded time")
        .get()
}
fn check_cancel(cancelled: &AtomicBool) -> Result<(), PcmError> {
    if cancelled.load(Ordering::Relaxed) {
        Err(PcmError::Cancelled)
    } else {
        Ok(())
    }
}
fn invalid(message: &'static str) -> PcmError {
    AudioError::InvalidRequest(message).into()
}
fn median(values: &mut [f32]) -> f32 {
    values.sort_unstable_by(f32::total_cmp);
    let middle = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[middle - 1] + values[middle]) * 0.5
    } else {
        values[middle]
    }
}
fn rms(pcm: &PcmRegion, start: u64, end: u64) -> f32 {
    if end <= start {
        return 0.0;
    }
    (0..usize::from(pcm.source.channels))
        .map(|c| {
            ((start..end)
                .map(|n| f64::from(sample(pcm, n as i64, c)).powi(2))
                .sum::<f64>()
                / (end - start) as f64)
                .sqrt() as f32
        })
        .fold(0.0_f32, f32::max)
}

fn refine(pcm: &PcmRegion, peak: u64) -> (u64, FrameRange, Vec<BoundaryWarning>) {
    let rate = pcm.source.sample_rate;
    let width = frames(500, rate).max(1);
    let start = peak
        .saturating_sub(LONG_FFT as u64 / 2 + frames(20_000, rate))
        .max(pcm.range.start().get());
    let end = peak
        .saturating_add(LONG_FFT as u64 / 2 + frames(10_000, rate))
        .min(pcm.range.end_exclusive().get());
    let envelope = (start..end)
        .map(|n| rms(pcm, n.saturating_sub(width - 1), n + 1))
        .collect::<Vec<_>>();
    let at = |n: usize| envelope[n.min(envelope.len() - 1)];
    let gradient = (0..envelope.len())
        .map(|i| (at(i + width as usize) - at(i.saturating_sub(width as usize))).max(0.0))
        .collect::<Vec<_>>();
    let mut rises = Vec::new();
    for i in 0..gradient.len() {
        if gradient[i] <= 0.0
            || (i > 0 && gradient[i] <= gradient[i - 1])
            || (i + 1 < gradient.len() && gradient[i] < gradient[i + 1])
        {
            continue;
        }
        let distance = (i128::from(start) + i as i128 - i128::from(peak)) as f32;
        let weight = (-0.5 * (distance / (SHORT_FFT as f32 / 2.0)).powi(2)).exp();
        rises.push((i, gradient[i] * weight));
    }
    rises.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let uncertainty =
        FrameRange::new(PcmFrame::new(start), PcmFrame::new(end)).expect("nonempty search window");
    let Some(&(rise, strength)) = rises.first() else {
        return (
            peak.clamp(start, end - 1),
            uncertainty,
            vec![BoundaryWarning::Uncertain],
        );
    };
    let lower = rise.saturating_sub(frames(20_000, rate) as usize);
    let minimum = (lower..=rise)
        .min_by(|a, b| at(*a).total_cmp(&at(*b)).then(a.cmp(b)))
        .unwrap_or(lower);
    // Evaluate the post-rise level: a causal RMS slope can precede its envelope peak.
    let level = at(rise + width as usize);
    let threshold = at(minimum) + 0.1 * (level - at(minimum));
    let crossing = (minimum..=rise + width as usize).find(|&i| {
        i + width as usize <= envelope.len()
            && envelope[i..i + width as usize]
                .iter()
                .all(|v| *v > threshold)
    });
    let mut warnings = Vec::new();
    if crossing.is_none() || rises.get(1).is_some_and(|next| strength < 1.25 * next.1) {
        warnings.push(BoundaryWarning::Uncertain);
    }
    (
        start + crossing.unwrap_or(rise) as u64,
        uncertainty,
        warnings,
    )
}

fn snap(pcm: &PcmRegion, start: u64, attack: u64, region: FrameRange, radius: u64) -> u64 {
    let mut best: Option<(f32, u64, u64)> = None;
    for n in start
        .saturating_sub(radius)
        .max(region.start().get())
        .max(1)
        ..=start
            .saturating_add(radius)
            .min(attack)
            .min(region.end_exclusive().get() - 1)
    {
        let mut crossing = false;
        let mut amplitude = 0.0_f32;
        for c in 0..usize::from(pcm.source.channels) {
            let a = sample(pcm, n as i64 - 1, c);
            let b = sample(pcm, n as i64, c);
            crossing |= a == 0.0 || b == 0.0 || a.is_sign_negative() != b.is_sign_negative();
            amplitude = amplitude.max(a.abs()).max(b.abs());
        }
        let candidate = (amplitude, start.abs_diff(n), n);
        if crossing && amplitude <= 0.01 && best.is_none_or(|old| candidate < old) {
            best = Some(candidate);
        }
    }
    best.map(|v| v.2).unwrap_or(start)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pcm::PcmInfo;

    fn range(start: u64, end: u64) -> FrameRange {
        FrameRange::new(PcmFrame::new(start), PcmFrame::new(end)).unwrap()
    }

    fn fixture(rate: u32, channels: u16, attacks: &[u64]) -> PcmRegion {
        let count = u64::from(rate) * 2;
        let mut samples = vec![0.0; count as usize * usize::from(channels)];
        for &attack in attacks {
            for offset in 0..(rate / 100) {
                let n = attack + u64::from(offset);
                if n >= count {
                    break;
                }
                // Deterministic broadband burst with an exact annotated onset.
                let phase = (offset.wrapping_mul(1103515245).wrapping_add(12345) >> 8) & 65535;
                let value = (phase as f32 / 32768.0 - 1.0)
                    * (-(offset as f32) / (rate as f32 * 0.002)).exp()
                    * 0.8;
                for c in 0..channels {
                    samples[n as usize * usize::from(channels) + usize::from(c)] =
                        if c == 0 { value } else { -value };
                }
            }
        }
        PcmRegion {
            source: PcmInfo {
                sample_rate: rate,
                channels,
                bits_per_sample: 24,
                frame_count: count,
            },
            range: range(0, count),
            samples,
        }
    }

    fn analysis(pcm: PcmRegion) -> OnsetAnalysis {
        let region = pcm.range;
        OnsetAnalysis::build(pcm, region, "synthetic-source", &AtomicBool::new(false)).unwrap()
    }

    #[test]
    fn silence_has_no_fabricated_slice() {
        let result = analysis(fixture(44_100, 2, &[]))
            .propose(OnsetParameters::default(), &[], &AtomicBool::new(false))
            .unwrap();
        assert!(result.candidates.is_empty());
    }

    #[test]
    fn annotated_bursts_keep_source_frames_and_inverse_stereo() {
        for rate in [44_100, 48_000] {
            let attacks = [
                u64::from(rate) / 2,
                u64::from(rate),
                u64::from(rate) * 3 / 2,
            ];
            let mono = analysis(fixture(rate, 1, &attacks))
                .propose(OnsetParameters::default(), &[], &AtomicBool::new(false))
                .unwrap();
            let stereo = analysis(fixture(rate, 2, &attacks))
                .propose(OnsetParameters::default(), &[], &AtomicBool::new(false))
                .unwrap();
            assert_eq!(
                mono.candidates.len(),
                attacks.len(),
                "rate {rate}: {mono:?}"
            );
            assert_eq!(mono, stereo);
            for (candidate, attack) in mono.candidates.iter().zip(attacks) {
                assert!(
                    candidate.estimated_attack.get().abs_diff(attack) <= frames(2_000, rate),
                    "{candidate:?}"
                );
                assert!(candidate.suggested_start <= candidate.estimated_attack);
                assert!(candidate.uncertainty.contains(candidate.estimated_attack));
            }
        }
    }

    #[test]
    fn parameter_changes_reuse_features_and_pre_roll_does_not_accumulate() {
        let analysis = analysis(fixture(44_100, 1, &[22_050, 44_100]));
        let original = analysis
            .propose(OnsetParameters::default(), &[], &AtomicBool::new(false))
            .unwrap();
        let changed = analysis
            .propose(
                OnsetParameters {
                    pre_roll_us: 5_000,
                    ..Default::default()
                },
                &[],
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_eq!(original.candidates.len(), changed.candidates.len());
        for (a, b) in original.candidates.iter().zip(&changed.candidates) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.estimated_attack, b.estimated_attack);
            assert_eq!(
                b.suggested_start.get(),
                b.estimated_attack.get() - frames(5_000, 44_100)
            );
        }
        assert_eq!(
            original,
            analysis
                .propose(OnsetParameters::default(), &[], &AtomicBool::new(false))
                .unwrap()
        );
    }

    #[test]
    fn roi_keeps_global_grid_and_does_not_clamp_outside_hits_to_its_start() {
        let pcm = fixture(44_100, 2, &[22_050, 44_100, 66_150]);
        let analysis = OnsetAnalysis::build(
            pcm,
            range(30_000, 55_000),
            "synthetic-source",
            &AtomicBool::new(false),
        )
        .unwrap();
        let result = analysis
            .propose(OnsetParameters::default(), &[], &AtomicBool::new(false))
            .unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert!(result.candidates[0].estimated_attack.get().abs_diff(44_100) <= 88);
        assert!(result
            .candidates
            .iter()
            .all(|c| c.suggested_start.get() != 30_000));
        let full = self::analysis(fixture(44_100, 2, &[22_050, 44_100, 66_150]))
            .propose(OnsetParameters::default(), &[], &AtomicBool::new(false))
            .unwrap();
        assert_eq!(result.candidates[0], full.candidates[1]);
    }

    #[test]
    fn protected_markers_and_minimum_interval_suppress_only_auto_candidates() {
        let analysis = analysis(fixture(48_000, 1, &[24_000, 28_800, 48_000]));
        let result = analysis
            .propose(
                OnsetParameters {
                    minimum_interval_ms: 250,
                    ..Default::default()
                },
                &[PcmFrame::new(48_000)],
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert!(result
            .suppressed
            .iter()
            .any(|s| s.reason == SuppressionReason::MinimumInterval));
        assert!(result
            .suppressed
            .iter()
            .any(|s| s.reason == SuppressionReason::ProtectedBoundary));
    }

    #[test]
    fn invalid_input_parameters_and_cancellation_fail_without_results() {
        let mut pcm = fixture(44_100, 1, &[22_050]);
        pcm.samples[0] = f32::NAN;
        assert!(
            OnsetAnalysis::build(pcm, range(0, 88_200), "fixture", &AtomicBool::new(false))
                .is_err()
        );
        let pcm = fixture(44_100, 1, &[]);
        assert!(matches!(
            OnsetAnalysis::build(pcm, range(0, 88_200), "fixture", &AtomicBool::new(true)),
            Err(PcmError::Cancelled)
        ));
        let analysis = analysis(fixture(44_100, 1, &[]));
        assert!(analysis
            .propose(
                OnsetParameters {
                    sensitivity: 101,
                    ..Default::default()
                },
                &[],
                &AtomicBool::new(false)
            )
            .is_err());
        assert!(matches!(
            analysis.propose(OnsetParameters::default(), &[], &AtomicBool::new(true)),
            Err(PcmError::Cancelled)
        ));
    }

    #[test]
    fn active_file_edge_is_flagged_and_snap_never_moves_after_the_attack() {
        let mut pcm = fixture(44_100, 2, &[22_050]);
        pcm.samples[0] = 0.5;
        pcm.samples[1] = -0.5;
        let result = analysis(pcm)
            .propose(
                OnsetParameters {
                    snap_radius_us: 2_000,
                    ..Default::default()
                },
                &[],
                &AtomicBool::new(false),
            )
            .unwrap();
        assert!(result
            .candidates
            .iter()
            .any(|c| c.warnings.contains(&BoundaryWarning::LeftEdgeTruncated)));
        assert!(result
            .candidates
            .iter()
            .all(|c| c.suggested_start <= c.estimated_attack));
    }
}
