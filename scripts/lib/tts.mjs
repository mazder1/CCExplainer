// Wave 6a — speech synthesis WITH timing (the karaoke data).
//
// ElevenLabs' "with-timestamps" endpoint returns the audio AND an alignment
// map: for every character of the text, the exact second it is spoken. We
// group characters into words, so the viewer can highlight each word at the
// moment the voice says it.

export async function synthesizeWithTimings(
  text,
  {
    apiKey,
    voiceId = "21m00Tcm4TlvDq8ikWAM", // Rachel
    modelId = "eleven_multilingual_v2",
    speed = 1.0,
  } = {},
) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { speed, stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs answered ${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const data = await response.json();
  // The audio arrives base64-encoded inside JSON (it has to share the
  // response with the alignment data — JSON cannot carry raw bytes).
  const audio = Buffer.from(data.audio_base64, "base64");
  const align = data.alignment ?? data.normalized_alignment;
  if (!align) throw new Error("ElevenLabs response contained no alignment data");
  const words = wordsFromAlignment(align);
  const duration = align.character_end_times_seconds.at(-1) ?? 0;
  return { audio, words, duration };
}

// Group per-character timings into per-word timings: a word is an unbroken
// run of non-whitespace characters; it starts when its first character is
// spoken and ends when its last one is. Pure function — unit-tested offline.
export function wordsFromAlignment({
  characters,
  character_start_times_seconds: starts,
  character_end_times_seconds: ends,
}) {
  const words = [];
  let current = null;
  characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      current = null;
      return;
    }
    if (!current) {
      current = { text: "", start: starts[i], end: ends[i] };
      words.push(current);
    }
    current.text += ch;
    current.end = ends[i];
  });
  return words;
}
