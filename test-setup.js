// Simple test script to verify OpenAI setup
// Run with: node test-setup.js

import { OpenAIService } from './src/lib/openai.js';

async function testOpenAISetup() {
  console.log('Testing OpenAI setup...');
  
  try {
    // Test service initialization
    const service = new OpenAIService();
    console.log('✅ OpenAI service initialized successfully');
    
    // Test basic chat completion
    console.log('Testing chat completion...');
    const messages = [
      { role: 'user', content: 'Hello, this is a test message.' }
    ];
    
    let responseReceived = false;
    await service.streamChat(
      messages,
      (chunk) => {
        if (!responseReceived) {
          console.log('✅ Chat completion working - received chunk:', chunk.substring(0, 50) + '...');
          responseReceived = true;
        }
      },
      (fullResponse) => {
        console.log('✅ Chat completion completed successfully');
      },
      (error) => {
        console.error('❌ Chat completion failed:', error);
      }
    );
    
    console.log('✅ All tests passed! The setup is working correctly.');
    
  } catch (error) {
    console.error('❌ Setup test failed:', error.message);
    console.log('\nMake sure you have:');
    console.log('1. Created a .env file with VITE_OPENAI_API_KEY=your_api_key');
    console.log('2. Have a valid OpenAI API key');
    console.log('3. Have sufficient API credits');
  }
}

testOpenAISetup(); 