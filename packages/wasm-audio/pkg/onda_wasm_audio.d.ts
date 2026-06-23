/* tslint:disable */
/* eslint-disable */

/**
 * A decoded audio clip you can sample a per-frame spectrum from.
 */
export class AudioAnalyzer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * BEAT / onset / tempo analysis over `frame_count` frames at `fps`, for syncing
     * motion to the music. Deterministic — identical to the native export.
     */
    beats(fps: number, frame_count: number): Beats;
    /**
     * Clip duration in seconds.
     */
    duration_secs(): number;
    /**
     * Per-frame loudness (RMS) envelope: one `0..≈1` value per frame of a
     * `frame_count` timeline at `fps` — for level meters, ducking under a
     * voiceover, and loudness-reactive motion. Deterministic — identical to the
     * native export.
     */
    loudness(fps: number, frame_count: number): Float32Array;
    /**
     * Decode audio `bytes` (a fetched file / `Uint8Array`). `ext_hint` is the
     * file extension (`"mp3"`, `"wav"`, …) to aid format detection — `""` is fine
     * (content probing still runs). Throws if the bytes aren't decodable audio.
     */
    constructor(bytes: Uint8Array, ext_hint: string);
    /**
     * Decoded sample rate (Hz).
     */
    sample_rate(): number;
    /**
     * Per-frame spectrum: a flat, frame-major `Float32Array` of length
     * `frame_count * bands`, each value `0..1` (low→high). `fps` maps a frame
     * index to its time. Deterministic — identical to the native export.
     */
    spectrogram(fps: number, frame_count: number, bands: number): Float32Array;
}

/**
 * Beat / onset / tempo analysis of a clip, all in VIDEO-FRAME units. Returned by
 * [`AudioAnalyzer::beats`]; read `tempo` + the typed arrays from JS.
 */
export class Beats {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Frame indices on the beat grid (`Uint32Array`).
     */
    readonly beats: Uint32Array;
    /**
     * Per-frame onset strength `0..1`, one value per frame (`Float32Array`).
     */
    readonly onsetEnv: Float32Array;
    /**
     * Frame indices of picked onsets — any transient (`Uint32Array`).
     */
    readonly onsets: Uint32Array;
    /**
     * Estimated tempo in beats per minute (0 if undetectable).
     */
    readonly tempo: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_audioanalyzer_free: (a: number, b: number) => void;
    readonly __wbg_beats_free: (a: number, b: number) => void;
    readonly audioanalyzer_beats: (a: number, b: number, c: number) => number;
    readonly audioanalyzer_duration_secs: (a: number) => number;
    readonly audioanalyzer_loudness: (a: number, b: number, c: number) => [number, number];
    readonly audioanalyzer_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly audioanalyzer_sample_rate: (a: number) => number;
    readonly audioanalyzer_spectrogram: (a: number, b: number, c: number, d: number) => [number, number];
    readonly beats_beats: (a: number) => [number, number];
    readonly beats_onsetEnv: (a: number) => [number, number];
    readonly beats_onsets: (a: number) => [number, number];
    readonly beats_tempo: (a: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
