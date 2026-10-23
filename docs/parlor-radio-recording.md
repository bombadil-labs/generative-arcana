# Approved radio recording

`app/public/assets/parlor-radio-recording.mp3` is the exact approved Library file
`libfile_5cabcf8f32388191bcc6c36f9f87a5c0`, version 0, originally named
`parlor-radio-subtle-180s.mp3`. It is 4,321,442 bytes, 192 kbps, 48 kHz mono,
180 seconds. SHA-256:
`db3cb19e62445d751962f0bc57789bf07ca32113f7bad3cb53733dc8f17d5215`.

The accompanying source notes (`libfile_f56daf77704c81918a8ae0eb5c61eba9`)
report -34.2 LUFS integrated and -15.2 dBFS true peak, with no clipped samples.
This integration preserves the MP3 bytes, adds no normalization or synth layer,
and never amplifies above the source level. Browser tests independently decode
the full file, verify duration/channels/rate, bounded peak and silent endpoints.
Technical tests are not a claim of listening or party-room acceptance.

The recording contains eleven short passages from seven historical music sources,
four muffled archival speech fragments and nineteen real-radio tuning windows.
Source notes and splice cues were read from Library. The original MP3, WAV and
Library records were not modified.

## Credits and provenance

Music: Citizen DJ Project, Library of Congress, National Jukebox. The
[Citizen DJ Jazz collection](https://citizen-dj.labs.loc.gov/loc-jukebox-jazz/use/)
identifies these recordings as public domain and free to reuse. The approved mix
uses excerpts from:

- [Whispering](https://www.loc.gov/item/jukebox-37810/)
- [Venetian moon](https://www.loc.gov/item/jukebox-35285/)
- [Avalon](https://www.loc.gov/item/jukebox-37794/)
- [Dardanella](https://www.loc.gov/item/jukebox-34232/)
- [Wang-wang blues](https://www.loc.gov/item/jukebox-37802/)
- [Ain't we got fun](https://www.loc.gov/item/jukebox-40562/)
- [After you've gone](https://www.loc.gov/item/jukebox-313413/)

Speech: [Thomas A. Edison, August 12, 1927](https://www.gutenberg.org/ebooks/10137),
Golden Jubilee of the Phonograph ceremony. Project Gutenberg identifies the
recording as public domain in the USA. This is archival film speech used as distant
station texture, not represented as an authentic off-air broadcast.

Tuning: [Radio Noise.wav by RutgerMuller, Freesound 50750](https://freesound.org/people/RutgerMuller/sounds/50750/),
listed as CC0. Recorded real-radio tuning, shortened and varied in the approved mix.

## Playback and access

Initial quiet cues are 0, 45.4, 95.2 and 145.75 seconds, from
`libfile_589d3b6040fc8191b4f1c08f4cf7e9b7`. Playback fades in over 650 ms, retains
its cursor across interruptions, and uses the full recording before natural wrap.
The source starts/ends silently; arbitrary hard splices are not introduced.

The `/assets/parlor-radio-recording.mp3` URL is behind the same server-verified
owner gate as every `parlor-*` asset, with private/no-store caching. The app sends
same-origin credentials, rejects redirects/HTML/auth failures, caps downloads at
5 MB, checks the decoded duration and channel count, and cancels pending work on
stop/disposal. Static GitHub Pages packaging removes every `parlor-*` asset type,
including this MP3. No public bucket or new asset-sharing permission is created.

Mute, volume, speech ducking, microphone silence, blank reset, focus loss and
teardown remain governed by the existing radio lifecycle. Failure leaves the
reading functional and shows the existing operator-only ambience notice.
