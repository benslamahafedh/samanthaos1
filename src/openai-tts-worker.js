import { OpenAIService } from './lib/openai.js';

let openaiService = null;
let isProcessing = false;
let isInterrupted = false;

// Initialize OpenAI service
try {
  openaiService = new OpenAIService();
  self.postMessage({ status: "ready" });
} catch (error) {
  self.postMessage({ 
    status: "error", 
    data: error.message || "Failed to initialize OpenAI TTS service" 
  });
}

// Handle messages from main thread
self.addEventListener("message", async (e) => {
  const { type, text, voice, speed } = e.data;

  // Handle interrupt
  if (type === 'interrupt') {
    isInterrupted = true;
    return;
  }

  // Handle load (already done in initialization)
  if (type === 'load') {
    return;
  }

  // If already processing, queue the request instead of rejecting
  if (isProcessing) {
    // Queue the request for later processing
    if (!self.requestQueue) {
      self.requestQueue = [];
    }
    self.requestQueue.push({ type, text, voice, speed });
    console.log("TTS request queued, current queue length:", self.requestQueue.length);
    return;
  }

  isProcessing = true;
  isInterrupted = false;

  try {
    if (!text || !text.trim()) {
      throw new Error("No text provided for TTS");
    }

    // Use the provided voice or default to 'alloy'
    // Map old voice names to valid OpenAI voices
    let ttsVoice = voice || import.meta.env.VITE_OPENAI_TTS_VOICE || 'alloy';
    
    // Map any old voice names to valid OpenAI voices
    const voiceMapping = {
      'af_heart': 'alloy',
      'nova': 'nova',
      'shimmer': 'shimmer', 
      'echo': 'echo',
      'onyx': 'onyx',
      'fable': 'fable',
      'alloy': 'alloy',
      'ash': 'ash',
      'sage': 'sage',
      'coral': 'coral'
    };
    
    ttsVoice = voiceMapping[ttsVoice] || 'alloy';
    
    // Generate speech
    console.log("TTS generating speech for:", text.substring(0, 50) + "...");
    const audioBlob = await openaiService.textToSpeech(text, ttsVoice);
    
    if (isInterrupted) {
      console.log("TTS interrupted, stopping");
      return;
    }

    console.log("TTS generated audio blob, size:", audioBlob.size);

    // Send the audio blob back
    self.postMessage({
      status: "stream",
      chunk: {
        audio: audioBlob,
        text: text
      }
    });

    // Signal completion
    self.postMessage({ status: "complete" });

  } catch (error) {
    console.error("TTS Worker error:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      text: text?.substring(0, 50)
    });
    self.postMessage({
      status: "error",
      data: error.message || "TTS generation failed"
    });
  } finally {
    isProcessing = false;
    
    // Process next queued request if any
    if (self.requestQueue && self.requestQueue.length > 0) {
      const nextRequest = self.requestQueue.shift();
      // Process the next request
      setTimeout(() => {
        self.dispatchEvent(new MessageEvent('message', { data: nextRequest }));
      }, 100); // Small delay to prevent stack overflow
    }
  }
}); 