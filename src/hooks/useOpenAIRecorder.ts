import { useState, useEffect, useRef, useCallback } from 'react';
import { OpenAIService } from '../lib/openai';

const WHISPER_SAMPLING_RATE = 16000;
const PROCESS_INTERVAL = 1000;
const RECORDER_REFRESH_INTERVAL = 30000;
const MAX_CHUNKS = 50;
const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 2000;
const DEBOUNCE_INTERVAL_MS = 1000;

interface UseOpenAIRecorderProps {
  onTranscriptionUpdate: (text: string) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  onTranscriptionComplete?: (text: string) => void;
  onSilenceDetected?: (text: string, audioData: Float32Array | null) => void;
}

interface UseOpenAIRecorderReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  transcriptionReady: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  micStream: MediaStream | null;
  error: string | null;
}

export function useOpenAIRecorder({
  onTranscriptionUpdate,
  onRecordingStateChange,
  onSilenceDetected,
}: UseOpenAIRecorderProps): UseOpenAIRecorderReturn {
  // Internal State
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionReady, setTranscriptionReady] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestTranscribedText, setLatestTranscribedText] = useState<string>("");

  // Internal Refs
  const openaiService = useRef<OpenAIService | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const processingIntervalRef = useRef<number | null>(null);
  const lastProcessingTimeRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const recorderRefreshTimeoutRef = useRef<number | null>(null);

  // Silence Detection Refs
  const silenceStartTimeRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const hasTranscribedSpeechRef = useRef<boolean>(false);

  // Ref to track recording state reliably in callbacks
  const isRecordingRef = useRef<boolean>(false);

  // Refs for debouncing transcription updates
  const lastEmittedTranscriptionRef = useRef<string | null>(null);
  const lastEmitTimeRef = useRef<number>(0);
  const lastProcessedChunksHashRef = useRef<string | null>(null);

  useEffect(() => {
    isRecordingRef.current = isRecording;
    if (onRecordingStateChange) {
      onRecordingStateChange(isRecording);
    }
  }, [isRecording, onRecordingStateChange]);

  // Initialize OpenAI Service
  useEffect(() => {
    try {
      openaiService.current = new OpenAIService();
      setTranscriptionReady(true);
      setError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize OpenAI service';
      setError(errorMessage);
      setTranscriptionReady(false);
    }
  }, []);

  // Microphone Init
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Speech recognition is not supported in your browser.");
      return;
    }

    let streamInstance: MediaStream | null = null;
    let audioContextInstance: AudioContext | null = null;
    let recorderInstance: MediaRecorder | null = null;

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: WHISPER_SAMPLING_RATE
      }
    })
    .then(stream => {
      streamInstance = stream;
      setMicStream(stream);

      audioContextInstance = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
      audioContextRef.current = audioContextInstance;

      const mimeTypes = [
        'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp3', 'audio/wav'
      ];
      let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';

      recorderInstance = new MediaRecorder(stream, { mimeType: selectedMimeType });
      recorderRef.current = recorderInstance;

      recorderInstance.onstart = () => {
        audioChunksRef.current = [];
        recordingStartTimeRef.current = Date.now();
        lastProcessingTimeRef.current = Date.now();
        lastProcessedChunksHashRef.current = null; // Reset for new recording
      };

      recorderInstance.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        } else {
          console.warn("Received empty audio chunk");
        }
      };

      recorderInstance.onstop = () => {
        const wasRefresh = isRecordingRef.current;
        const isMidRefresh = isRefreshingRef.current;

        if (!wasRefresh && !isMidRefresh) {
          // Recording stopped by user
        } else if (isMidRefresh) {
          // Recorder stopped for refresh
        } else {
          console.warn("Recorder stopped unexpectedly while isRecordingRef was true.");
        }
        
        if (!isMidRefresh && audioChunksRef.current.length > 0 && !isTranscribing) {
          processLatestAudio();
        }
      };

      recorderInstance.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("An error occurred with the audio recorder.");

        if (isRecordingRef.current) {
          stopRecordingInternal();
        }
      };

      setError(null);
    })
    .catch(err => {
      console.error("Error accessing microphone:", err);
      setError("Failed to access microphone. Please grant permission.");
      setMicStream(null);
    });

    // Cleanup function
    return () => {
      stopPeriodicProcessing();
      clearRecorderRefresh();

      if (recorderInstance && recorderInstance.state === "recording") {
        try { recorderInstance.stop(); } catch (e) { console.error("Error stopping recorder on cleanup:", e); }
      }
      if (streamInstance) {
        streamInstance.getTracks().forEach(track => track.stop());
      }
      if (audioContextInstance) {
        try { audioContextInstance.close(); } catch (e) { console.error("Error closing AudioContext on cleanup:", e); }
      }
      
      recorderRef.current = null;
      audioContextRef.current = null;
      setMicStream(null);
      if (isRecordingRef.current) {
        setIsRecording(false);
      }
    };
  }, []);

  const convertBlobToAudio = async (blob: Blob): Promise<Float32Array | null> => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = audioContextRef.current;
      if (!audioContext) return null;

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);
      return new Float32Array(channelData);
    } catch (error) {
      console.error("Error converting blob to audio:", error);
      return null;
    }
  };

  const processLatestAudio = useCallback(async () => {
    if (!audioContextRef.current || !openaiService.current || isTranscribing) {
      console.log("processLatestAudio: Skipping - context/transcribing check failed");
      return;
    }

    if (audioChunksRef.current.length === 0) {
      console.log("processLatestAudio: Skipping - no audio chunks");
      return;
    }

    // Prevent processing the same audio multiple times
    const currentChunksHash = audioChunksRef.current.map(chunk => chunk.size).join(',');
    if (currentChunksHash === lastProcessedChunksHashRef.current) {
      console.log("processLatestAudio: Skipping - same chunks already processed");
      return;
    }

    setIsTranscribing(true);
    const chunksToProcess = [...audioChunksRef.current];
    lastProcessedChunksHashRef.current = currentChunksHash;

    let finalAudioData: Float32Array | null = null;
    try {
      const mimeType = recorderRef.current?.mimeType || 'audio/webm';
      const blob = new Blob(chunksToProcess, { type: mimeType });

      const audioData = await convertBlobToAudio(blob);
      finalAudioData = audioData;

      if (!audioData) {
        setIsTranscribing(false);
        audioChunksRef.current = [];
        resetSilenceTimer();
        if (isRecordingRef.current) {
          refreshRecorder();
        }
        return;
      }

      // Silence Detection
      const silenceCheckSamples = Math.floor(WHISPER_SAMPLING_RATE * (SILENCE_DURATION_MS / 1000));
      const sliceStart = Math.max(0, audioData.length - silenceCheckSamples);
      const audioSliceForSilenceCheck = audioData.slice(sliceStart);
      let rms = 0;
      if (audioSliceForSilenceCheck.length > 0) {
        rms = Math.sqrt(audioSliceForSilenceCheck.reduce((sum, sample) => sum + sample * sample, 0) / audioSliceForSilenceCheck.length);
      }

      if (rms < SILENCE_THRESHOLD) {
        if (isRecordingRef.current && silenceStartTimeRef.current === null && hasTranscribedSpeechRef.current) {
          silenceStartTimeRef.current = Date.now();

          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

          silenceTimerRef.current = window.setTimeout(() => {
            if (silenceStartTimeRef.current !== null && isRecordingRef.current) {
              const silenceDuration = Date.now() - silenceStartTimeRef.current;
              if (silenceDuration >= SILENCE_DURATION_MS) {
                audioChunksRef.current = [];
                if (onSilenceDetected) {
                  onSilenceDetected(latestTranscribedText, finalAudioData);
                }
                resetSilenceTimer();
                hasTranscribedSpeechRef.current = false;
              } else {
                resetSilenceTimer();
              }
            } else {
              resetSilenceTimer();
            }
          }, SILENCE_DURATION_MS);
        }
        setIsTranscribing(false);
      } else {
        // Speech detected
        resetSilenceTimer();

        try {
          const transcription = await openaiService.current!.transcribeAudio(blob);
          
          if (transcription && transcription.trim()) {
            const transcribedText = transcription.trim();
            setLatestTranscribedText(transcribedText);
            hasTranscribedSpeechRef.current = true;

            const now = Date.now();
            if (transcribedText === lastEmittedTranscriptionRef.current &&
                now - lastEmitTimeRef.current < DEBOUNCE_INTERVAL_MS) {
              console.log("Transcription debounced - duplicate detected:", transcribedText.substring(0, 30));
            } else {
              console.log("Emitting new transcription:", transcribedText);
              lastEmittedTranscriptionRef.current = transcribedText;
              lastEmitTimeRef.current = now;
              onTranscriptionUpdate(transcribedText);
            }
          }
        } catch (transcriptionError) {
          console.error("Transcription error:", transcriptionError);
          setError("Failed to transcribe audio.");
        }
        
        setIsTranscribing(false);
      }
      
      lastProcessingTimeRef.current = Date.now();
    } catch (err) {
      console.error("Error processing audio:", err);
      setIsTranscribing(false);
      resetSilenceTimer();
      setError("Error processing recorded audio.");
    }
  }, [isTranscribing, onSilenceDetected, onTranscriptionUpdate, latestTranscribedText]);

  const checkAndProcessAudio = useCallback(() => {
    if (audioChunksRef.current.length > MAX_CHUNKS * 0.8 && isRecordingRef.current && !isRefreshingRef.current) {
      console.log("Refreshing recorder due to chunk limit");
      refreshRecorder();
      return;
    }
    if (isRecordingRef.current && !isTranscribing && audioChunksRef.current.length > 0) {
      console.log("Periodic processing triggered");
      processLatestAudio();
    }
  }, [isTranscribing, processLatestAudio]);

  const startPeriodicProcessing = useCallback(() => {
    stopPeriodicProcessing();
    processingIntervalRef.current = window.setInterval(checkAndProcessAudio, PROCESS_INTERVAL);
  }, [checkAndProcessAudio]);

  const stopPeriodicProcessing = useCallback(() => {
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isRecording) {
      startPeriodicProcessing();
      scheduleRecorderRefresh();
    } else {
      stopPeriodicProcessing();
      clearRecorderRefresh();
    }
  }, [isRecording, startPeriodicProcessing, stopPeriodicProcessing]);

  const clearRecorderRefresh = useCallback(() => {
    if (recorderRefreshTimeoutRef.current) {
      window.clearTimeout(recorderRefreshTimeoutRef.current);
      recorderRefreshTimeoutRef.current = null;
    }
  }, []);

  const scheduleRecorderRefresh = useCallback(() => {
    clearRecorderRefresh();
    recorderRefreshTimeoutRef.current = window.setTimeout(() => {
      refreshRecorder();
    }, RECORDER_REFRESH_INTERVAL);
  }, [clearRecorderRefresh]);

  const refreshRecorder = useCallback(() => {
    if (!isRecordingRef.current || !recorderRef.current || isRefreshingRef.current) {
      return;
    }

    isRefreshingRef.current = true;

    try {
      if (recorderRef.current.state === "recording") {
        recorderRef.current.stop();
      } else {
        console.warn("Recorder not recording during refresh attempt, state:", recorderRef.current.state);
        isRefreshingRef.current = false;
        return;
      }
    } catch (e) {
      console.error("Error stopping recorder during refresh:", e);
      isRefreshingRef.current = false;
      return;
    }

    setTimeout(() => {
      if (isRecordingRef.current && recorderRef.current) {
        try {
          if (recorderRef.current.state === 'inactive') {
            audioChunksRef.current = [];
            recorderRef.current.start(500);
            scheduleRecorderRefresh();
          } else {
            console.warn(`Recorder not inactive (state: ${recorderRef.current.state}) after refresh stop timeout, cannot restart.`);
          }
        } catch (e) {
          console.error("Error restarting recorder after refresh:", e);
          setError("Failed to restart recorder after refresh.");
          stopRecordingInternal();
        }
      }
      isRefreshingRef.current = false;
    }, 300);
  }, [isTranscribing, processLatestAudio, scheduleRecorderRefresh]);

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    silenceStartTimeRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    if (!recorderRef.current || !transcriptionReady || isRecordingRef.current) {
      console.warn("Cannot start recording:", { hasRecorder: !!recorderRef.current, transcriptionReady, isRecording: isRecordingRef.current });
      return;
    }
    
    try {
      audioChunksRef.current = [];
      resetSilenceTimer();
      hasTranscribedSpeechRef.current = false;

      recorderRef.current.start(500);
      setIsRecording(true);
    } catch (err) {
      console.error("Error starting recording:", err);
      setError("Failed to start recording.");
      setIsRecording(false);
    }
  }, [transcriptionReady, resetSilenceTimer]);

  const stopRecordingInternal = useCallback((isManualStop = false) => {
    if (!recorderRef.current || !isRecordingRef.current) {
      return;
    }
    
    clearRecorderRefresh();
    resetSilenceTimer();
    hasTranscribedSpeechRef.current = false;

    try {
      if (recorderRef.current.state === "recording") {
        recorderRef.current.stop();
      } else {
        console.warn("Stop called but recorder wasn't recording, state:", recorderRef.current.state);

        if (isManualStop && audioChunksRef.current.length > 0 && !isTranscribing) {
          processLatestAudio();
        }
      }
    } catch (err) {
      console.error("Error stopping recording:", err);
      setError("Failed to stop recording cleanly.");
    } finally {
      setIsRecording(false);
    }
  }, [clearRecorderRefresh, resetSilenceTimer, isTranscribing, processLatestAudio]);

  const stopRecording = useCallback(() => {
    stopRecordingInternal(true);
  }, [stopRecordingInternal]);

  return {
    isRecording,
    isTranscribing,
    transcriptionReady,
    startRecording,
    stopRecording,
    micStream,
    error,
  };
} 