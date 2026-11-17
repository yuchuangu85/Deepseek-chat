import { API_ORIGIN } from './client.js'

export type SearchResult = {
  rerankScore: number
  title: string
  url: string
  snippet: string
  summary: string
  siteName: string | null
  date: string | null
  authority: number
}

export class SearchApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'SearchApiError'
  }
}

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.trim()) {
    return false
  }
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const text = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.slice(0, maxLength).trim() : ''

const normalizeResult = (value: unknown): SearchResult | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const result = value as Record<string, unknown>
  if (!isHttpUrl(result.url)) {
    return null
  }
  const rerankScore = Number(result.rerank_score)
  const authority = Number(result.authority)
  return {
    rerankScore: Number.isFinite(rerankScore) ? Math.max(0, Math.min(3, rerankScore)) : 0,
    title: text(result.title, 500) || result.url,
    url: result.url,
    snippet: text(result.snippet, 2000),
    summary: text(result.summary, 4000),
    siteName: text(result.site_name, 200) || null,
    date: text(result.date, 80) || null,
    authority: Number.isFinite(authority) ? Math.round(Math.max(-1, Math.min(4, authority))) : -1,
  }
}

export const searchWeb = async (apiKey: string, query: string, signal?: AbortSignal) => {
  let response: Response
  try {
    response = await fetch(`${API_ORIGIN}/v1/tools/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, count: 50, need_content: false }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    throw new SearchApiError(
      'network_error',
      error instanceof Error ? error.message : String(error)
    )
  }
  if (!response.ok) {
    let code = 'unknown'
    let message = response.statusText || 'Search request failed.'
    try {
      const body: unknown = await response.json()
      if (
        body &&
        typeof body === 'object' &&
        'error' in body &&
        body.error &&
        typeof body.error === 'object'
      ) {
        if ('code' in body.error && typeof body.error.code === 'string') {
          code = body.error.code
        }
        if ('message' in body.error && typeof body.error.message === 'string') {
          message = body.error.message
        }
      }
    } catch {
      // Keep the generic message for non-JSON errors.
    }
    throw new SearchApiError(code, message, response.status)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SearchApiError(
      'upstream_error',
      'The search service returned an unreadable response.'
    )
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('results' in payload) ||
    !Array.isArray(payload.results)
  ) {
    throw new SearchApiError(
      'upstream_error',
      'The search service returned an unreadable response.'
    )
  }
  return payload.results
    .map(normalizeResult)
    .filter((result): result is SearchResult => result !== null)
}
