# chat-demo

English | [简体中文](README.zh-CN.md)

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Standalone web search with query operators, result summaries, and pagination.
- Search, ASR, and TTS keep separate local histories; Fetch and OCR remain represented by chat history. History selection restores input without automatically sending a paid request.
- Standalone ASR transcribes uploaded 16-bit PCM WAV or Ogg Opus audio (up to 8 MiB and 120 seconds). Stereo audio uses the left channel. Transcripts can be downloaded as TXT, Markdown, or JSON.
- The TTS tool can synthesize and download WAV audio, with a 128 MiB local download limit.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

Standalone Search uses the browser-stored API key and sends queries directly to the configured service's `/v1/tools/search` endpoint. It does not use the separate server-side proxy, cache, or demo mode from the original `deepseek-search` project. The API service must allow browser cross-origin requests.

ASR page settings store the file-picker filter and result detail visibility locally. The filter does not convert or validate audio; the service checks its format and duration. ASR automatically detects the language and receives no language, sample-rate, or channel setting in the request.

The first TTS download uses a separate synthesis request and may incur API charges. The generated audio is kept in memory while the TTS page is open for repeat downloads; editing the text or changing the voice clears it.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command                  | Description                   |
| ------------------------ | ----------------------------- |
| `pnpm dev`               | Start the development server  |
| `pnpm build`             | Build into `dist/`            |
| `pnpm type`              | Run TypeScript type checks    |
| `pnpm lint`              | Lint with oxlint              |
| `pnpm test:asr`          | Run ASR client tests          |
| `pnpm test:tool-history` | Run tool history tests        |
| `pnpm test:chat-drafts`  | Run isolated tool draft tests |
| `pnpm test:tts`          | Run TTS download tests        |
| `pnpm format`            | Format with oxfmt             |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
