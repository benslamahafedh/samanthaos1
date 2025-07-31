import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, BrainCircuit} from "lucide-react";
import { addMemory, preloadEmbeddingModel, getAllMemories, deleteMemory, MemoryRecord } from "@/lib/memory";
import { toast } from "sonner";
import { buildLlamaContext } from "@/lib/contextBuilder";
import type { Voices, Message } from "@/types/chat";
import { OS1Animation } from "./OS1Animation";
import { AudioVisualizer } from "./AudioVisualizer";
import "./OS1Animation.css";
import { useOpenAIRecorder } from "@/hooks/useOpenAIRecorder";
import { MemoryViewer } from "./MemoryViewer";


const DENIAL_PHRASES_FOR_STORAGE = [
  "don't have personal memories",
  "don't retain information",
  "start from a blank slate",
  "cannot recall past conversations",
  "don't have memory",
  "i cannot recall", 
  "i don't recall",
  "i am unable to recall",
  "i don't have information about you",
  "i don't know your name" 
];

export function LlamaChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const speed = 1;
  const selectedVoice: keyof Voices = "alloy";
  // Removed unused TTS processing state
  const [audioChunkQueue, setAudioChunkQueue] = useState<Blob[]>([]);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  
  // Simplified TTS - no queue needed
  
  const llamaWorker = useRef<Worker | null>(null);
  const kokoroWorker = useRef<Worker | null>(null);
  
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [llamaStatus, setLlamaStatus] = useState<"loading" | "ready" | "error">("loading");
  const [kokoroStatus, setKokoroStatus] = useState<"loading" | "ready" | "error">("loading");
  const [componentError, setComponentError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [inputReady, setInputReady] = useState(false);
  
  const messageEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const latestResponseRef = useRef<string>("");
  const latestUserSubmitRef = useRef<string>(""); 
  const messagesRef = useRef<Message[]>([]);
  const currentSentenceBufferRef = useRef<string>("");
  const isProcessingRef = useRef(isProcessing);
  const lastSubmittedTextRef = useRef<string>("");

  // --- State for Memory Viewer ---
  const [isMemoryViewerOpen, setIsMemoryViewerOpen] = useState(false);
  const [memoryList, setMemoryList] = useState<MemoryRecord[]>([]);
  const [isMemoryLoading, setIsMemoryLoading] = useState(false); // Optional: for loading state
  const [showGuide, setShowGuide] = useState(true);
  // --- End Memory Viewer State ---

  // --- Ref to track viewer state for callbacks ---
  const isMemoryViewerOpenRef = useRef(isMemoryViewerOpen);
  // --- End ref --- 

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  useEffect(() => {
    document.body.classList.add('os1-theme');
    return () => { document.body.classList.remove('os1-theme'); };
  }, []);

  const buildContextMemo = useCallback(async (userInput: string) => {
    try {
      return await buildLlamaContext(userInput);
    } catch (buildError) {
      //console.error("Error building Llama context:", buildError);
      //toast.error("Failed to process memories for context.");
      return "";
    }
  }, []);

  const updateMessages = useCallback((text: string) => {
    setMessages(prev => {
      const newMessages = [...prev];
      if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === "assistant") {
        newMessages[newMessages.length - 1] = { 
          ...newMessages[newMessages.length - 1], 
          content: text 
        };
      }
      return newMessages;
    });
  }, []);


  // Simplified cleanup - just reset processing state
  const resetProcessing = useCallback(() => {
    setIsProcessing(false);
    isProcessingRef.current = false;
  }, []); 


  const speakText = (text: string) => {
    if (!text || !kokoroWorker.current) return;
    const trimmedText = text.trim();
    if (trimmedText === "") return;

    // Simple TTS - just send directly to worker
    const sanitizedText = trimmedText.replace(/\*/g, '');
    console.log("Speaking:", sanitizedText.substring(0, 50));
    
    kokoroWorker.current.postMessage({ 
      text: sanitizedText, 
      voice: selectedVoice, 
      speed 
    });
  };

  // Simplified TTS - no queue processing needed

  const playNextChunk = useCallback(() => {
    if (audioChunkQueue.length === 0 || isAudioPlaying) return;
    
    const nextChunk = audioChunkQueue[0];
    const url = URL.createObjectURL(nextChunk);

    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setIsAudioPlaying(false);
      audioRef.current.onerror = () => setIsAudioPlaying(false);
    }

    setAudioChunkQueue(prev => prev.slice(1));
    audioRef.current.src = url;
    setIsAudioPlaying(true);
    
    audioRef.current.play().catch(err => {
      console.error("Audio playback error:", err);
      setIsAudioPlaying(false);
    });
  }, [audioChunkQueue.length, isAudioPlaying]);

  const generateWelcomeBackMessage = useCallback(async () => {
      if (isProcessingRef.current || status !== 'ready') {
          //console.log("generateWelcomeBackMessage: Skipping, already processing or not ready.");
          return; 
      }
      
      //console.log("Generating welcome back message using context builder...");
      resetProcessing(); 

      let systemPrompt = "";
      try {
          const triggerPhrase = "You are Samantha. Briefly welcome the user back by knowing what is the user's name.";
          systemPrompt = await buildContextMemo(triggerPhrase); 
          //console.log("Context built for welcome message:", systemPrompt); 
          if (!systemPrompt) {
              console.warn("Context builder returned empty for welcome message, using fallback.");
              systemPrompt = "You are Samantha. Briefly welcome the user back.";
          }
      } catch (buildError) {
          console.error("Error building context for welcome message:", buildError);
          toast.error("Failed to build context for greeting.");
          systemPrompt = "You are Samantha. Briefly welcome the user back.";
      }

                queueMicrotask(() => {
              setIsProcessing(true);
              isProcessingRef.current = true; 

          //console.log("Using system prompt for welcome message:", systemPrompt);

          const messagesForWorker: Message[] = [
              { role: 'system', content: systemPrompt },
          ];

          setMessages([{ role: 'assistant', content: '' }]);


          setTimeout(() => { 
              if (llamaWorker.current) {
                  //console.log("Posting message type 'generate' to worker for welcome back message.");
                  llamaWorker.current.postMessage({
          type: 'generate',
          data: {
                          messages: messagesForWorker,
                          audio: null, 
                      }
                  });
      } else {
                  console.error("Llama worker not available for welcome back message.");
                  setIsProcessing(false);
                  isProcessingRef.current = false;
                  toast.error("Cannot connect to AI model worker for greeting.");
              }
          }, 50);
      });
  }, [status, resetProcessing, setIsProcessing, buildContextMemo]); // Added buildContextMemo dependency


  const handleSubmit = useCallback(async (submittedText?: string) => {
 
      // Simple processing - no interruptions
      resetProcessing();
      queueMicrotask(async () => {
        const textToSubmit = submittedText;
        
        if (!textToSubmit || !textToSubmit.trim()) {
          console.log("Not submitting: empty text (microtask)");
          return;
        }

        // Prevent duplicate submissions of the same text
        if (lastSubmittedTextRef.current === textToSubmit.trim()) {
          console.log("Skipping duplicate submission:", textToSubmit.substring(0, 30));
          return;
        }
        lastSubmittedTextRef.current = textToSubmit.trim();
    
        //console.log("Submitting message (microtask):", textToSubmit);
        setIsProcessing(true);
        isProcessingRef.current = true;

        const userInputText = textToSubmit.trim(); 
        latestUserSubmitRef.current = userInputText;
        //console.log(`LlamaChat: Storing for memory/submit ref (using text): "${latestUserSubmitRef.current}"`);

        let contextForLlama = "";
        try {
            contextForLlama = await buildContextMemo(userInputText);
        } catch (buildError) {
            console.error("Error building Llama context:", buildError);
            toast.error("Failed to process memories for context.");
            contextForLlama = "";
        }

        // --- Prepare Messages --- 
        // Always use the transcribed text, not audio data
        const userMessageForWorker: Message = { role: "user", content: userInputText };
        const userMessageForDisplay: Message = { role: "user", content: userInputText };

        const currentMessagesForDisplay = [...messagesRef.current, userMessageForDisplay]; 
        setMessages([...currentMessagesForDisplay, { role: "assistant", content: "" }]);

        const fullHistory = [...messagesRef.current, userMessageForWorker];
        const SLIDING_WINDOW_SIZE = 10;
        let messagesForWorker = fullHistory.slice(-SLIDING_WINDOW_SIZE);
        //console.log(`LlamaChat: Sliced message history to last ${messagesForWorker.length} messages (max ${SLIDING_WINDOW_SIZE})`);

        if (contextForLlama) {
          //console.log("Prepending system prompt with context for worker...");
          messagesForWorker.unshift({ role: "system", content: contextForLlama });
        }

        setTimeout(() => {
          if (llamaWorker.current) {
            const messagePayload = {
              messages: messagesForWorker,
            };
            //console.log(`LlamaChat: Posting message type 'generate' to worker. Context included: ${!!contextForLlama}`);
            llamaWorker.current.postMessage({
              type: "generate",
              data: messagePayload
      });
            } else {
            console.error("Llama worker not available");
            setIsProcessing(false); 
            isProcessingRef.current = false;
            setMessages(currentMessagesForDisplay); 
            toast.error("Cannot connect to AI model worker.");
          }
        }, 50); 
      }); 
  }, [buildContextMemo, resetProcessing]);

  const handleTranscriptionUpdate = useCallback((text: string) => {
    if (text && text.trim()) {
        console.log("LlamaChat received transcription update:", text);
        // Auto-submit when transcription is received, but only if not already processing
        if (!isProcessingRef.current) {
            handleSubmit(text);
        } else {
            console.log("Skipping transcription submission - already processing");
        }
    }
  }, [handleSubmit]); 

  const handleSilenceSubmit = useCallback((_text: string, _audioData: Float32Array | null) => {
    //console.log("LlamaChat: Silence duration met, triggering submit.");
    // Audio transcription is handled by the recorder hook, so we don't need to store audio data
    handleSubmit(); 
  }, [handleSubmit]); 

  const {
    isRecording,
    transcriptionReady,
    startRecording: startRecordingWhisper,
    stopRecording: stopRecordingWhisper,
    micStream,
    error: recorderError,
  } = useOpenAIRecorder({
      onTranscriptionUpdate: handleTranscriptionUpdate,
      onSilenceDetected: handleSilenceSubmit,
  });


  useEffect(() => {
    let isLoading = true; 
    const loadingInterval = setInterval(() => {
      if (!isLoading) return;
      setLoadingProgress(prev => Math.min(prev + (Math.random() * 4 + 1), 90));
    }, 300);

    llamaWorker.current = new Worker(new URL("../openai-worker.js", import.meta.url), { type: "module" });
    kokoroWorker.current = new Worker(new URL("../openai-tts-worker.js", import.meta.url), { type: "module" });

    const handleLlamaMessage = (e: MessageEvent) => {
      const { status, output, data, summary, error } = e.data;
      
      switch (status) {
        case "ready":
          setLlamaStatus("ready");
          setLoadingProgress(prev => Math.max(prev, 60));
          break;
        case "error":
          setLlamaStatus("error");
          setComponentError(data || "Error loading Llama model");
          clearInterval(loadingInterval);
          currentSentenceBufferRef.current = ""; 
          break;
        case "start":
          latestResponseRef.current = "";
          currentSentenceBufferRef.current = ""; 
          setMessages(prev => {
            if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && prev[prev.length - 1].content === "") {
              return prev;
            }
            return [...prev, { role: "assistant", content: "" }];
          });
          break;
        case "update":
          const newToken = output; 
          if (typeof newToken === 'string') {
            currentSentenceBufferRef.current += newToken;
            latestResponseRef.current += newToken;
            updateMessages(latestResponseRef.current); 
          }
          break;
        case "sentence_ready":
          const sentenceToSpeak = output;
          if (typeof sentenceToSpeak === 'string' && sentenceToSpeak.trim()) {
            speakText(sentenceToSpeak.trim());
          }
          break;
        case "complete":
          setIsProcessing(false);
          
          const finalText = output || latestResponseRef.current;
          const userInput = latestUserSubmitRef.current;
          updateMessages(finalText);
          
          // Speak any remaining text
          const remainingBuffer = currentSentenceBufferRef.current.trim();
          if (remainingBuffer) {
            speakText(remainingBuffer);
          }
          currentSentenceBufferRef.current = "";

          // Only create memory for meaningful user input, not for every response
          if (userInput && userInput.trim()) {
            const lowerCaseFinalText = finalText?.toLowerCase() || '';
            const shouldSaveMemory = !DENIAL_PHRASES_FOR_STORAGE.some(phrase => 
              lowerCaseFinalText.includes(phrase)
            );

            if (shouldSaveMemory) {
              const SHORT_INPUT_WORD_THRESHOLD = 15;
              const MIN_DIRECT_STORE_WORD_COUNT = 2; // Don't store <= 2 words
              const wordCount = userInput.split(/\s+/).filter(Boolean).length;

              // Additional checks for meaningful content
              const isMeaningful = wordCount >= MIN_DIRECT_STORE_WORD_COUNT && 
                                 !userInput.toLowerCase().includes('hello') &&
                                 !userInput.toLowerCase().includes('hi') &&
                                 !userInput.toLowerCase().includes('hey') &&
                                 userInput.length > 10;

              // Store directly ONLY if meaningful and between 3 and 14 words (inclusive)
              if (isMeaningful && wordCount < SHORT_INPUT_WORD_THRESHOLD) {
                  //console.log(`Input is short (${wordCount} words), storing directly.`);
                  addMemory(userInput, 'user')
                    .then(() => {
                        //console.log("Short user input added to memory.");
                        // Refresh viewer if open using ref
                        if (isMemoryViewerOpenRef.current) {
                            fetchMemories(); 
                        }
                    })
                    .catch((memError: unknown) => { 
                        console.error("Failed to add short user input to memory:", memError);
                        toast.error("Failed to save short memory input.");
                    });
              // Summarize if 15 words or more and meaningful
              } else if (wordCount >= SHORT_INPUT_WORD_THRESHOLD && isMeaningful) {
                 const textToSummarize = userInput; 
                 //console.log(`Requesting summarization for user input (${wordCount} words):`, textToSummarize.substring(0, 100) + "...");
                 if (llamaWorker.current) {
                   llamaWorker.current.postMessage({
                     type: 'summarize',
                     data: { textToSummarize }
                   });
                 } else {
                   console.error("Llama worker not available for summarization request.");
                   toast.error("Could not save memory summary: Worker unavailable.");
                 }
              } else {
                  //console.log(`Input too short (${wordCount} words), skipping memory storage.`);
              }
            } else {
               //console.log("Skipping memory save due to denial phrase.");
            }
          }

          setTimeout(() => {
            latestUserSubmitRef.current = "";
            latestResponseRef.current = "";
          }, 100);
          break;

        case "summarization_start":
          //console.log("Worker started summarization process...");
          break;
          
        case "summary_complete":
          //console.log("Received summary:", summary);
          if (summary && typeof summary === 'string' && summary.trim()) {
             const saveMemory = () => {
                 addMemory(summary.trim(), 'user')
                    .then(() => {
                        //console.log("User input summary added to memory.");
                        // Refresh viewer if open using ref
                        if (isMemoryViewerOpenRef.current) {
                            fetchMemories();
                        }
                    })
                    .catch((memError: unknown) => { 
                        console.error("Failed to add summary to memory:", memError);
                        toast.error("Failed to save summarized memory.");
                    });
             };

            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(saveMemory, { timeout: 1000 });
            } else {
                setTimeout(saveMemory, 0);
            }
          } else {
            console.warn("Received empty or invalid summary from worker, not saving to memory.");
          }
          break;

        case "summary_error":
          console.error("Summarization failed in worker:", data || error);
          toast.error("Failed to generate memory summary.");
          break;
      }
    };

    const handleKokoroMessage = (e: MessageEvent) => {
      const { status, data, chunk, } = e.data;
      switch (status) {
        case "device": break;
        case "ready":
          setKokoroStatus("ready");
          setLoadingProgress(prev => Math.max(prev, 75));
          break;
        case "stream":
          if (chunk && chunk.audio instanceof Blob) {
            handleAudioChunk(chunk.audio);
          } else {
            console.warn("Received stream message without valid audio blob:", chunk);
          }
          break;
        case "error":
          console.error("TTS Error:", data);
          setKokoroStatus("error");
          setComponentError(data || "Error with TTS service");
          break;
        case "complete":
          // TTS completed successfully
          console.log("TTS completed");
          break;
      }
    };

    llamaWorker.current.addEventListener("message", handleLlamaMessage);
    kokoroWorker.current.addEventListener("message", handleKokoroMessage);

    console.log("Requesting model loads for Llama, Kokoro...");
    llamaWorker.current.postMessage({ type: "load" });
    kokoroWorker.current.postMessage({ type: "load" });

    console.log("Initiating preload for Embedding model...");
    preloadEmbeddingModel().catch((err: unknown) => { 
        console.error("Embedding model preload failed:", err);
    });

    return () => {
      isLoading = false; 
      clearInterval(loadingInterval);
      //console.log("Terminating Llama & Kokoro workers...");
      llamaWorker.current?.terminate();
      kokoroWorker.current?.terminate();
      llamaWorker.current?.removeEventListener("message", handleLlamaMessage);
      kokoroWorker.current?.removeEventListener("message", handleKokoroMessage);
      
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.onended = null; 
            audioRef.current.onerror = null; 
            audioRef.current.src = ""; 
        }
        if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current);
            currentAudioUrlRef.current = null; 
      }
    };
  }, []);

  useEffect(() => {
    if (recorderError) {
        console.error("Error from useWhisperRecorder:", recorderError);
        setComponentError(recorderError);
        toast.error(`Recording Error: ${recorderError}`);
    }
  }, [recorderError]);

  useEffect(() => {
    const isReady = llamaStatus === "ready" && kokoroStatus === "ready" && transcriptionReady;
    const isError = llamaStatus === "error" || kokoroStatus === "error";
      
    if (isReady) {
      setLoadingProgress(100);
      setShowLoadingAnimation(true);
      const readyTimer1 = setTimeout(() => {
        setStatus("ready");
        const readyTimer2 = setTimeout(() => {
          setShowLoadingAnimation(false);
        }, 2500);
        const readyTimer3 = setTimeout(() => {
          setInputReady(true);
        }, 1300);
        return () => {
          clearTimeout(readyTimer2);
          clearTimeout(readyTimer3);
        };
      }, 1000);
      return () => clearTimeout(readyTimer1);
    } else if (isError) {
      setStatus("error");
      setLoadingProgress(prev => (prev === 100 ? 100 : 0)); 
    } else {
      setLoadingProgress(prev => (prev === 100 ? 100 : 0)); 
    }
  }, [llamaStatus, kokoroStatus, transcriptionReady]); 

  useEffect(() => {
    if (inputReady && messages.length === 0 && !isProcessingRef.current) {
      const visitedFlag = localStorage.getItem('os1_hasVisited');

      if (!visitedFlag) {
        //console.log("First visit detected, preparing predefined greeting.");
        const greetingText = "Welcome! I'm Samantha, your conversational companion. Everything we talk about, including memories of our chat, stays right here in your browser – nothing is sent to a server, and the AI runs entirely on your machine. To help me remember you next time, what should I call you? You can type your answer or click the microphone to speak.";
        localStorage.setItem('os1_hasVisited', 'true');
        const greetingMessage: Message = { role: 'assistant', content: greetingText };
        setMessages([greetingMessage]);
        speakText(greetingText);
      } else {
        //console.log("Return visit detected, triggering LLM for welcome back message.");
        generateWelcomeBackMessage(); 
      }
    }
  }, [inputReady, messages.length, generateWelcomeBackMessage]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAudioChunk = useCallback((chunk: Blob) => {
    setAudioChunkQueue(prev => {
      if (prev.length >= 10) {
        //console.warn("Audio queue size limit reached, dropping oldest chunk");
        return [...prev.slice(1), chunk];
      }
      return [...prev, chunk];
    });
  }, []);

  useEffect(() => {
    if (!isAudioPlaying && audioChunkQueue.length > 0) {
      //console.log("Effect: Triggering playNextChunk (Queue > 0, Not Playing)");
      playNextChunk();
    }
  }, [isAudioPlaying, audioChunkQueue.length, playNextChunk]);

  // --- Handlers for Memory Viewer ---
  const fetchMemories = useCallback(async () => {
    setIsMemoryLoading(true);
    try {
      const memories = await getAllMemories();
      // Sort by timestamp descending (newest first)
      memories.sort((a, b) => b.timestamp - a.timestamp);
      setMemoryList(memories);
    } catch (err) {
      console.error("Failed to fetch memories:", err);
      toast.error("Could not load memories.");
      setMemoryList([]); // Clear list on error
    } finally {
      setIsMemoryLoading(false);
    }
  }, []);

  const toggleMemoryViewer = useCallback(async () => {
    const opening = !isMemoryViewerOpen;
    setIsMemoryViewerOpen(opening);
    if (opening) {
      // Fetch memories only when opening the viewer
      await fetchMemories();
    } else {
      // Optionally clear the list when closing to save memory,
      // or keep it cached if preferred.
      // setMemoryList([]);
    }
  }, [isMemoryViewerOpen, fetchMemories]);

  const handleDeleteMemory = useCallback(async (id: number) => {
    //console.log(`Attempting to delete memory ID: ${id}`);
    try {
      await deleteMemory(id);
      toast.success("Memory deleted.");
      // Refresh the list after deletion
      await fetchMemories();
    } catch (err) {
      //console.error(`Failed to delete memory ID ${id}:`, err);
      toast.error("Could not delete memory.");
    }
  }, [fetchMemories]); // Depend on fetchMemories to ensure it's up-to-date
  // --- End Memory Viewer Handlers ---

  // --- Effect to keep viewer state ref updated ---
  useEffect(() => {
    isMemoryViewerOpenRef.current = isMemoryViewerOpen;
  }, [isMemoryViewerOpen]);
  // --- End effect --- 

  return (
    <div className="os1-container">
      <OS1Animation 
        isTTSProcessing={isProcessing} 
        showTransformation={showLoadingAnimation}
      />
      
      {status === "loading" && (
        <div className="loading-bar-container">
          <div className="loading-bar" style={{ width: `${loadingProgress}%` }}></div>
        </div>
      )}
      
      {status === "error" && (
        <div className="message error">
          <span>Error: {componentError || "Failed to load Samantha"}</span>
        </div>
      )}
      
      {status === "ready" && (
        <>
          {showGuide && (
            <div className="guide-overlay">
              <div className="guide-content">
                <div className="guide-icon">🎤</div>
                <h3>Press the mic to talk with Samantha</h3>
                <p>Simply click the microphone button and start speaking. Samantha will respond with her voice and remember your conversations.</p>
                <button 
                  className="guide-close-btn"
                  onClick={() => setShowGuide(false)}
                >
                  Got it!
                </button>
              </div>
            </div>
          )}
          
          {micStream && isRecording && (
            <div className="audio-visualizer-container">
              <div className="visualizer-glow"></div>
              <div className="visualizer-inner">
                <AudioVisualizer stream={micStream} className="os1-visualizer" />
              </div>
            </div>
          )}
          
          <div className={`input-container ${inputReady ? 'ready' : ''}`}>
            <button
              className={`memory-button ${isMemoryViewerOpen ? 'active' : ''}`} 
              onClick={toggleMemoryViewer}
              disabled={isMemoryLoading} 
              title="View Memories"
            >
              <BrainCircuit className="icon" />
            </button>

            <div className="mic-button-wrapper">
              <button
                className={`mic-button ${isRecording ? 'recording' : ''}`}
                onClick={() => {
                  if (isRecording) {
                    stopRecordingWhisper();
                  } else {
                    // Clear last submitted text when starting new recording
                    lastSubmittedTextRef.current = "";
                    startRecordingWhisper();
                  }
                }}
                disabled={!transcriptionReady || !!recorderError}
                title={recorderError ? recorderError : (isRecording ? "Stop recording" : "Start recording")}
              >
                {isRecording ? <MicOff className="icon" /> : <Mic className="icon" />}
              </button>
            </div>
          </div>

          <MemoryViewer
            isOpen={isMemoryViewerOpen}
            memories={memoryList}
            onDelete={handleDeleteMemory}
            isLoading={isMemoryLoading}
          />
        </>
      )}
      <div ref={messageEndRef} />
    </div>
  );
} 