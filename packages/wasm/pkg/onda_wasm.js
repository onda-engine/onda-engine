/* @ts-self-types="./onda_wasm.d.ts" */

/**
 * Font-level vertical metrics exposed to JS — distances in pixels at the
 * measured font size. Returned by [`OndaEngine::font_metrics`].
 */
export class FontMetricsJs {
    static __wrap(ptr) {
        const obj = Object.create(FontMetricsJs.prototype);
        obj.__wbg_ptr = ptr;
        FontMetricsJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FontMetricsJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fontmetricsjs_free(ptr, 0);
    }
    /**
     * Distance from node's `y` to the baseline (same as `TextMetrics.ascent`, px).
     * @returns {number}
     */
    get ascent() {
        const ret = wasm.fontmetricsjs_ascent(this.__wbg_ptr);
        return ret;
    }
    /**
     * Height of capital letters (top of caps to baseline, px).
     * @returns {number}
     */
    get cap_height() {
        const ret = wasm.fontmetricsjs_cap_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * Distance from the node's `y` to the top of capital letters (px).
     * @returns {number}
     */
    get cap_top() {
        const ret = wasm.fontmetricsjs_cap_top(this.__wbg_ptr);
        return ret;
    }
    /**
     * Baseline to bottom of the line box (px).
     * @returns {number}
     */
    get descent() {
        const ret = wasm.fontmetricsjs_descent(this.__wbg_ptr);
        return ret;
    }
    /**
     * Baseline-to-baseline line height (px).
     * @returns {number}
     */
    get lineHeight() {
        const ret = wasm.fontmetricsjs_lineHeight(this.__wbg_ptr);
        return ret;
    }
    /**
     * x-height in px (top of 'x' to baseline).
     * @returns {number}
     */
    get x_height() {
        const ret = wasm.fontmetricsjs_x_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * Distance from the node's `y` to the top of lowercase x (px).
     * @returns {number}
     */
    get x_top() {
        const ret = wasm.fontmetricsjs_x_top(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) FontMetricsJs.prototype[Symbol.dispose] = FontMetricsJs.prototype.free;

/**
 * The engine: holds a renderer (with the bundled default font) and rasterizes
 * scene-graph JSON to frames. Construct once and reuse across frames.
 */
export class OndaEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OndaEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ondaengine_free(ptr, 0);
    }
    /**
     * World-space (canvas-coordinate) bounds of every identified node in a scene —
     * the geometry a host's selection overlay needs to put its boxes exactly where
     * the engine drew each element (re-frames, layout, and animation transforms all
     * already applied). Runs the SAME flex-layout pre-pass as `render` so laid-out
     * components report their resolved boxes; skips image decode (bounds use the
     * layout box). Returns a flat `Float64Array`: `[id, x, y, width, height, …]`
     * (one 5-tuple per identified node). Pair with `render` for the same frame.
     * @param {string} scene_json
     * @returns {Float64Array}
     */
    elementBounds(scene_json) {
        const ptr0 = passStringToWasm0(scene_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ondaengine_elementBounds(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * Font-level vertical metrics for `font_size` + optional family/weight/italic.
     * Derived by rasterizing 'H' (cap height) and 'x' (x-height) — pixel-accurate
     * for the actual rendered font. Call once per (size, family, weight) combo, not
     * per frame. Use the returned `capTop`/`capHeight` to vertically center text
     * without empirical guesswork.
     * @param {number} font_size
     * @param {string | null} [family]
     * @param {number | null} [weight]
     * @param {boolean | null} [italic]
     * @returns {FontMetricsJs}
     */
    fontMetrics(font_size, family, weight, italic) {
        var ptr0 = isLikeNone(family) ? 0 : passStringToWasm0(family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.ondaengine_fontMetrics(this.__wbg_ptr, font_size, ptr0, len0, isLikeNone(weight) ? 0xFFFFFF : weight, isLikeNone(italic) ? 0xFFFFFF : italic ? 1 : 0);
        return FontMetricsJs.__wrap(ret);
    }
    /**
     * Kerning-aware glyph layout for `content` at `font_size`. Returns a
     * `Float32Array` with 4 floats per cluster: `[start_byte, end_byte, x, advance]`.
     * Unlike calling `measureText` per character, `advance` includes kern pairs.
     * Slice with stride 4; the total advance sum equals the shaped line width.
     * @param {string} content
     * @param {number} font_size
     * @param {string | null} [family]
     * @param {number | null} [weight]
     * @param {boolean | null} [italic]
     * @param {number | null} [letter_spacing]
     * @returns {Float32Array}
     */
    glyphLayout(content, font_size, family, weight, italic, letter_spacing) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(family) ? 0 : passStringToWasm0(family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.ondaengine_glyphLayout(this.__wbg_ptr, ptr0, len0, font_size, ptr1, len1, isLikeNone(weight) ? 0xFFFFFF : weight, isLikeNone(italic) ? 0xFFFFFF : italic ? 1 : 0, isLikeNone(letter_spacing) ? Number.MAX_SAFE_INTEGER : Math.fround(letter_spacing));
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * Load an additional font (`.ttf`/`.otf` bytes) so text can select it by
     * family (e.g. a brand display face for kinetic typography). Returns the
     * family name(s) it provides, newline-joined. Loaded into BOTH the renderer
     * (which draws the glyphs) and the layout/measurement font context, so
     * author-time `measureText`/`glyphLayout`/`fontMetrics` — and therefore
     * `<TextAnimator>`/`KineticText` glyph placement — match what the engine
     * draws. This is the custom-font parity guarantee: same bytes, same shaping,
     * for measure and render. Mirrors `VelloEngine::load_font`.
     * @param {Uint8Array} data
     * @returns {string}
     */
    loadFont(data) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.ondaengine_loadFont(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Measure `content` at `font_size` (px) with optional family / weight /
     * italic, returning its [`TextMetricsJs`]. The same shaping the engine draws,
     * so a component can size underlines/pills/carets to the real text — in both
     * the browser preview and (warmed once) the Node export path.
     * @param {string} content
     * @param {number} font_size
     * @param {string | null} [family]
     * @param {number | null} [weight]
     * @param {boolean | null} [italic]
     * @param {number | null} [letter_spacing]
     * @returns {TextMetricsJs}
     */
    measureText(content, font_size, family, weight, italic, letter_spacing) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(family) ? 0 : passStringToWasm0(family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.ondaengine_measureText(this.__wbg_ptr, ptr0, len0, font_size, ptr1, len1, isLikeNone(weight) ? 0xFFFFFF : weight, isLikeNone(italic) ? 0xFFFFFF : italic ? 1 : 0, isLikeNone(letter_spacing) ? Number.MAX_SAFE_INTEGER : Math.fround(letter_spacing));
        return TextMetricsJs.__wrap(ret);
    }
    constructor() {
        const ret = wasm.ondaengine_new();
        this.__wbg_ptr = ret;
        OndaEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Render a scene-graph JSON document (onda-scene format) to a frame.
     * Resolves `data:` images and flex layout first (the same pre-passes the
     * CLI runs), so an in-browser preview matches `onda export`.
     * @param {string} scene_json
     * @returns {RenderedFrame}
     */
    render(scene_json) {
        const ptr0 = passStringToWasm0(scene_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ondaengine_render(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return RenderedFrame.__wrap(ret[0]);
    }
    /**
     * Flatten any NLE timeline to the active clip's plain Video at composition
     * `frame`, returning the resolved scene JSON — the same resolution `onda
     * export` runs natively. A preview host calls this BEFORE its video-decode
     * step (to learn which clip + source-time to seek), then decodes and renders.
     * No-op for scenes without a timeline.
     * @param {string} scene_json
     * @param {number} frame
     * @returns {string}
     */
    resolveTimeline(scene_json, frame) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(scene_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.ondaengine_resolveTimeline(this.__wbg_ptr, ptr0, len0, frame);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
}
if (Symbol.dispose) OndaEngine.prototype[Symbol.dispose] = OndaEngine.prototype.free;

/**
 * A rendered frame: RGBA8 pixels plus dimensions.
 */
export class RenderedFrame {
    static __wrap(ptr) {
        const obj = Object.create(RenderedFrame.prototype);
        obj.__wbg_ptr = ptr;
        RenderedFrameFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RenderedFrameFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_renderedframe_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get height() {
        const ret = wasm.renderedframe_height(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Straight-alpha RGBA8 bytes (`width * height * 4`), ready for an
     * `ImageData` and `putImageData`.
     * @returns {Uint8Array}
     */
    get pixels() {
        const ret = wasm.renderedframe_pixels(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.renderedframe_width(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) RenderedFrame.prototype[Symbol.dispose] = RenderedFrame.prototype.free;

/**
 * Rendered text dimensions ([`onda_renderer::TextMetrics`]) for JS — what a
 * component needs to size things to the *actual* text (proportional advance,
 * ascent/descent) instead of a glyph-count guess. Pixels at the measured size.
 */
export class TextMetricsJs {
    static __wrap(ptr) {
        const obj = Object.create(TextMetricsJs.prototype);
        obj.__wbg_ptr = ptr;
        TextMetricsJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TextMetricsJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_textmetricsjs_free(ptr, 0);
    }
    /**
     * Top of the line box to the baseline.
     * @returns {number}
     */
    get ascent() {
        const ret = wasm.textmetricsjs_ascent(this.__wbg_ptr);
        return ret;
    }
    /**
     * Baseline to the bottom of the line box.
     * @returns {number}
     */
    get descent() {
        const ret = wasm.textmetricsjs_descent(this.__wbg_ptr);
        return ret;
    }
    /**
     * Total laid-out height (line height × line count).
     * @returns {number}
     */
    get height() {
        const ret = wasm.textmetricsjs_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * Baseline-to-baseline line height.
     * @returns {number}
     */
    get lineHeight() {
        const ret = wasm.textmetricsjs_lineHeight(this.__wbg_ptr);
        return ret;
    }
    /**
     * Shaped advance width — the true rendered width of the string.
     * @returns {number}
     */
    get width() {
        const ret = wasm.textmetricsjs_width(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) TextMetricsJs.prototype[Symbol.dispose] = TextMetricsJs.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_ef53bc310eb298a0: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./onda_wasm_bg.js": import0,
    };
}

const FontMetricsJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fontmetricsjs_free(ptr, 1));
const OndaEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ondaengine_free(ptr, 1));
const RenderedFrameFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_renderedframe_free(ptr, 1));
const TextMetricsJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_textmetricsjs_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('onda_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
