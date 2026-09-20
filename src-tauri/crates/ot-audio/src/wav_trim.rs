//! Lossless integer PCM WAV trim (byte-preserving payload).

use crate::pcm::{inspect_wav_layout, PcmError, WavLayout, MAX_SNAPSHOT_BYTES};
use ot_domain::slicing::FrameRange;
use ot_domain::ExpectedTrimOutput;
use std::sync::atomic::{AtomicBool, Ordering};

fn pcm_invalid_request(message: &'static str) -> PcmError {
    PcmError::from(crate::AudioError::InvalidRequest(message))
}

pub fn test_minimal_wav(frames: u32) -> Vec<u8> {
    test_integer_pcm_wav(16, 1, 44_100, frames)
}

pub fn test_integer_pcm_wav(
    bits_per_sample: u16,
    channels: u16,
    sample_rate: u32,
    frames: u32,
) -> Vec<u8> {
    let bytes_per_sample = usize::from(bits_per_sample / 8);
    let block_align = usize::from(channels) * bytes_per_sample;
    let frame_count = usize::try_from(frames).unwrap_or(usize::MAX);
    let mut pcm = vec![0_u8; frame_count.saturating_mul(block_align)];
    for (index, sample) in pcm.chunks_mut(block_align).enumerate() {
        for (channel, chunk) in sample.chunks_mut(bytes_per_sample).enumerate() {
            let value = if index.is_multiple_of(3) {
                1_i32 << (bits_per_sample - 2)
            } else {
                0
            };
            let value = if channel == 0 { value } else { -value };
            if bits_per_sample == 16 {
                chunk.copy_from_slice(&i16::to_le_bytes(value as i16));
            } else {
                let le = value.to_le_bytes();
                chunk.copy_from_slice(&le[..3]);
            }
        }
    }
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF\0\0\0\0WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * u32::from(channels) * u32::from(bits_per_sample / 8);
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&(block_align as u16).to_le_bytes());
    bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&pcm);
    let length = (bytes.len() - 8) as u32;
    bytes[4..8].copy_from_slice(&length.to_le_bytes());
    bytes
}

fn block_align_bytes(channels: u16, bits_per_sample: u16) -> Result<u64, PcmError> {
    if channels == 0 || !matches!(bits_per_sample, 16 | 24) {
        return Err(crate::AudioError::UnsupportedFormat.into());
    }
    let sample_bytes = u64::from(bits_per_sample / 8);
    u64::from(channels)
        .checked_mul(sample_bytes)
        .filter(|&align| align > 0)
        .ok_or_else(|| pcm_invalid_request("invalid PCM block alignment"))
}

fn selected_pcm_slice(layout: &WavLayout, range: FrameRange) -> Result<&[u8], PcmError> {
    range
        .within(layout.info.frame_count)
        .map_err(|_| pcm_invalid_request("trim range outside source"))?;
    let align = block_align_bytes(layout.info.channels, layout.info.bits_per_sample)?;
    let start_frame = range.start().get();
    let end_frame = range.end_exclusive().get();
    let start_byte = start_frame
        .checked_mul(align)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| pcm_invalid_request("trim byte range overflow"))?;
    let end_byte = end_frame
        .checked_mul(align)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| pcm_invalid_request("trim byte range overflow"))?;
    if end_byte > layout.pcm_payload.len() || start_byte >= end_byte {
        return Err(pcm_invalid_request("invalid trim byte range"));
    }
    Ok(&layout.pcm_payload[start_byte..end_byte])
}

fn metadata_matches_trim_source(source: &WavLayout, output: &WavLayout) -> bool {
    source.info.sample_rate == output.info.sample_rate
        && source.info.channels == output.info.channels
        && source.info.bits_per_sample == output.info.bits_per_sample
}

/// Independently verify processor TRIM output against source PCM payload (not full container).
pub fn verify_trim_wav_output(
    source: &[u8],
    range: FrameRange,
    output: &[u8],
    cancelled: &AtomicBool,
) -> Result<ExpectedTrimOutput, PcmError> {
    if source.len() > MAX_SNAPSHOT_BYTES || output.len() > MAX_SNAPSHOT_BYTES {
        return Err(PcmError::LimitExceeded);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(PcmError::Cancelled);
    }
    let source_layout = inspect_wav_layout(source, cancelled)?;
    let output_layout = inspect_wav_layout(output, cancelled)?;
    if !metadata_matches_trim_source(&source_layout, &output_layout) {
        return Err(pcm_invalid_request("trim output metadata mismatch"));
    }
    let expected_frames = range.frame_count();
    if output_layout.info.frame_count != expected_frames {
        return Err(pcm_invalid_request("trim output frame count mismatch"));
    }
    let align = block_align_bytes(
        output_layout.info.channels,
        output_layout.info.bits_per_sample,
    )?;
    let expected_len = expected_frames
        .checked_mul(align)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| pcm_invalid_request("trim payload length overflow"))?;
    if output_layout.pcm_payload.len() != expected_len {
        return Err(pcm_invalid_request("trim output payload length mismatch"));
    }
    let selected = selected_pcm_slice(&source_layout, range)?;
    if selected != output_layout.pcm_payload.as_slice() {
        return Err(pcm_invalid_request("trim PCM payload mismatch"));
    }
    Ok(ExpectedTrimOutput {
        sample_rate: output_layout.info.sample_rate,
        channels: output_layout.info.channels,
        bits_per_sample: output_layout.info.bits_per_sample,
        frame_count: output_layout.info.frame_count,
    })
}

pub fn trim_wav_integer_pcm(
    source: &[u8],
    range: FrameRange,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, PcmError> {
    if source.len() > MAX_SNAPSHOT_BYTES {
        return Err(PcmError::LimitExceeded);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(PcmError::Cancelled);
    }
    let layout = inspect_wav_layout(source, cancelled)?;
    let trimmed_pcm = selected_pcm_slice(&layout, range)?;
    Ok(encode_integer_wav(
        &layout.fmt_chunk,
        layout.info.sample_rate,
        layout.info.channels,
        layout.info.bits_per_sample,
        trimmed_pcm,
    ))
}

fn encode_integer_wav(
    fmt_chunk: &[u8],
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    pcm_payload: &[u8],
) -> Vec<u8> {
    let block_align = u32::from(channels) * u32::from(bits_per_sample) / 8;
    let data_size = pcm_payload.len();
    let riff_size =
        4usize + 8 + fmt_chunk.len() + fmt_chunk.len() % 2 + 8 + data_size + data_size % 2;
    let mut out = Vec::with_capacity(8 + riff_size);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff_size as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&(fmt_chunk.len() as u32).to_le_bytes());
    out.extend_from_slice(fmt_chunk);
    if fmt_chunk.len() % 2 == 1 {
        out.push(0);
    }
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_size as u32).to_le_bytes());
    out.extend_from_slice(pcm_payload);
    if pcm_payload.len() % 2 == 1 {
        out.push(0);
    }
    let _ = (sample_rate, block_align);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use std::sync::atomic::AtomicBool;

    fn cancelled() -> AtomicBool {
        AtomicBool::new(false)
    }

    #[test]
    fn trim_preserves_pcm_payload_bytes() {
        let wav = test_minimal_wav(100);
        let layout = inspect_wav_layout(&wav, &cancelled()).unwrap();
        let range = FrameRange::new(PcmFrame::new(10), PcmFrame::new(40)).unwrap();
        let trimmed = trim_wav_integer_pcm(&wav, range, &cancelled()).unwrap();
        let out_layout = inspect_wav_layout(&trimmed, &cancelled()).unwrap();
        assert_eq!(out_layout.info.frame_count, 30);
        assert_eq!(out_layout.info.sample_rate, layout.info.sample_rate);
        assert_eq!(out_layout.pcm_payload, layout.pcm_payload[10 * 2..40 * 2]);
        verify_trim_wav_output(&wav, range, &trimmed, &cancelled()).unwrap();
    }

    #[test]
    fn verify_accepts_supported_layout_matrix() {
        for bits in [16_u16, 24] {
            for channels in [1_u16, 2] {
                for rate in [44_100_u32, 48_000] {
                    let wav = test_integer_pcm_wav(bits, channels, rate, 120);
                    let layout = inspect_wav_layout(&wav, &cancelled()).unwrap();
                    let from_start = FrameRange::new(PcmFrame::new(0), PcmFrame::new(40)).unwrap();
                    let middle = FrameRange::new(PcmFrame::new(20), PcmFrame::new(80)).unwrap();
                    let to_end =
                        FrameRange::new(PcmFrame::new(60), PcmFrame::new(layout.info.frame_count))
                            .unwrap();
                    for range in [from_start, middle, to_end] {
                        let trimmed = trim_wav_integer_pcm(&wav, range, &cancelled()).unwrap();
                        verify_trim_wav_output(&wav, range, &trimmed, &cancelled()).unwrap();
                    }
                }
            }
        }
    }

    #[test]
    fn verify_rejects_single_pcm_byte_mutation() {
        let wav = test_minimal_wav(80);
        let range = FrameRange::new(PcmFrame::new(10), PcmFrame::new(50)).unwrap();
        let trimmed = trim_wav_integer_pcm(&wav, range, &cancelled()).unwrap();
        let layout = inspect_wav_layout(&trimmed, &cancelled()).unwrap();
        let mut pcm = layout.pcm_payload.clone();
        pcm[0] ^= 0x01;
        let corrupted = encode_integer_wav(
            &layout.fmt_chunk,
            layout.info.sample_rate,
            layout.info.channels,
            layout.info.bits_per_sample,
            &pcm,
        );
        assert!(verify_trim_wav_output(&wav, range, &corrupted, &cancelled()).is_err());
    }

    #[test]
    fn verify_rejects_metadata_mismatch() {
        let source = test_integer_pcm_wav(16, 1, 44_100, 60);
        let wrong_rate = test_integer_pcm_wav(16, 1, 48_000, 30);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(30)).unwrap();
        assert!(verify_trim_wav_output(&source, range, &wrong_rate, &cancelled()).is_err());
    }

    #[test]
    fn verify_rejects_payload_length_mismatch() {
        let source = test_minimal_wav(50);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(20)).unwrap();
        let mut trimmed = trim_wav_integer_pcm(&source, range, &cancelled()).unwrap();
        trimmed.truncate(trimmed.len() - 4);
        assert!(verify_trim_wav_output(&source, range, &trimmed, &cancelled()).is_err());
    }
}
