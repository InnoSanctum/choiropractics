# MuseScore import

Implemented locally. Use **Import score** in the desktop track list or the mobile Tracks sheet. Supported native files are `.mscz` and `.mscx` from MuseScore 2, 3, and 4. This document records the current behavior and remaining format limits.

## Import workflow

1. Choose a score. The importer reads the main score from the archive manifest, or an unambiguous root MSCX file. It ignores thumbnails, extracted parts, and playback assets.
2. Review the part names and suggested handling. Each part has a selection checkbox and a **Keep as one track / Split by pitch** selector.
3. Set a fallback tempo if the score starts without a tempo marking; the default is 120 BPM. Explicit tempo markings and tempo changes take precedence.
4. Choose **Add to current tracks** or **Replace current tracks**. The preview shows the generated count, resulting session count, and duration.
5. Import. Each output becomes an ordinary rehearsal track with generated “aaah” audio and exact symbolic pitches. Progress and cancellation are available during rendering.

The session supports **20 loaded tracks**. The importer checks the count after splitting and includes existing tracks when appending. It never silently drops extra parts. Keep more parts together, deselect parts, or replace the session if the resulting count exceeds 20. Ordinary audio tracks can also be added up to this limit.

Generated tracks are saved together in an IndexedDB transaction before the current session is changed. Parsing, rendering, cancellation, or storage failure leaves existing tracks intact. Score-derived notes and pitch frames survive restore without being re-analyzed as recordings.

## Part classification

Classification uses the author's names and instrument metadata before applying a polyphony heuristic:

- Vocal labels such as S, A, T, B, Soprano, Alto, Tenor, Bass, Baritone, Soprano 1, Soprano 2, SAB, SB, and SATB identify vocal material. Divisi is split by descending sounding pitch.
- Explicit instrumental names or metadata keep the complete instrument part together. This includes piano, guitar, bass guitar, organ, accordion, strings, brass, and woodwind instruments. All staves of a piano part remain in the same track.
- An unidentified part with **four or more distinct pitches sounding at once anywhere** is kept together as harmonic accompaniment.
- An unidentified part with at most three simultaneous pitches is split by rank.

The preview explains the suggested choice and lets the user override it. A named vocal part can have four divisi voices; the heuristic does not override that designation. A named instrumental part stays together even if it has only two notes.

SATB + Piano, SAB, SB, already separated vocal parts, and instrumental arrangements share the same pipeline. Part order and author-provided names are preserved. A monophonic part called Soprano 1 is not renamed Soprano 1 1.

## Splitting divisi

These rules apply only to parts selected for splitting:

1. Read the entire part, combining its staves and notation voices onto one timeline. A notation voice is not automatically an output track.
2. Use the stored sounding MIDI pitches, including their octaves. Do not apply a display clef or instrument transposition a second time.
3. Partition at every note onset and release. This handles overlapping rhythms as well as notes written in a single chord.
4. Let N be the maximum number of distinct simultaneous pitches in the part. Create N tracks for the entire piece, including material before the first fork.
5. At each slice, highest pitch goes to track 1, second highest to track 2, and so on. Pitch ranking is recalculated at every change; XML note order and voice-leading preferences do not change the rank.
6. A single shared note is copied to every derived track. Shared rests remain silent everywhere. Duplicate unison pitches do not create extra tracks.
7. When there are between two and N−1 pitches, place them in the highest ranked lanes and leave the remaining lanes resting. The preview can keep an ambiguous part together instead.
8. Preserve ties and sustained continuations. Repeated articulated notes of the same pitch retain separate attacks.

Example, with chord notes in descending pitch order:

```text
Source:     A B C [D,A] B [C,A]
Soprano 1:  A B C  D    B  C
Soprano 2:  A B C  A    B  A
```

A three-note fork anywhere makes three tracks throughout the part; all single notes before and after it are copied to all three.

## Audio, diagrams, and training

Each generated track uses a deterministic open-vowel harmonic waveform with gentle attack/release envelopes and no pitch drift or vibrato. Audio is mono PCM WAV at 22,050 Hz. Tracks share the same time origin, tempo map, complete duration, and silent spans. No installed MuseScore application, external sound font, or Muse Sounds download is needed.

Retained instrumental chords are rendered polyphonically and displayed as multiple simultaneous note bars on their one track. They can accompany training. Polyphonic tracks are excluded from singing-reference selection because one microphone pitch cannot be compared to a chord unambiguously; split the part in the import preview to create selectable melody tracks.

Track visibility is independent of mute, solo, and volume:

- In Practice, each eye button controls its diagram and timeline overview. Muting audio does not hide its diagram. Visibility choices are saved locally.
- In Training, only the selected melody's diagram is shown. Eye buttons display that enforced state and are disabled until Practice resumes.
- Selecting a training part that was hidden in Practice still shows it. Leaving Training restores the user's Practice visibility choices.

Score note bars use exact symbolic durations, including short notes and repeated attacks. Monophonic pitch frames are generated directly at 10 ms intervals for coaching. Polyphonic parts retain their full note list without inventing a single fundamental pitch.

## Verified supplied sample

`D:\Downloads\forClaude.mscz` contains `forClaude.mscx`. It reports MuseScore 4.7.5, score format 4.70, and 480 ticks per quarter note.

It has Soprano, Alto, Tenor, and Bass, each on one staff, with 32 measures in 4/4 and no explicit tempo mark. At the default 120 BPM, all generated tracks last 64 seconds, including trailing empty measures.

The soprano interval at beat four of measure one produces:

| Track | M1 beat 1 | Beat 2 | Beat 3 | Beat 4 | M2 beat 1 | Beat 2 | Beat 3 | Beat 4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Soprano 1 | F5 | F5 | G5 | F5 | G5 | F5 | A5 | rest |
| Soprano 2 | F5 | F5 | G5 | C5 | G5 | F5 | A5 | rest |

Expected output: **Soprano 1, Soprano 2, Alto, Tenor, Bass**. The source sample stays outside the repository.

## Supported timing and current limits

Supported timing includes regular and pickup measures, dotted values, nested tuplets, independent notation voices, local voice offsets, ties, rests, tempo changes, and bounded simple/nested repeats. Basic MuseScore 2 direct measure events and MuseScore 3/4 voice containers have parser coverage.

Alternate endings, navigation jumps, octave lines, grace-note timing, and measure-repeat symbols are rejected with instructions to expand or rewrite them in MuseScore. Unpitched percussion is omitted with a visible preview message. Ornaments and tremolos use written pitches/durations with a preview notice; detailed performance interpretation is not synthesized. Instrument changes, expressive tempo ramps, pedal resonance, and performance articulations are not reproduced.

The existing metronome and beat grid use the initial imported tempo and meter. Changes of tempo/meter remain aligned in generated audio and notes, but are not yet applied to the metronome/grid. A new import sets session tempo; this metadata is not currently stored with the session.

Imports have bounded file/XML sizes, note/measure counts, repeat expansion, one-hour per-track duration, and total generated audio memory. If a long arrangement exceeds the memory limit, import fewer parts or shorten it. The 20-track count is independent of these resource limits.

## Verification

Automated tests cover pitch ranking, shared material, multiple voices/staves, metadata precedence, unlabeled four-note heuristics, existing vocal numbering, SATB plus piano, 20-track overflow, ZIP selection, XML errors, tuplets, pickups, ties, simple repeats, tempo maps, WAV pitch, cancellation, and visibility restoration. The supplied MSCZ is also checked directly during local verification.

Format references: [MuseScore opening and saving guide](https://handbook.musescore.org/file-management/opening-and-saving-scores), [MuseScore file formats](https://musescore.org/en/handbook/2/file-formats), [MuseScore note pitch API](https://musescore.github.io/MuseScore_PluginAPI_Docs/plugins/html/note_8h_source.html).
