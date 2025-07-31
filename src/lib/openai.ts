export interface OpenAIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OpenAIStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason: string | null;
  }>;
}

export class OpenAIService {
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor() {
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    this.model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini';
    this.baseURL = 'https://api.openai.com/v1';
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key not found. Please set VITE_OPENAI_API_KEY in your environment variables.');
    }
  }

  async streamChat(messages: OpenAIMessage[], onChunk: (content: string) => void, onComplete: (fullResponse: string) => void, onError: (error: string) => void) {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onComplete(fullResponse);
              return;
            }

            try {
              const parsed: OpenAIStreamResponse = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                onChunk(content);
              }
            } catch (e) {
              // Ignore parsing errors for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  async textToSpeech(text: string, voice: string = 'alloy'): Promise<Blob> {
    try {
      const response = await fetch(`${this.baseURL}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: import.meta.env.VITE_OPENAI_TTS_MODEL || 'tts-1',
          input: text,
          voice: voice,
          response_format: 'mp3',
          speed: 1.0,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'TTS request failed');
    }
  }

  async transcribeAudio(audioBlob: Blob): Promise<string> {
    try {
      // Determine the correct file extension based on the blob's MIME type
      let fileExtension = 'webm';
      if (audioBlob.type) {
        if (audioBlob.type.includes('mp3')) fileExtension = 'mp3';
        else if (audioBlob.type.includes('wav')) fileExtension = 'wav';
        else if (audioBlob.type.includes('m4a')) fileExtension = 'm4a';
        else if (audioBlob.type.includes('mp4')) fileExtension = 'mp4';
        else if (audioBlob.type.includes('mpeg')) fileExtension = 'mpeg';
        else if (audioBlob.type.includes('mpga')) fileExtension = 'mpga';
        else if (audioBlob.type.includes('oga')) fileExtension = 'oga';
        else if (audioBlob.type.includes('ogg')) fileExtension = 'ogg';
        else if (audioBlob.type.includes('flac')) fileExtension = 'flac';
        else if (audioBlob.type.includes('webm')) fileExtension = 'webm';
      }

      const formData = new FormData();
      formData.append('file', audioBlob, `audio.${fileExtension}`);
      formData.append('model', 'whisper-1');

      const response = await fetch(`${this.baseURL}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result.text;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Transcription failed');
    }
  }
} 