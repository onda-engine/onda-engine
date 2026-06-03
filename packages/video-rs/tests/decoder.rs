//! Frame-accuracy regression test for the sequential `VideoDecoder`.
//!
//! Generates a synthetic clip whose content is known PER SECOND — solid red
//! (0-1s), green (1-2s), blue (2-3s) — so we can assert the decoder returns the
//! RIGHT source frame for a requested time (not a neighbouring keyframe), advances
//! correctly across a monotonic export, and serves a repeated time from cache.
//!
//! Needs `ffmpeg` on PATH; skips cleanly otherwise (the rest of the suite is
//! ffmpeg-free). Asserts the dominant colour channel so it's robust to the yuv420
//! round-trip rather than depending on an exact codec/version.

use std::process::Command;

use onda_scene::{Composition, ImageData, Node, NodeKind, Scene, Video};
use onda_video::VideoDecoder;

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// A 3-second 10fps clip: 1s each of red, green, blue. Returns its path.
fn make_rgb_clip() -> Option<std::path::PathBuf> {
    let path = std::env::temp_dir().join("onda_decoder_test_rgb.mp4");
    let ok = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x36:r=10:d=1",
            "-f",
            "lavfi",
            "-i",
            "color=c=lime:s=64x36:r=10:d=1",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x36:r=10:d=1",
            "-filter_complex",
            "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
            "-map",
            "[v]",
            "-r",
            "10",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    ok.then_some(path)
}

/// The dominant channel ('r'/'g'/'b') of the clip's centre pixel after decode.
fn dominant_center(data: &ImageData) -> char {
    let (w, h) = (data.width as usize, data.height as usize);
    let i = ((h / 2) * w + w / 2) * 4;
    let (r, g, b) = (
        data.rgba[i] as i32,
        data.rgba[i + 1] as i32,
        data.rgba[i + 2] as i32,
    );
    if r >= g && r >= b {
        'r'
    } else if g >= r && g >= b {
        'g'
    } else {
        'b'
    }
}

/// Decode the frame the `VideoDecoder` resolves for `src` at `time` (10fps comp).
fn frame_dominant(decoder: &mut VideoDecoder, src: &str, time: f32) -> char {
    let scene = Scene::new(Composition::new(64, 36, 10.0, 1))
        .with_root(Node::group().with_child(Node::new(NodeKind::Video(Video::new(src).at(time)))));
    let resolved = decoder.resolve_scene(&scene).expect("resolve video frame");
    let video_node = &resolved.root.children[0];
    let NodeKind::Video(v) = &video_node.kind else {
        panic!("expected a video node");
    };
    dominant_center(v.data.as_ref().expect("frame decoded"))
}

#[test]
fn sequential_decode_is_frame_accurate() {
    if !ffmpeg_available() {
        eprintln!("skipping: ffmpeg not on PATH");
        return;
    }
    let Some(clip) = make_rgb_clip() else {
        eprintln!("skipping: could not generate the test clip");
        return;
    };
    let src = clip.to_str().unwrap();
    let mut decoder = VideoDecoder::new();

    // Monotonic export order: mid-second of each colour band → red, green, blue.
    assert_eq!(
        frame_dominant(&mut decoder, src, 0.5),
        'r',
        "0.5s should be red"
    );
    assert_eq!(
        frame_dominant(&mut decoder, src, 1.5),
        'g',
        "1.5s should be green"
    );
    assert_eq!(
        frame_dominant(&mut decoder, src, 2.5),
        'b',
        "2.5s should be blue"
    );

    // A repeated time is served from cache — same colour, no desync.
    assert_eq!(
        frame_dominant(&mut decoder, src, 2.5),
        'b',
        "repeat of 2.5s still blue"
    );

    let _ = std::fs::remove_file(&clip);
}
