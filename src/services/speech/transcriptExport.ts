export type TranscriptFormat = 'txt' | 'md' | 'json'

const MIME_TYPES: Record<TranscriptFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
}

export const createTranscriptExport = (
  text: string,
  sourceName: string,
  format: TranscriptFormat
) => {
  const base = sourceName
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
  const encoder = new TextEncoder()
  let safeBase = ''
  let bytes = 0
  for (const character of Array.from(base).slice(0, 80)) {
    const size = encoder.encode(character).length
    if (bytes + size > 160) {
      break
    }
    safeBase += character
    bytes += size
  }
  safeBase ||= 'asr'
  const contents = format === 'json' ? JSON.stringify({ text }, null, 2) : text
  return {
    name: `${safeBase}-transcript.${format}`,
    blob: new Blob([contents], { type: MIME_TYPES[format] }),
  }
}
