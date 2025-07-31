import { OpenAIService } from '../openai';

let openaiService: OpenAIService | null = null;

async function getOpenAIService(): Promise<OpenAIService> {
  if (!openaiService) {
    openaiService = new OpenAIService();
  }
  return openaiService;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const service = await getOpenAIService();
    
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
}

export async function preloadEmbeddingModel() {
  try {
    await getOpenAIService();
    console.log("OpenAI embedding service initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize OpenAI embedding service:", error);
    throw error;
  }
} 