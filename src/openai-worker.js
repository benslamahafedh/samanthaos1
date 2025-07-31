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
    data: error.message || "Failed to initialize OpenAI service" 
  });
}

// Handle messages from main thread
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  // Handle interrupt
  if (type === 'interrupt') {
    isInterrupted = true;
    return;
  }

  // Handle load (already done in initialization)
  if (type === 'load') {
    return;
  }

  // If already processing, queue or reject
  if (isProcessing) {
    self.postMessage({ 
      status: "error", 
      data: "Already processing another request. Please wait until it completes." 
    });
    return;
  }

  isProcessing = true;
  isInterrupted = false;

  try {
    if (type === 'generate' || type === 'generate_with_audio') {
      await handleChatGeneration(data);
    } else if (type === 'summarize') {
      await handleSummarization(data);
    } else if (type === 'transcribe') {
      await handleTranscription(data);
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error("Worker error:", error);
    self.postMessage({
      status: "error",
      data: error.message || "Unknown error occurred"
    });
  } finally {
    isProcessing = false;
  }
});

async function handleChatGeneration(data) {
  const { messages, audio } = data;
  
  // If audio is provided, transcribe it first
  let userMessage = messages[messages.length - 1];
  if (audio && audio.length > 0) {
    try {
      // For Float32Array audio data, we need to convert it to a proper audio format
      // Since we can't easily convert Float32Array to a supported format in the worker,
      // we'll skip audio transcription in this path and rely on the recorder hook
      console.warn("Audio data provided to worker, but transcription should be handled by recorder hook");
      
      // Update the user message with a placeholder (transcription will be handled by recorder)
      userMessage = { ...userMessage, content: userMessage.content || "<audio_input>" };
      messages[messages.length - 1] = userMessage;
    } catch (error) {
      throw new Error(`Audio processing failed: ${error.message}`);
    }
  }

  // Start generation
  self.postMessage({ status: "start" });

  let fullResponse = "";
  let currentSentenceBuffer = "";

  await openaiService.streamChat(
    messages,
    // onChunk callback
    (content) => {
      if (isInterrupted) return;
      
      fullResponse += content;
      currentSentenceBuffer += content;
      
      self.postMessage({
        status: "update",
        output: content
      });

      // Check for sentence endings for TTS (less aggressive)
      const sentenceEndRegex = /[.!?]\s+/;
      if (sentenceEndRegex.test(content)) {
        const sentenceToSpeak = currentSentenceBuffer.trim();
        if (sentenceToSpeak && sentenceToSpeak.length > 10) {
          self.postMessage({
            status: "sentence_ready",
            sentence: sentenceToSpeak
          });
        }
        currentSentenceBuffer = "";
      }
    },
    // onComplete callback
    (completeResponse) => {
      if (isInterrupted) return;
      
      // Send any remaining buffer as final sentence
      if (currentSentenceBuffer.trim()) {
        self.postMessage({
          status: "sentence_ready",
          sentence: currentSentenceBuffer.trim()
        });
      }
      
      self.postMessage({
        status: "complete",
        output: completeResponse
      });
    },
    // onError callback
    (error) => {
      self.postMessage({
        status: "error",
        data: error
      });
    }
  );
}

async function handleSummarization(data) {
  const { textToSummarize } = data;
  
  self.postMessage({ status: "summarization_start" });
  
  try {
    const summaryMessages = [
      {
        role: "system",
        content: "You are a helpful assistant that summarizes text. Provide a concise summary in 64 tokens or less."
      },
      {
        role: "user",
        content: `Please summarize this text: ${textToSummarize}`
      }
    ];

    let summary = "";
    
    await openaiService.streamChat(
      summaryMessages,
      // onChunk callback
      (content) => {
        if (isInterrupted) return;
        summary += content;
      },
      // onComplete callback
      (completeSummary) => {
        if (isInterrupted) return;
        self.postMessage({
          status: "summary_complete",
          summary: completeSummary
        });
      },
      // onError callback
      (error) => {
        self.postMessage({
          status: "summary_error",
          data: error
        });
      }
    );
  } catch (error) {
    self.postMessage({
      status: "summary_error",
      data: error.message
    });
  }
}

async function handleTranscription(data) {
  const { audioBlob } = data;
  
  try {
    const transcription = await openaiService.transcribeAudio(audioBlob);
    self.postMessage({
      status: "transcription_complete",
      transcription: transcription
    });
  } catch (error) {
    self.postMessage({
      status: "transcription_error",
      data: error.message
    });
  }
} 