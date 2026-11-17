import { ApiError, API_ORIGIN, request } from '../api/client.js'
import type { TtsVoice } from '../api/speech.js'

const MAX_WAV_BYTES = 128 * 1024 * 1024
const UNKNOWN_SIZES = new Set([0xffffffff, 0x7fffffff])
const WAV_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'])

const invalidAudio = () => new ApiError('protocol', { key: 'toolTtsDownloadInvalid' })
const tooLarge = () => new ApiError('protocol', { key: 'toolTtsDownloadTooLarge' })
const aborted = () => new DOMException('Aborted', 'AbortError')

const readHeader = async (blob: Blob, offset: number, size: number) =>
  new DataView(await blob.slice(offset, offset + size).arrayBuffer())

const tag = (view: DataView, offset: number) =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  )

const validateWav = async (blob: Blob) => {
  if (blob.size < 45) {
    throw invalidAudio()
  }
  const header = await readHeader(blob, 0, 12)
  if (tag(header, 0) !== 'RIFF' || tag(header, 8) !== 'WAVE') {
    throw invalidAudio()
  }
  const riffSize = header.getUint32(4, true)
  if (riffSize !== 0 && !UNKNOWN_SIZES.has(riffSize) && riffSize + 8 > blob.size) {
    throw invalidAudio()
  }
  let offset = 12
  let hasFormat = false
  let pcmBlockAlign: number | null = null
  for (let count = 0; count < 1024 && offset + 8 <= blob.size; count += 1) {
    const chunk = await readHeader(blob, offset, 8)
    const name = tag(chunk, 0)
    const size = chunk.getUint32(4, true)
    const end = offset + 8 + size
    if (name === 'data') {
      if (
        !hasFormat ||
        size === 0 ||
        offset + 8 >= blob.size ||
        (!UNKNOWN_SIZES.has(size) && end > blob.size)
      ) {
        throw invalidAudio()
      }
      const dataSize = UNKNOWN_SIZES.has(size) ? blob.size - offset - 8 : size
      if (pcmBlockAlign !== null && dataSize % pcmBlockAlign !== 0) {
        throw invalidAudio()
      }
      return
    }
    if (end > blob.size || UNKNOWN_SIZES.has(size)) {
      throw invalidAudio()
    }
    if (name === 'fmt ') {
      if (size < 16) {
        throw invalidAudio()
      }
      const format = await readHeader(blob, offset + 8, 16)
      const formatCode = format.getUint16(0, true)
      if (formatCode === 1 || formatCode === 3) {
        pcmBlockAlign = format.getUint16(12, true)
        if (pcmBlockAlign === 0) {
          throw invalidAudio()
        }
      }
      hasFormat = true
    }
    offset = end + (size % 2)
  }
  throw invalidAudio()
}

export const synthesizeWavDownload = async (
  apiKey: string,
  text: string,
  voice: TtsVoice,
  signal: AbortSignal
): Promise<Blob> => {
  const response = await request(`${API_ORIGIN}/v1/tools/tts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, format: 'wav', filter_markdown: true }),
    signal,
  })
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {})
    throw aborted()
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (!contentType || !WAV_TYPES.has(contentType) || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw invalidAudio()
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WAV_BYTES) {
    void response.body.cancel().catch(() => {})
    throw tooLarge()
  }
  const reader = response.body.getReader()
  const cancelReader = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancelReader, { once: true })
  const chunks: ArrayBuffer[] = []
  let size = 0
  try {
    if (signal.aborted) {
      throw aborted()
    }
    for (;;) {
      const next = await reader.read()
      if (signal.aborted) {
        throw aborted()
      }
      if (next.done) {
        break
      }
      size += next.value.byteLength
      if (size > MAX_WAV_BYTES) {
        throw tooLarge()
      }
      chunks.push(next.value.slice().buffer)
    }
    const blob = new Blob(chunks, { type: 'audio/wav' })
    await validateWav(blob)
    if (signal.aborted) {
      throw aborted()
    }
    return blob
  } catch (error) {
    cancelReader()
    throw error
  } finally {
    signal.removeEventListener('abort', cancelReader)
    reader.releaseLock()
  }
}
