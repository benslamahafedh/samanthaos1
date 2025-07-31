# OS1 - OpenAI-Powered Conversational AI

This project is an attempt to recreate some of the experience "OS1" from the movie 'Her', using OpenAI's powerful API for speech-to-text, text-to-speech, and conversational AI. It features direct speech-to-text interaction and runs entirely in your browser, making it compatible with mobile devices.

The system uses OpenAI's latest models for high-quality, reliable responses and natural-sounding speech synthesis.

### Try it out: https://huggingface.co/spaces/webml-community/os1
*(initially, you will download the required models, so loading will be a bit longer at first. Look at your browser's network tab in the console if you really want to see the models being fetched)*

## Demo: Testing OS1's ability to remember my name


https://github.com/user-attachments/assets/525c56ec-ba87-4adf-bdcd-2e1ddf90f8b2


## Features

*   **Voice-Only Interface:** Pure voice interaction - no text input required. Simply speak to interact with OS1.
*   **Speech-to-text Conversation:** Uses OpenAI's Whisper API for high-quality speech recognition, converting your voice input to text for the conversational AI.
*   **Real-time Transcription:** Your speech is transcribed in real-time and displayed on screen for visual feedback, while also being stored in the memory system.
*   **Client-Side Memory:** Stores interactions between the user and assistant using vector storage in the browser's IndexedDB. Contextually relevant memories are automatically retrieved and injected into the AI's system prompt. 
*   **High-Quality AI Responses:** Powered by OpenAI's latest models for intelligent, contextual conversations.
*   **Natural Text-to-Speech:** Uses OpenAI's TTS API for natural-sounding voice responses.
*   **Mobile Compatible:** Works seamlessly on Android and iOS devices through the browser.
*   **Proactive Greetings:** Welcomes users differently on their very first visit versus return visits, attempting to recall the user's name (if previously mentioned) by querying the memory bank.


## What I used

*   **Frontend:** React, Vite, TypeScript, Tailwind CSS
*   **AI Services**
    *   **Core LLM:** OpenAI GPT-4o-mini (configurable via environment variables)
    *   **Speech-to-Text:** OpenAI Whisper API
    *   **Text-to-Speech:** OpenAI TTS API
    *   **Embeddings (Memory):** OpenAI Embeddings API
*   **Memory:** In-browser vector storage using basic cosine similarity search 



## How It Works

1.  **Initialization:** The application initializes OpenAI services and loads the memory system.
2.  **Interaction (Voice Example):**
    *   User clicks the microphone and speaks.
    *   Audio data is captured and sent to OpenAI's Whisper API for transcription.
    *   The transcribed text is displayed on screen and prepared for the AI conversation.
3.  **Context Building:**
    *   The transcribed text is used to search the local memory (in IndexedDB) for relevant past interactions.
    *   A system prompt is constructed containing persona instructions and relevant memory excerpts.
    *   Top 5 memories are fetched, and are only fetched if they meet the minimum similarity threshold score of 0.28. If not, they get filtered out.
4.  **OpenAI Processing:**
    *   The system prompt (with context) and user message are sent to OpenAI's chat completion API.
    *   The response is streamed back in real-time, with sentences automatically sent to the TTS system as they complete.
5.  **TTS Generation:** Completed sentences are sent to OpenAI's TTS API to generate audio, which is then played back for the user to hear.
6.  **Memory Storage:** User input (transcribed text or typed text) is processed. If it's short (e.g., < 15 words), the raw text is stored directly. If longer, it's sent to the AI for summarization (64 tokens max). Then, it is converted into an embedding and stored with the 'user' role in IndexedDB for future context retrieval.


## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/callbacked/os1
    cd os1 
    ```
2.  **Install dependencies:**
    ```bash
    npm i
    ```
3.  **Set up environment variables:**
    ```bash
    cp env.example .env
    ```
    Then edit `.env` and add your OpenAI API key:
    ```
    VITE_OPENAI_API_KEY=your_openai_api_key_here
    ```
4.  **Run the development server:**
    ```bash
    npm run dev
    ```
5.  Open your browser and go to `http://localhost:5173`.

The application will now use OpenAI's APIs for all AI functionality. No model downloads are required.

## Notes

*   Ensure you have a modern browser supporting Web APIs.
*   Performance depends on your internet connection and OpenAI API response times.
*   The application requires an active OpenAI API key to function.

## Acknowledgements

This project is essentially an amalgamation of the hard work put in by these people orders of magnitude smarter than me, I would like to thank them in no particular order.

*   **Siyoung Park:** For the original MIT Licensed OS1 loading animation concept [on CodePen](https://codepen.io/psyonline/pen/yayYWg).

*   **ONNX Community:** For providing the ONNX version of all of the models used here

*   **Xenova** For their work on Transformers.js, and reference to their LLM worker code in [transformers.js-examples](https://github.com/huggingface/transformers.js-examples)

*   **Spike Jonze and the creators of the movie 'Her':** For the original inspiration. A very bleak movie to watch 12 years later lmao.


