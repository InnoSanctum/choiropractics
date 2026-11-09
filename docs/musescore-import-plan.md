# MuseScore import plan

Status: planned only. No score parser, importer, or generated score audio is implemented in this change.

## Intended result

Import a MuseScore score and turn each part into one or more ordinary rehearsal tracks, with a generic “aaah” voice. Generated tracks must support the existing mixer, diagram, speed controls, training target selection, and offline restore exactly as uploaded recordings do. Each generated track is monophonic.

Support `.mscz` and `.mscx`. MuseScore documents both as its native formats; `.mscz` contains compressed score data. See the official [opening and saving guide](https://handbook.musescore.org/file-management/opening-and-saving-scores) and [format documentation](https://musescore.org/en/handbook/2/file-formats). The supplied sample was also inspected directly as a ZIP archive containing XML.

## Verified sample

`D:\Downloads\forClaude.mscz` contains `forClaude.mscx`, plus styles, thumbnail, and playback/view settings. The XML reports MuseScore **4.7.5**, score format **4.70**, and **480 ticks per quarter note**.

It has Soprano, Alto, Tenor, and Bass parts, each on one staff, with 32 measures in 4/4. No explicit tempo mark was found. Propose 120 BPM when a score has no tempo, clearly shown and editable before import.

Only Soprano contains a chord: F5 and C5 on beat four of measure one. Its first two measures should become:

| Track | M1 beat 1 | Beat 2 | Beat 3 | Beat 4 | M2 beat 1 | Beat 2 | Beat 3 | Beat 4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Soprano 1 | F5 | F5 | G5 | F5 | G5 | F5 | A5 | rest |
| Soprano 2 | F5 | F5 | G5 | C5 | G5 | F5 | A5 | rest |

Expected import: **five tracks**: Soprano 1, Soprano 2, Alto, Tenor, Bass. Preserve the shared start and all rests, including the empty trailing measures. The sample is a useful acceptance fixture; keep the original file outside the repository unless its inclusion is requested.

## Splitting a part

1. Read the entire part before allocating tracks. Combine all its staves and notation voices on one timeline. A notation voice is not automatically an output track.
2. Resolve note pitch to sounding MIDI pitch, including octave and instrument transposition. Do not apply octave clefs twice; specifically verify the sample's tenor against playback.
3. Preserve note onsets, releases, ties, and rests. Partition the timeline at every onset or release so overlapping notes with different rhythms are handled, not just notes in the same `<Chord>` element.
4. Let `N` be the maximum simultaneous pitch count anywhere in that part. Allocate `N` tracks for the whole piece, including material before the first fork. Collapse duplicate sounding pitches for this count; unison remains shared material.
5. In each slice, sort sounding pitches from highest to lowest. Highest goes to track 1, second highest to track 2, third highest to track 3, and so on. Rank by pitch every time; do not use XML ordering or a voice-leading heuristic that could place a lower note on a higher track.
6. If just one pitch sounds, copy it to **all N tracks**. A shared rest is silent on all tracks. Preserve the original rhythm and articulation, including repeated notes of the same pitch.
7. Proposed policy to review before implementation: when `1 < k < N` pitches sound, assign those pitches to tracks 1 through k and leave the remaining tracks resting. A score alone may not identify which divisi singers share a note; expose this result in the preview rather than inventing additional pitches.
8. Coalesce adjacent slices only when they represent continuation of the same held/tied source note. Repeated articulated notes must retain their attacks. If rank changes while a note is held, the sounding pitches must still occupy their required ranked tracks.

The requested example, with the fork notes interpreted in descending pitch order:

```text
Source:     A B C [D,A] B [C,A]
Soprano 1:  A B C  D    B  C
Soprano 2:  A B C  A    B  A
```

A three-note fork anywhere makes three tracks throughout the part. All earlier and later single notes are copied to all three; each full three-note fork is sorted afresh.

## Implementation stages

### 1. Parse into a symbolic timeline

Add a separate `src/score/` module behind a versioned parser interface. Begin with the supplied MuseScore 4 format; add fixtures and explicit adapters before claiming compatibility with other versions.

For `.mscz`, use a browser ZIP reader and select the score through `META-INF/container.xml`. Validate the declared score path; use an unambiguous root `.mscx` fallback for archives without a usable manifest. Avoid reading extracted part scores or thumbnails as the main score. For `.mscx`, parse XML directly. Bound compressed/uncompressed sizes and expansion, reject malformed XML and unsupported versions, and do not resolve external XML entities.

Normalize into part metadata, rational beat positions, sounding pitch, source-note identity, articulation, tempo changes, and meter changes. Cover dotted durations, pickup/partial measures, full-measure rests, tuplets, multiple staves/voices, and ties. Maintain independent voice cursors and interpret explicit locations rather than placing notation voices one after another.

Resolve tempo from the score's playback values, not display text. Integrate the same tempo map into seconds for every part; use the chosen fallback only when tempo is absent. Resolve dynamics into gain rather than changing pitch.

Playback order must be explicit. Expand supported repeats/endings into one shared performance timeline before splitting and rendering. Reject unsupported jumps, repeat structures, ornaments, or grace-note timing with an actionable import message rather than silently generating the wrong rehearsal audio. Add support incrementally with fixtures.

### 2. Preview and split

Apply the splitting rules above to the normalized timeline. Show part names, generated voice counts, duration, tempo, and target track slots before committing. Allow selecting generated tracks if they exceed the current **six-track limit**, and make replacement of occupied slots explicit. Never discard extra voices silently or partially replace the current rehearsal on a failed import.

### 3. Render a generic “aaah” voice

Use a deterministic browser-side harmonic oscillator with a formant envelope approximating an open vowel, a gentle attack/release, and conservative normalization. This avoids depending on installed MuseScore, Muse Sounds, or external sound fonts. No vibrato or pitch drift by default: the reference should have exact score intonation.

Render each split voice to a mono PCM WAV `File` and an `AudioBuffer`, with identical timeline origin and duration. Include silent spans; preserve individual note attacks and tied sustains. Render in bounded chunks or a worker so longer scores do not block the interface or exhaust memory. Offer cancellation before committing.

### 4. Integrate with existing tracks and storage

Derive `PitchFrame[]` directly from symbolic pitch and the tempo map, using the timestamp convention and cadence expected by the existing renderer. Emit unvoiced frames for rests; use exact MIDI and frequency for notes. Do not run pitch detection on audio whose pitches are already known.

Populate `AudioTrackState` with the generated buffer, exact frames, name, duration, color, and default mixer settings. Save WAV blobs and frames through `db.saveTrack`, using names such as `Soprano 1.wav`. Share the final track insertion path with ordinary audio uploads without adding a score-import path to the audio decoder itself.

Add a storage provenance field and version for score-derived frames. On restore, `App.tsx` currently re-analyzes frames whose `analysisVersion` differs from `PITCH_ANALYSIS_VERSION`; imported symbolic frames must bypass that audio-analysis invalidation. Migrate old records as ordinary audio tracks. Optionally retain the original score and symbolic events for later regeneration at another tempo.

Commit all selected tracks in one IndexedDB transaction after parsing/rendering succeeds. Only then replace in-memory tracks, choose a valid reference, and refresh playback. Surface quota/cancellation errors without losing existing recordings.

### 5. Verify before enabling import

- The supplied sample produces exactly the five named tracks and soprano pitches above; all files have aligned starts and equal durations.
- The requested A/B/C example reproduces both output lines exactly, including shared notes before the first fork.
- Reversed XML note order, repeated forks, three/four-note chords, octave-separated pitches, and all-monophonic parts retain the required pitch ranking.
- Overlapping rhythms, ties through a fork, crossings, repeated articulated notes, explicit voice rests, and `1 < k < N` passages match the preview policy.
- Pickups, dotted notes, tuplets, tempo/meter changes, trailing rests, and supported repeat playback keep audio and diagrams aligned across parts.
- Unsupported notation, invalid archives/XML, cancellation, six-track overflow, occupied slots, and storage failure leave the current session intact.
- Generated WAVs can be decoded and restored; symbolic pitch frames survive an audio pitch-analysis version change.
- In Training mode, every generated part can be selected as the silent reference, with the other tracks honoring mute/solo/volume and scoring against the exact symbolic melody.

No import dependencies or controls should be added until this work is approved for implementation.
