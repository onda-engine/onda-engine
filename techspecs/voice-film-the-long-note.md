# THE LONG NOTE — treatment & build spec

An ~8–9 min ElevenLabs-style kinetic-typography film on the human voice. Soft dark gradient-field world; words-on-screen as narration; music composed to the cut later. Buildable in ONDA only (kinetic type, animated fBm/mesh gradients, grain, light-wrap, vignette, frame-accurate beats — no 3D/particles/DOF). Generated via the voice-film-treatment workflow (4 spines → judged → synthesized); THE LONG NOTE (single-life spine) won on narrative engine + sustainability.

## Logline

A single human voice traced across one life — cry, first word, a name called across a playground, a vow, a lullaby, a voicemail kept too long, a last word — until the screen turns the thread back on the one watching: you have been speaking this whole time, and somewhere, someone is still keeping the sound of you.

## Thesis

The human voice is not how we are heard — it is how we are kept. Before it carries meaning it carries proof: here, I'm here. It is the first instrument we play and the last we set down, and it does not belong to us so much as to the people who held it. A life is one long held note, passed from the body that made it into the memory of those who heard it. The film never says "find your voice." It says: your voice already found everyone who matters, and they are still listening.

## Visual system

A single soft dark gradient-field world, unbroken from first frame to last — never a cut to "a new scene," only one room slowly changing temperature. The base is a MeshGradient of 2-3 blobs (deep blue-violet → amber → rose, per chapter) drifting at speed ~0.15 over a near-black background (#08070C), opacity ~0.45, so it reads as a dark room breathing rather than a graphic. Over it, a GradientShift whisper-drift (from/to near-identical, speed 0.04°/frame ≈ a 90s rotation) gives the field its slow tidal angle. A persistent GrainOverlay (opacity 0.06, baseFrequency 0.9, animate:true every 2 frames, seed=round(frame)) sits on top of EVERYTHING as the last layer — it unifies type and field under one film texture and, critically, keeps the dark holds alive (the grain is always shimmering, so a near-black frame still reads as "on," never a buffer). A Vignette (transparent center → #000 edge) deepens negative space and pulls the eye to the one word. Reactive light is Spotlight (softness ~80, radius scaled to the moment) blooming behind or off-axis from the type — one soft pulse per emotional beat, never a constant glow. Light-wrap (the warm halo bleeding from the spotlight around the type's edges) is export-only finishing, tuned from the MP4. The field is the protagonist's room: warm and intimate in the middle of the life, drained to a cold near-monochrome at the grief turn, rekindled to a living amber-gold at the reclamation, and landing on the exact open-frame composition — but warm now where it began cold. Negative space is a dial, not a constant: vast void above a whisper-small word for vulnerability (Ch1, Ch6, Ch8); the frame closing in, the word growing, for intimacy and presence (Ch4, Ch7); a brief soft-layered crowd of names for the one density spike (Ch3). No 3D, no particles, no depth-of-field — "soft focus" is always BlurReveal's type-opacity/sigma focus-pull (fromBlur 10→0), never a lens.

## Type system

One face, one voice on screen: a warm humanist serif for the entire film (Source Serif 4 / Newsreader family, loaded via the wasm font path — humanist serif = a human speaking, not a UI). Three weights only: Light (300) for the whisper lines and the fragile/grief beats; Regular (400) for the body of the narration; a single step to Medium (500) reserved for the rare load-bearing word ("here.", "Yours" energy, "This was your voice."). Never bold, never a display grotesque — this film is spoken, not announced. Scale is a 4-tier dynamic range used expressively: whisper (~34px in a 1080 frame) for the open/close and the void beats; reading (~56px) for the bulk; presence (~88px) when the frame closes in (the vow, "someone is keeping yours"); and one near-full-bleed moment per act for a single word ("You said it."). Letter-spacing opens a touch (+0.5 to +1.5%) on the smallest lines as if the words are spoken slowly. Lines ENTER almost exclusively by BlurReveal — a soft→sharp focus-pull (fromBlur 10, travelPx 8-12, 18-22 frame settle), as if a sound is settling into a shape; this is the film's signature reveal. They HOLD 4-8s, each hold carrying real micro-motion (1-1.5% breathing scale, a 1-2px tracking creep, the gradient drifting under them) so a held word is alive, never frozen. They LEAVE by a slow fade on the exhale of the breath cadence (TextFadeReplace / FadeOut, 18-24 frames), one line dissolving as the next settles — never a hard cut between lines. The ONE deliberate exception, the grafted "Theft/Theirs" pattern-interrupt at the turn (Ch6, the kept voicemail): the type abandons the soft focus-pull and switches to KineticText snap-in — rigid per-glyph entrance (preset 'fade', stagger 2, short duration), locked to a hard grid with NO breathing scale, held a fraction too long. The only hard kinetic in the piece. It makes the hinge from a living voice to a recording felt structurally, not just stated — the type goes cold and mechanical exactly where the voice becomes a recording.

## Color palette

- #08070C — base near-black (the dark room; the field background, present every frame)
- #0E1226 — cold open / Ch1 deep blue-violet (4am dark, the field before warmth)
- #1A1530 — Ch5 nocturnal blue (the lullaby, the nursery night, the loop's first echo)
- #0B0C12 — Ch6 drained cold grey-black (the grief floor; the coldest, near-monochrome state, warmth fully gone)
- #3A2A1E — warm amber field-blob (the life's warmth; Ch2 edges → Ch3 → Ch7 rekindle)
- #4A2630 — Ch4 rose-amber, the warmest blob (the vow, candlelight close)
- #C9A26B — amber-gold reactive light / Spotlight bloom (the 'here' pulse, the warm halo, the dawn of Ch7)
- #7C8AA6 — cold grey-blue type & still waveform (Ch6 only; the recording, the voice rendered visible then flatlined)
- #EDE6DA — warm off-white type (the spoken word; never pure #FFFFFF — bone-white so it sits in the film, not on it)
- #9A8E7E — muted warm grey type (the quiet/secondary lines, the small signature)

## Motion principles

- BREATH IS THE CLOCK. The entire film is timed to an implied resting-breath cadence (~4s in / out, ~15 breaths per held minute). Type fades up on an inhale and settles on an exhale; gradient blobs and breathing-scale ride the same wave. Cuts and reveals land ON the breath, never on a grid — the felt tempo is reveal-speed and density, not cut-rate.
- MICRO-MOTION ON EVERY HOLD — NOTHING IS EVER FROZEN. Every held line carries a 1-1.5% breathing scale, a 1-2px tracking creep, and the gradient drifting beneath it. A still frame is a dead frame; the meditative pace survives only because the surface is always alive.
- ONE SLOW CONTINUOUS FIELD, NEVER A SCENE CUT. The MeshGradient + GradientShift drift unbroken from frame 1 to 14,400. Chapters change by HUE TRANSITION (the longest is the Ch6→Ch7 cold-grey→amber dawn), never by a hard scene cut. The film is one room, slowly turning.
- REVEAL BY FOCUS-PULL, NOT BY SLIDE. The signature entrance is BlurReveal's soft→sharp (a sound settling into a shape). Avoid slides, wipes, spins — they read as UI. The type arrives the way a word arrives in the dark: out of blur, into clarity.
- NEGATIVE SPACE IS A SLIDER. Vast void above a tiny word = vulnerability (open, voicemail, close). Frame closing in, word growing = intimacy/presence (vow, reclamation). The ONE density spike (the playground crowd) is the pattern-break that makes the surrounding stillness read as chosen.
- ONE REACTIVE LIGHT PER BEAT, THEN RECEDE. Spotlight blooms once on the load-bearing word (a heartbeat of warmth), then withdraws. For the playground (grafted call-and-response), a second light answers the first slightly offset — a relationship, not a crowd. Light is punctuation, never wallpaper.
- BUILD BY SUBTRACTION, NOT ADDITION. The peak (Ch7) lands because Ch6 stripped everything — the cello-spine literally absent, the field drained. Climax = the warmth and the full theme RETURNING after a real silence, not getting louder.
- THE ONE HARD KINETIC IS THE HINGE. The whole film breathes soft; the single rigid, mechanical snap-in (Ch6 voicemail) is reserved for the turn from living voice to recording. Tonal hardness used exactly once, as a structural event.
- THE FILM CLOSES ITS OWN LOOP. Ch8's final composition is a literal pixel-rhyme of Ch1's open — same word-scale, same vast frame, same heartbeat-pulse of light — warm where it was cold. 80 years of a life felt as one held breath.

## Music arc

No audio file exists yet; the film is cut to an IMPLIED tempo (resting breath, ~one phrase per 4s exhale) and the score is composed LATER, TO the chapter boundaries — never licensed flat. The contract is strict cumulative form (the grafted non-negotiable). A single low cello note opens as the film's spine — almost subaudible, room tone around it, one soft heartbeat-pulse under "here." In Ch2 a three-note piano figure is seeded — the "naming" motif (a child's first word). Ch3 multiplies the piano into a warm cluster with footstep-like percussion (distance, not a beat) and the film's first dynamic crest, pulling back to one sustained note. Ch4 slows the naming motif almost to a standstill in the lowest register — the same three notes, now a vow — over one warm chord and a single violin. Ch5 introduces a wordless human vocal pad, low and maternal — the lullaby, the motif rocking. Ch6 is THE STOPDOWN: total silence for the 4s dark hold (only the thinning room tone), then a single far piano note with long decay and NO cello underneath — the absence of the spine IS the grief; the motif degrades, played as if from the recording, and does not resolve. Ch7 returns the cello spine under the first line and builds cumulatively — naming + lullaby + vow fragments finally assembling into the COMPLETE theme for the only time, the wordless voice now a small low choir: the single peak, built by addition after subtraction. Ch8 subtracts to one sustained cello note — "the long note, still going" literally does not stop, carrying under the final lines — decaying to the opening heartbeat-pulse and room tone, then nothing. The score exhales; it does not button. Tempo map (added with the music): largo throughout (~50bpm implied), one accelerando-by-density at Ch3, the full stop at Ch6, the only true swell at Ch7. The whole piece is cut breath-by-breath to this implied track; when the real score arrives it is composed to these exact boundaries.

## Chapter map (full script)


### 1. Before The Word — [0–58s] (58s)
**Beat:** Cold open on the first sound a human makes — not language, just proof of life. We establish the rule of the film without stating it: this dark field is listening, and a voice is arriving into it. No 'about the voice' framing; we begin at the beginning of a voice.

**Script:**
> Before your name.
> Before a single word you'd keep.
> There was a sound you made
> that meant only:
> here.
> I'm here.

*Visual:* Near-black (#08070C) with a deep blue-violet MeshGradient (#0E1226) breathing almost imperceptibly — a dark room at 4am. The first 6s: only field and grain, we make the viewer wait. Then a whisper-small line fades up dead-center, no larger than a whisper would be if you could see it. Warm bone-white serif (#EDE6DA), Light. On 'here. I'm here.' a single soft amber Spotlight (#C9A26B, softness 80) blooms once behind the words and recedes — the only brightness for a full minute.
*Motion:* Type by BlurReveal (fromBlur 10→0, travelPx 8, 22-frame settle) — sound settling into shape. Holds 5-7s, 1% breathing scale. Lines leave on a slow exhale fade. Vast negative space; word tiny in a huge frame. The Spotlight pulse is one heartbeat, ease-in-out, ~24 frames up, ~36 down.
*Audio:* A single sustained low cello note, almost subaudible, with room tone. One soft heartbeat-like pulse under 'here.' No melody yet — a held breath of a chord that becomes the spine. Silence around every line is the loudest element.

### 2. The First Word — [58–128s] (70s)
**Beat:** The voice discovers it can hold the world in its mouth — the miracle of the first word, naming. We move from proof-of-existence to the dawn of meaning. Tender, small, slightly playful: sound can reach across a room and bring a person to you.

**Script:**
> Then one day the sound had edges.
> A shape your mouth had been practicing in the dark.
> You said it.
> And across the room,
> someone you loved
> turned around.

*Visual:* Gradient warms a few degrees — an amber blob (#3A2A1E) wells in at the edges, the first hue-shift, a turned page. Words arrive as the mouth finds the shape in real time. On 'You said it.' the word is briefly the largest thing yet (presence scale). On 'turned around' the type drifts a few px toward frame-right, pulled by an unseen listener, and a faint warm Spotlight wells up off-axis (x 0.72) — the someone, never shown, only implied as glow. Negative space still vast.
*Motion:* BlurReveal entrances, slightly quicker stagger than Ch1 (the voice gaining confidence). The 'turned around' drift is a slow 6px ease toward the off-axis light over ~30 frames. Breathing scale 1.2%. GradientShift continues its whisper-rotation underneath.
*Audio:* The cello is joined by a single soft high piano note, like a child's vowel — a three-note upward figure, the 'naming' motif, seeded here and never completed until Ch7. Warmth, not sweetness. One soft inhale before 'You said it.'

### 3. Across The Playground — [128–205s] (77s)
**Beat:** The voice goes out into the world and the world calls it back — a name shouted across a playground, across years. The voice as the thing that summons and is summoned. The film's one density spike: many voices, the social life of sound. Widens from one mouth to all the mouths that ever said your name.

**Script:**
> Your name, thrown across a playground.
> Your name, in a voice that has since changed.
> Everyone who ever called you
> was making the same small bet:
> that you would answer.

*Visual:* The pattern-break: for ~8s the screen fills with overlapping faint names and words at varied scales and soft-blur layers (still type-on-gradient, never chaotic — a crowd of distant calls). Gradient shifts to a brighter dusty gold afternoon. Then it collapses back to a single line for 'that you would answer' — return to intimacy. A second Spotlight answers the first slightly offset (grafted call-and-response) so the many mouths read as a relationship, not a mob.
*Motion:* The most dynamic motion in the film: words rush in from edges, a deliberate tempo surge (density doing the acceleration, not cut-rate), crested on the repeated 'Your name,' then a hard settle to one sustained line. The crowd words are at 30-50% opacity, soft-blurred; exactly ONE line is ever in focus. The two answering lights are offset ~10 frames.
*Audio:* Tempo lifts. The piano motif multiplies into a small warm cluster; light percussion that feels like footsteps and distance, not a beat. A swell that crests on 'your name' and pulls back to a single sustained note under 'that you would answer.' First real dynamic peak.

### 4. The Vow — [205–278s] (73s)
**Beat:** The voice does the heaviest thing a voice can do — it promises. The chapter where the voice stops only receiving the world and starts binding itself to it. We slow hard; this is the warm, still center of the life. Love rendered as the act of speaking a sentence you cannot take back.

**Script:**
> Some words you only get to mean once.
> You said them quietly.
> Not to be heard by a room —
> to be heard by one person,
> for the rest of a life.

*Visual:* Stillness as a held breath. Gradient deepens to the warmest in the film — rose-amber (#4A2630), candlelight. A single line at a time, held long (5-7s), each full of micro-motion. On 'to be heard by one person,' the frame closes in — the word grows to presence scale, negative space contracts, the most intimate composition yet. A soft warm light-wrap haloes the type for the first time (export-only finish), like being close to someone.
*Motion:* The slowest cadence so far. Reveals soften (BlurReveal, longer settle). The frame-close on 'one person' is a slow Spotlight radius shrink + the word scaling up ~12% over ~40 frames — the room contracting around a sentence. Breathing scale held to 1% so the stillness reads as held breath, not freeze. Gradient drifts like candlelight.
*Audio:* Near-silence with one warm low chord and a single sustained violin. The naming motif returns slowed almost to a standstill, lowest register — the same three notes that were a child's word, now a vow. Spacious. Breath audible in the room tone.

### 5. The Lullaby — [278–348s] (70s)
**Beat:** The voice becomes the thing it once needed — it sings someone else to sleep. The cry from Ch1 is now the cry your voice answers: the voice as inheritance. Tender, hushed, with the first faint undertone of mortality — to comfort a new life is to feel the edge of your own.

**Script:**
> Then there was a smaller sound in the house.
> The same arriving cry you once were.
> And without deciding to,
> your voice did the oldest thing it knows —
> it lowered, and it stayed,
> until the breathing slowed.

*Visual:* Gradient cools from rose toward deep nocturnal blue (#1A1530) — night, a nursery. We deliberately echo Ch1's composition (small word, vast dark frame) so the viewer subconsciously feels the loop: the cry returns. One faint warm light low in frame, like a hallway lamp left on. This is the loop's first quiet echo, setting up Ch8.
*Motion:* Type breathes in long, slow exhale-timed reveals — words fade up on an inhale and settle on an exhale, the slowest cadence in the film. The breathing scale visibly slows across the chapter toward 'until the breathing slowed,' where the micro-motion nearly stills on the last word (but grain keeps it alive). One low warm Spotlight, very soft, never pulsing — held.
*Audio:* The barest hum — a wordless vocal pad enters for the first time, a human voice as texture, low and maternal. The naming motif played as a lullaby, rocking. Sparse. A child's slow breathing folded into the room tone, almost not there.

### 6. The Message You Kept — [348–418s] (70s)
**Beat:** The turn. The false bottom. A voice is gone — and what remains is a voicemail no one can bring themselves to delete. The grief chapter, the ~75% stopdown. The voice we have followed is, for the first time, only a recording — present and absent at once. Held in silence. (Grafted: the restitution reframe is seeded here and paid off in Ch7 — not a new voice, hers, in its own grain.)

**Script:**
> There is a message you have not deleted.
> You know exactly how long it is.
> Forty-one seconds of a voice
> that doesn't exist anywhere else now.
> You don't play it.
> You just keep it where you can reach it.

*Visual:* The full stopdown: at chapter open, a hard transition to pure dark drained field (#0B0C12) — no type, no light — held an uncomfortable ~3-3.5s (shortened from 4s, with faint animated grain + a drifting gradient + one shaking recorded exhale kept alive so autoplay reads it as intentional, not a buffer). Then the smallest type since the open, in cold grey-blue (#7C8AA6). No warmth anywhere. On 'Forty-one seconds,' an AudioVisualizer (type 'waveform', cold grey-blue) draws itself across the dark and then FLATLINES to a still line — a voice rendered visible, then held, not playing. Negative space total.
*Motion:* THE ONE HARD KINETIC (grafted 'Theft' mechanic): type abandons the soft focus-pull for KineticText snap-in — rigid per-glyph (preset 'fade', stagger 2, short duration), locked to a hard grid, NO breathing scale, held a fraction too long. Cold and mechanical exactly as the living voice becomes a recording. The waveform draws over ~40 frames then flatlines and holds dead-still.
*Audio:* THE STOPDOWN — total silence for the dark hold, only thinning room tone and one shaking exhale. Then a single piano note very far away, long decay, NO chord underneath for most of the chapter — the absence of the cello-spine IS the grief. One held, unresolved interval. The motif degrades, as if from the recording.

### 7. What A Voice Is For — [418–488s] (70s)
**Beat:** Reclamation — but not the dead voice coming back. The reclamation is the realization: the voice was never only theirs; it survived by being kept. The film withholds its thesis until here and earns the line. (Grafted restitution + 'folded in' + cumulative-form peak.) The cello-spine returns, warmth comes back, the music assembles the complete theme for the only time.

**Script:**
> A voice was never only the air it moved.
> It was the people who kept the sound of you —
> not a new voice. Hers. In its own grain.
> You are still carrying voices that stopped years ago,
> holding the note under yours.
> And somewhere, right now,
> someone is keeping yours.

*Visual:* Warmth floods back, slowly — the field rekindles from cold grey (#0B0C12) toward living amber-gold (#C9A26B glow over #3A2A1E), the longest hue-transition in the film, dawn arriving in a room. The flatlined waveform from Ch6 reanimates — the still line begins to move again, gently, and resolves into soft light. Type grows in confidence and scale; reveals are warm and sure, the soft focus-pull restored. Light-wrap returns. On 'someone is keeping yours,' the type fills the frame with full presence and a sustained warm bloom behind it.
*Motion:* The build by addition. Reveals return to BlurReveal soft focus-pull, now confident (shorter blur, fuller scale). The waveform-to-light transition is a ~60-frame morph from a moving line into a soft Spotlight bloom. The grade warms across the whole chapter. 'someone is keeping yours' is the first full-presence type with sustained (not pulsed) warm light behind it.
*Audio:* The cello spine returns under the first line and the whole arrangement builds cumulatively — naming, lullaby, vow fragments finally assembling into the complete theme for the only time, the wordless voice now a small low choir. The single emotional peak, built by addition after the subtraction.

### 8. You — [488–542s] (54s)
**Beat:** The pivot onto the viewer, then the quiet landing — the 'right before the credits roll' close. We reveal the whole life we traced was a frame for the second person: this was you, it has been you the entire time. Then the film breathes out and ends on near-silence; the signature arrives last and small.

**Script:**
> This was your voice.
> From the first sound you made to the one you'll make last,
> one long note, still going.
> Say something to someone today.
> Let it be a sound they keep.

*Visual:* After the peak, full subtraction — the orchestra falls to one note, the frame opens back to vast negative space, the word small and warm and alone, exactly mirroring Ch1 so the film closes its loop (a literal pixel-rhyme of the open, warm where it was cold). 'This was your voice.' held long in stillness. Closing lines fade up one breath at a time. The field settles to the deep warm dark of the open. After a long held empty beat, a small signature line fades in low — 'The Human Voice' (and last/smallest, the brand mark) — like end credits, held quiet, then a slow fade to black on a final soft heartbeat-pulse of light, echoing Ch1's 'here.'
*Motion:* Subtraction back to the open's composition. Breathing scale returns to 1%. The closing lines fade up/out on the breath cadence. The final heartbeat-pulse of Spotlight light is the exact pulse from Ch1 — same easing, same softness, now warm (#C9A26B) — the loop literally closed. No logo slam; the signature is a whisper in the dark after the breath.
*Audio:* Subtraction to a single sustained cello note — the long note of the title, finally named. On 'one long note, still going' the note literally does not stop; it carries under the final lines. The last sound is one soft low heartbeat-pulse from the very first frame, then room tone, then nothing. Silence is the final beat. The signature arrives over near-silence.

## Opening storyboard — THE PILOT (first ~75s, build this first)


**[0–6s]** — type: (none)
- screen: Nothing but the dark field and grain. No type. We make the viewer wait — the room is listening before anyone speaks.
- motion: The MeshGradient breathes imperceptibly (speed ~0.15); a GradientShift whisper-rotates the angle ~0.04°/frame. The animated GrainOverlay shimmers (re-seed every 2 frames) so the black is unmistakably alive. A faint vignette settles the edges. No camera move — only the field's tidal drift.
- color: Deep blue-violet mesh (#0E1226) over near-black (#08070C), at its dimmest — a dark room at 4am. No warmth anywhere yet.

**[6–13s]** — type: “Before your name.”
- screen: A whisper-small line fades up dead-center, no larger than a whisper would be if you could see it. Warm bone-white serif, Light weight, vast void around it.
- motion: BlurReveal: the line resolves out of a 10px blur into focus over ~22 frames (fromBlur 10→0, travelPx 8 rise), as if a sound is settling into a shape. Holds with a 1% breathing scale. The field keeps drifting beneath it.
- color: Field unchanged (deep blue-violet, dimmest). Type warm off-white #EDE6DA — the first warm thing, but tiny.

**[13–21s]** — type: “Before a single word you'd keep.”
- screen: The first line dissolves on an exhale as the second settles in its place — same whisper scale, same center, same void.
- motion: First line fades out (~20 frames) as the second BlurReveals in, overlapping by a beat — never a hard cut between lines. Breathing scale 1%, a 1px tracking creep. The implied breath cadence is now established: in on the inhale, out on the exhale.
- color: Field unchanged. Type #EDE6DA.

**[21–30s]** — type: “There was a sound you made”
- screen: The third line settles — slightly more present, the sentence reaching toward its point.
- motion: BlurReveal in, held ~6s. A barely-perceptible scale-up (whisper→just-above-whisper) signals the line is building toward something. The gradient warms by a single degree at the lower edge — the very first hint of the amber to come, almost subliminal.
- color: Field still deep blue-violet, but a 1-degree warm bloom begins low in the frame (the amber blob #3A2A1E at ~10% — felt, not seen).

**[30–36s]** — type: “that meant only:”
- screen: A two-word line, held alone with a colon — the sentence opening to deliver its meaning. Then it holds in anticipation.
- motion: BlurReveal in, then an unusually long, still hold (~4s) on the colon — the film inhaling before the reveal. Breathing scale drops near-still; grain keeps it alive. This is the setup beat for the first emotional word.
- color: Field unchanged; the low warm bloom holds at ~10%. Type #EDE6DA.

**[36–44s]** — type: “here.”
- screen: The single word 'here.' — alone, dead-center, the smallest sharp thing in a huge dark field. A single soft warm light blooms once behind it, then recedes.
- motion: BlurReveal in, and on the settle a single soft amber Spotlight pulse blooms behind the word — ~24 frames up, ~36 frames down, one heartbeat of warmth — the only brightness for the whole minute. The word holds ~5s, breathing 1%, then the light fully recedes before the word fades.
- color: The amber Spotlight (#C9A26B, softness 80) blooms behind 'here.' against the deep blue-violet field — the first true warmth, and it's a heartbeat, not a glow. Type lifts to Medium weight (500) for this one word.

**[44–52s]** — type: “I'm here.”
- screen: The answer to 'here.' — 'I'm here.' settles where 'here.' was, completing the first human statement of the film. The field returns to dark stillness.
- motion: TextFadeReplace: 'here.' dissolves as 'I'm here.' settles in the same spot, the light already receded so the words are alone again in the dark. Held ~6s, breathing 1%. The film's first complete thought lands and is left to ring in silence.
- color: Field back to deep blue-violet dimness (the heartbeat of warmth gone). Type #EDE6DA, Medium on this beat.

**[52–58s]** — type: (none)
- screen: The frame empties to field and grain for a held beat — Ch1 exhaling — as the gradient begins, almost imperceptibly, to warm toward the first word's amber.
- motion: No type. The MeshGradient's amber blob rises from ~10% toward ~25% over these 6s — the longest single move so far, a page turning by temperature alone. The breath cadence holds; grain shimmers. This is the bridge into Ch2.
- color: Deep blue-violet warming at the edges toward amber (#3A2A1E rising) — the room beginning to turn warm. The hue-transition that signals the chapter change without a cut.

**[58–66s]** — type: “Then one day the sound had edges.”
- screen: Ch2 opens. A line settles, warmer-edged now, the voice gaining a half-step of confidence as it discovers the word has a shape.
- motion: BlurReveal in, slightly quicker stagger than Ch1 (the voice steadying). Held ~6s, breathing 1.2%. The amber blob now warms the frame edges; the field is no longer purely cold. The first piano note of the naming motif is implied to land here on the settle.
- color: Deep blue-violet center with warm amber (#3A2A1E) now clearly at the edges — the first visible warmth in the field, not just a Spotlight. Type #EDE6DA.

**[66–75s]** — type: “A shape your mouth had been practicing in the dark.”
- screen: The longest line yet, settling at reading scale — the mouth practicing in the dark. The pilot ends here, on the line that hands us into the body of the life: the voice is about to be used for the first time.
- motion: BlurReveal in at reading scale (~56px), the most present type the pilot has shown. Held ~6s with a 1.5% breathing scale and a slow 2px tracking creep — alive, leaning forward. The field continues its slow amber warming beneath. The pilot lands on this held, warm, breathing line — proof the world is established and the life is about to be spoken.
- color: Warm amber edges (#3A2A1E ~25%) framing the deep blue-violet center — the room half-turned to warmth. Type #EDE6DA at reading scale. The grade reads its first genuine warmth here (export-only light-wrap beginning to bloom).

## Pilot scope

The pilot is the first ~75 seconds: all of Chapter 1 ("Before The Word," 0-58s) plus the opening two lines of Chapter 2 ("The First Word," to ~75s) — the full opening storyboard above, frame-accurate. It PROVES the entire film's hardest, most load-bearing claims in miniature: (1) the soft dark gradient-field world reads as a breathing room, not a graphic — MeshGradient + GradientShift + animated GrainOverlay + Vignette holding a near-black frame ALIVE through the 6s opening wait; (2) the signature type system — warm humanist serif, BlurReveal focus-pull, whisper→reading scale, breath-cadence enter/hold/leave with real micro-motion on every hold; (3) the single reactive-light heartbeat (Spotlight bloom on 'here.') as the only brightness, proving restraint; (4) the chapter-change-by-hue-transition (no cut) at 52-66s, the cold→warm page-turn that the whole film runs on; (5) the implied-tempo cut — everything timed to breath with NO audio file, so the music can be composed to these exact boundaries later. If the pilot is beautiful and restrained — if the 6s of dark, the whisper word, and the single amber pulse on 'here.' make someone lean in — then ONDA has proven it can make ElevenLabs-tier story video, and the remaining 7 chapters are the same vocabulary at different temperatures. The pilot is the proof; it ships first, judged from the exported MP4.

## Production notes

- PRIME DIRECTIVE — export native, judge the MP4. The live WebGPU preview flickers and degrades (per-frame GPU readback, async RTT material misses, no live motion blur, light-wrap/halation degrade). The hero deliverable is the EXPORTED video (native Vello, full materials, deterministic, motion-blur 8 / 180-degree shutter), played as a <video>. Author for export; tune every subtle finish (light-wrap, the grade warmth, the Ch6 stopdown) from exported frames, NEVER from a live Split.
- MUSIC IS LATER — cut to an implied tempo NOW. There is no audio file. The whole film is cut to a resting-breath cadence (~one phrase per 4s exhale, largo ~50bpm). The score is composed TO the chapter boundaries afterward (strict cumulative form: seed the naming/cello kernel early, degrade it through Ch6, complete the full theme ONCE at Ch7). 'Composed to the boundaries, never licensed flat' is an explicit deliverable — a generic ambient bed would collapse the architecture. The implied-tempo cut means the boundaries are already locked; the composer fills them.
- THE GRADIENT FIELD is MeshGradient (2-3 blobs, speed ~0.15, opacity ~0.45) over a near-black background, plus a GradientShift whisper-drift (from/to near-identical, speed ~0.04 deg/frame). One continuous field across all 14,400 frames — chapters change by HUE TRANSITION, never a scene cut. fBm is the texture engine: animate time so the field is wispy and alive (Stripe/Linear register), never a flat fill.
- GRAIN over EVERYTHING as the last layer: GrainOverlay opacity ~0.06, baseFrequency 0.9, numOctaves 1, animate:true, animateEvery 2, seed=round(frame). It unifies type + field under one film texture AND keeps every dark hold reading as 'on' (the Ch6 stopdown and the Ch1 6s wait survive ONLY because the grain is always shimmering — this is the anti-buffer/anti-glitch safeguard, grafted from THE_LONG_QUIET's 'alive on purpose' note).
- LIGHT-WRAP & SPOTLIGHT are punctuation, not wallpaper. Spotlight (softness ~80) blooms ONCE per emotional beat (the 'here' heartbeat, the off-axis 'turned around' glow, the playground call-and-response pair, the Ch7 sustained bloom) then recedes. Light-wrap (warm halo bleeding around type edges) is export-only finishing tuned from the MP4. Vignette deepens negative space every frame.
- THE ONE HARD KINETIC: the Ch6 voicemail is the only place type abandons BlurReveal for KineticText snap-in (rigid, mechanical, no breathing scale, held too long) — the grafted 'Theft' pattern-interrupt marking the hinge from living voice to recording. The waveform is AudioVisualizer type:'waveform' drawn then FLATLINED (drawn-then-held-still), reanimated in Ch7 and morphed into a Spotlight bloom. No new engine work — all existing primitives.
- FRAME BUDGET: 30fps x 480s = 14,400 frames (chapter timings sum to 542s of design with breathing room; the locked cut is trimmed to 480s+ — the warm middle Ch4-5 is where ruthless hold-discipline trims if a first cut drags). The Ch6 dark stopdown is ~3-3.5s (shortened from 4s; cut to ~2.5s for any short-form version) to de-risk autoplay.
- RENDER-KEY-FRAMES-TO-ITERATE. Do NOT render the full 14,400 frames to evaluate. Iterate on the 8 chapter-boundary key frames + the ~12 opening-storyboard beats first (render-frame --crop to check type centering and the hue-transitions), then render the 75s pilot end-to-end (motion-blur 8) as the first full proof, then the remaining chapters once the pilot grade is locked. Rough-center type by eye, verify with a crop-render. The pilot is the only thing rendered in full before the rest is signed off.
- TYPOGRAPHY: one warm humanist serif (Source Serif 4 / Newsreader), loaded via the wasm font path (Google Fonts work in-browser per project memory). Weights 300/400/500 only — never bold, never a display grotesque. The film is spoken, not announced. Letter-spacing opens +0.5-1.5% on the whisper lines.
- ZERO FORBIDDEN PRIMITIVES: no 3D, no particles, no depth-of-field. Every 'soft focus' is BlurReveal's type sigma/opacity focus-pull (fromBlur 10->0), not a lens. Every primitive named here exists in packages/components/src/components (MeshGradient, GradientShift, GrainOverlay, Spotlight, Vignette, BlurReveal, KineticText, TextFadeReplace, FadeIn/Out, AudioVisualizer, FilmGrade) — verified against the shipped schemas.