export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}


export interface Voices {
  [key: string]: string;
}

// Valid OpenAI TTS voices
export type OpenAIVoice = 'nova' | 'shimmer' | 'echo' | 'onyx' | 'fable' | 'alloy' | 'ash' | 'sage' | 'coral';

export interface TTSRequest {
  text: string;
  voice: keyof Voices;
  speed: number;
} 