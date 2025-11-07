/**
 * Helper functions for converting between OpenAI message format and Gemini format
 */

export interface GeminiMessage {
  role: 'user' | 'model' | 'function';
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any; functionCallId?: string }>;
}

/**
 * Convert OpenAI-style messages to Gemini format
 */
export function convertMessagesToGemini(messages: any[]): GeminiMessage[] {
  const geminiMessages: GeminiMessage[] = [];
  const pendingToolCallIds = new Set<string>();
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      // System messages are handled via systemInstruction in Gemini
      continue;
    }
    
    if (msg.role === 'user') {
      geminiMessages.push({
        role: 'user',
        parts: [{ text: msg.content }],
      });
    } else if (msg.role === 'assistant') {
      const parts: any[] = [];
      
      // Add text content if present
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      
      // Add function calls if present (from OpenAI format or metadata)
      if (msg.tool_calls) {
        for (const toolCall of msg.tool_calls) {
          // Handle OpenAI format: { function: { name, arguments } }
          if (toolCall.function) {
            parts.push({
              functionCall: {
                id: toolCall.id,
                name: toolCall.function.name,
                args: JSON.parse(toolCall.function.arguments),
              },
            });
            if (toolCall.id) {
              pendingToolCallIds.add(toolCall.id);
            }
          } 
          // Handle metadata format: { name, args }
          else if (toolCall.name && toolCall.args) {
            parts.push({
              functionCall: {
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.args,
              },
            });
            if (toolCall.id) {
              pendingToolCallIds.add(toolCall.id);
            }
          }
        }
      }
      
      geminiMessages.push({
        role: 'model',
        parts,
      });
    } else if (msg.role === 'tool') {
      // Only forward tool messages that have a matching tool_call_id
      if (!msg.tool_call_id) {
        console.warn('[convertMessagesToGemini] Skipping tool message without tool_call_id:', msg.name || msg.tool_name);
        continue;
      }

      if (!pendingToolCallIds.has(msg.tool_call_id)) {
        console.warn('[convertMessagesToGemini] Skipping tool message with unknown tool_call_id:', msg.tool_call_id);
        continue;
      }

      let parsedContent: any = {};
      if (typeof msg.content === 'string' && msg.content.trim().length > 0) {
        try {
          parsedContent = JSON.parse(msg.content);
        } catch (parseError) {
          console.warn('[convertMessagesToGemini] Failed to parse tool content as JSON, preserving raw string.', parseError);
          parsedContent = { raw: msg.content };
        }
      }

      // Convert tool results to function responses
      geminiMessages.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.name || msg.tool_name,
              response: parsedContent,
            },
            functionCallId: msg.tool_call_id,
          },
        ],
      });

      pendingToolCallIds.delete(msg.tool_call_id);
    }
  }
  
  return geminiMessages;
}

/**
 * Extract function calls from Gemini response
 */
export function extractFunctionCalls(geminiResponse: any): Array<{ id: string; name: string; args: any }> {
  const functionCalls: Array<{ id: string; name: string; args: any }> = [];
  
  console.log('[extractFunctionCalls] Checking response structure...');
  console.log('[extractFunctionCalls] Response keys:', Object.keys(geminiResponse || {}));
  console.log('[extractFunctionCalls] Response type:', typeof geminiResponse);
  
  // Try multiple response formats
  // Format 1: candidates[0].content.parts
  if (geminiResponse.candidates?.[0]?.content?.parts) {
    console.log('[extractFunctionCalls] Found parts in candidates[0].content.parts:', geminiResponse.candidates[0].content.parts.length);
    for (const part of geminiResponse.candidates[0].content.parts) {
      console.log('[extractFunctionCalls] Part keys:', Object.keys(part || {}));
      if (part.functionCall) {
        console.log('[extractFunctionCalls] Found functionCall:', part.functionCall);
        functionCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
  }
  
  // Format 2: Direct response object with functionCalls
  if (geminiResponse.functionCalls) {
    console.log('[extractFunctionCalls] Found functionCalls in response:', geminiResponse.functionCalls.length);
    for (const fc of geminiResponse.functionCalls) {
      functionCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        name: fc.name,
        args: fc.args || {},
      });
    }
  }
  
  // Format 3: Check if response has a response property
  if (geminiResponse.response?.candidates?.[0]?.content?.parts) {
    console.log('[extractFunctionCalls] Found parts in response.candidates[0].content.parts');
    for (const part of geminiResponse.response.candidates[0].content.parts) {
      if (part.functionCall) {
        functionCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
  }
  
  if (functionCalls.length === 0) {
    console.log('[extractFunctionCalls] No function calls found in any format');
    console.log('[extractFunctionCalls] Full response (first 2000 chars):', JSON.stringify(geminiResponse, null, 2).substring(0, 2000));
  }
  
  return functionCalls;
}

/**
 * Get text content from Gemini response
 */
export function getGeminiText(geminiResponse: any): string {
  // Try multiple response formats
  if (geminiResponse.text) {
    return geminiResponse.text;
  }
  
  if (geminiResponse.candidates?.[0]?.content?.parts) {
    const textParts = geminiResponse.candidates[0].content.parts
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join('');
    return textParts;
  }
  
  // Try direct text property
  if (geminiResponse.candidates?.[0]?.text) {
    return geminiResponse.candidates[0].text;
  }
  
  return '';
}

