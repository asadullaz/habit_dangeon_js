(function() {
  // --- 1. PROMPT INJECTION LOGIC ---
  // This function is called by the Flutter app to insert text and press send
  window.submitGPTPrompt = async function(promptText) {
    try {
      async function waitForElement(selector, timeout = 20000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const el = document.querySelector(selector);
          if (el) return el;
          await new Promise(r => setTimeout(r, 500));
        }
        return null;
      }

      // Find the input area (Trying multiple selectors for robustness)
      let textarea = await waitForElement('#prompt-textarea', 15000);
      if (!textarea) textarea = document.querySelector('div[contenteditable="true"]');
      if (!textarea) textarea = document.querySelector('textarea[data-id="root"]');

      if (!textarea) {
        if (window.GenChannel) window.GenChannel.postMessage("ERROR: Input box not found.");
        return;
      }

      textarea.focus();

      // Insert text based on element type
      if (textarea.tagName === 'DIV') {
          textarea.innerHTML = promptText;
      } else {
          textarea.value = promptText;
      }

      // Dispatch events to trigger UI updates (React state changes)
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Short wait for UI to register input
      await new Promise(r => setTimeout(r, 800));

      // Find and click the send button
      const sendBtn = await waitForElement('[data-testid="send-button"]', 5000);
      if (sendBtn && !sendBtn.disabled) {
         sendBtn.click();
      } else {
         // Fallback: Press Enter
         const enterEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: 13 });
         textarea.dispatchEvent(enterEvent);
      }
    } catch (e) {
        if (window.GenChannel) window.GenChannel.postMessage("ERROR: " + e.toString());
    }
  };

  // --- 2. NETWORK INTERCEPTOR & PARSER ---
  // This intercepts the response stream to parse JSON in real-time
  
  if (window.isInterceptorActive) return;
  window.isInterceptorActive = true;

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch(...args);
    const url = args[0].toString();

    // Intercept only conversation streams
    if (url.includes("/conversation")) {
      const clone = response.clone();
      const reader = clone.body.getReader();
      const decoder = new TextDecoder();

      (async () => {
        try {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (window.GenChannel) window.GenChannel.postMessage("[DONE]");
              break;
            }
            
            // Decode chunk
            const chunk = decoder.decode(value, {stream: true});
            buffer += chunk;
            
            // Process complete lines
            const lines = buffer.split("\n");
            buffer = lines.pop(); // Keep the last incomplete line in buffer

            for (const line of lines) {
              if (line.trim().startsWith("data: ")) {
                const jsonStr = line.substring(6).trim();
                if (jsonStr === "[DONE]") continue;

                try {
                  const data = JSON.parse(jsonStr);
                  let content = null;

                  // --- FILTER LOGIC ---
                  // Ignored paths to prevent status/metadata from leaking into text
                  const isIgnoredPath = (p) => {
                    if (!p) return false;
                    return p.includes("/status") || 
                           p.includes("/end_turn") || 
                           p.includes("/metadata") || 
                           p.includes("/create_time") ||
                           p.includes("/weight") ||
                           p.includes("/recipient");
                  };

                  // Format 1: Direct Object { v: "text", p: "..." }
                  if (data.v && typeof data.v === 'string') {
                     if (!isIgnoredPath(data.p)) {
                        content = data.v;
                     }
                  }
                  // Format 2: Array of Patches { v: [ {op:..., v: "text", p: "..."} ] }
                  else if (data.v && Array.isArray(data.v)) {
                    for (const patch of data.v) {
                       if (patch.v && typeof patch.v === 'string' && !isIgnoredPath(patch.p)) {
                          content = patch.v;
                       }
                    }
                  }
                  // Format 3: Standard Choices { choices: [ { delta: { content: "text" } } ] }
                  else if (data.choices && data.choices[0]?.delta?.content) {
                     content = data.choices[0].delta.content; 
                  }

                  // Send ONLY valid content to Flutter
                  if (content && window.GenChannel) { 
                    window.GenChannel.postMessage(content); 
                  }

                } catch (err) {
                  // Ignore parse errors for keep-alive or malformed lines
                }
              }
            }
          }
        } catch (err) {
          console.error("Stream Interceptor Error:", err);
        }
      })();
    }
    return response;
  };
})();
