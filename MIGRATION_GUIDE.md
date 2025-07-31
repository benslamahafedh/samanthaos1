# Migration Guide: Local Models to OpenAI API

This guide explains the changes made to convert OS1 from using local models to OpenAI's API services.

## Overview of Changes

### 1. **Removed Local Model Dependencies**
- Removed `@huggingface/transformers`, `@xenova/transformers`, `kokoro-js`, and `@babycommando/entity-db`
- These were used for local LLM, TTS, and embedding models

### 2. **New OpenAI Services**
- **`src/lib/openai.ts`**: Main OpenAI service class handling chat, TTS, and transcription
- **`src/openai-worker.js`**: Worker for OpenAI chat completions and audio transcription
- **`src/openai-tts-worker.js`**: Worker for OpenAI text-to-speech
- **`src/hooks/useOpenAIRecorder.ts`**: New recorder hook using OpenAI Whisper API
- **`src/lib/memory/openai-embedding.ts`**: OpenAI embeddings service

### 3. **Updated Components**
- **`src/components/LlamaChat.tsx`**: Updated to use new OpenAI workers and recorder
- **`src/lib/memory/index.ts`**: Updated to use OpenAI embeddings
- **`package.json`**: Removed local model dependencies

### 4. **Environment Configuration**
- **`env.example`**: Template for OpenAI API configuration
- **`README.md`**: Updated documentation for OpenAI setup

## Key Benefits

### ✅ **Mobile Compatibility**
- Works on Android and iOS devices through browser
- No WebGPU requirements
- No large model downloads

### ✅ **Better Performance**
- Faster response times with OpenAI's optimized models
- Higher quality speech synthesis
- More reliable transcription

### ✅ **Easier Setup**
- No 2GB model downloads
- Simple API key configuration
- Works immediately after setup
- Voice-only interface (no text input)

### ✅ **Voice-Only Interface**
- Pure voice interaction
- No text input required
- Automatic transcription and submission

## Setup Instructions

### 1. **Install Dependencies**
```bash
npm install
```

### 2. **Configure Environment**
```bash
cp env.example .env
```

Edit `.env` and add your OpenAI API key:
```
VITE_OPENAI_API_KEY=your_openai_api_key_here
VITE_OPENAI_MODEL=gpt-4o-mini
VITE_OPENAI_TTS_MODEL=tts-1
VITE_OPENAI_TTS_VOICE=alloy
```

**Note:** Available TTS voices are: nova, shimmer, echo, onyx, fable, alloy, ash, sage, coral

### 3. **Test Setup**
```bash
node test-setup.js
```

### 4. **Run Development Server**
```bash
npm run dev
```

## API Usage

The application now uses these OpenAI APIs:

- **Chat Completions**: For conversational AI responses
- **Whisper**: For speech-to-text transcription
- **TTS**: For text-to-speech synthesis
- **Embeddings**: For memory similarity search

## Cost Considerations

- **Chat Completions**: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- **Whisper**: $0.006 per minute of audio
- **TTS**: $0.015 per 1K characters
- **Embeddings**: $0.00002 per 1K tokens

For typical usage, costs are minimal (a few cents per conversation).

## Troubleshooting

### Common Issues

1. **"OpenAI API key not found"**
   - Make sure `.env` file exists and contains `VITE_OPENAI_API_KEY`
   - Restart the development server after adding the key

2. **"Failed to initialize OpenAI service"**
   - Check your API key is valid
   - Ensure you have sufficient API credits

3. **TTS Voice Error**
   - Valid voices: nova, shimmer, echo, onyx, fable, alloy, ash, sage, coral
   - Default voice is 'alloy' (warm, friendly)

4. **Audio Transcription Error**
   - Supported formats: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
   - Audio recording automatically uses supported formats
   - Grant microphone permissions in browser

5. **Audio recording issues**
   - Grant microphone permissions in browser
   - Check browser compatibility (Chrome, Firefox, Safari work)

6. **Memory not working**
   - Check browser IndexedDB support
   - Clear browser data if needed

### Browser Compatibility

- **Desktop**: Chrome, Firefox, Safari, Edge
- **Mobile**: Chrome (Android), Safari (iOS)
- **Requirements**: Modern browser with Web Audio API support

## Migration Notes

- All existing memory data will be preserved
- The interface remains exactly the same
- Performance should be significantly improved
- Mobile compatibility is now fully supported

## Support

If you encounter issues:
1. Check the browser console for error messages
2. Verify your OpenAI API key and credits
3. Test with the provided test script
4. Check browser compatibility requirements 