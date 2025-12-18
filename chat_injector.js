(function() {
  // --- 1. DEFINE PROMPT INJECTOR ---
  // We make this a global function so Dart can call it easily
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

      let textarea = await waitForElement('#prompt-textarea', 15000);
      if (!textarea) textarea = document.querySelector('div[contenteditable="true"]');
      if (!textarea) textarea = document.querySelector('textarea[data-id="root"]');

      if (!textarea) {
        if (window.GenChannel) window.GenChannel.postMessage("ERROR: Input box not found.");
        return;
      }

      textarea.focus();
      
      // Handle different input types
      if (textarea.tagName === 'DIV') {
          textarea.innerHTML = promptText;
      } else {
          textarea.value = promptText;
      }

      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      
      await new Promise(r => setTimeout(r, 800));

      const sendBtn = await waitForElement('[data-testid="send-button"]', 5000);
      if (sendBtn && !sendBtn.disabled) {
         sendBtn.click();
      } else {
         const enterEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: 13 });
         textarea.dispatchEvent(enterEvent);
      }
    } catch (e) {
        if (window.GenChannel) window.GenChannel.postMessage("ERROR: " + e.toString());
    }
  };

  // --- 2. DEFINE NETWORK INTERCEPTOR & PARSER ---
  // This runs immediately to capture the response stream
  if (window.isInterceptorActive) return;
  window.isInterceptorActive = true;

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch(...args);
    const url = args[0].toString();

    // Check if this is a conversation response
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
            
            // Decode chunk and add to buffer
            const chunk = decoder.decode(value, {stream: true});
            buffer += chunk;
            
            // Process lines in buffer
            const lines = buffer.split("\n");
            // Keep the last partial line in the buffer
            buffer = lines.pop(); 

            for (const line of lines) {
              if (line.trim().startsWith("data: ")) {
                const jsonStr = line.substring(6).trim();
                if (jsonStr === "[DONE]") continue;

                try {
                  const data = JSON.parse(jsonStr);
                  let content = null;

                  // --- PARSING LOGIC (Edit this on GitHub if ChatGPT changes format) ---
                  
                  // Format A: Direct object { v: "text", p: "..." }
                  if (data.v && typeof data.v === 'string') {
                     // We accept it if it looks like content
                     content = data.v;
                  }
                  // Format B: List of patches { v: [ {op:..., v: "text"} ] }
                  else if (data.v && Array.isArray(data.v)) {
                    for (const patch of data.v) {
                       if (patch.v && typeof patch.v === 'string') {
                          content = patch.v;
                       }
                    }
                  }
                  // Format C: Standard choices (API style)
                  else if (data.choices && data.choices[0]?.delta?.content) {
                    content = data.choices[0].delta.content;
                  }

                  // Send cleaned text to Flutter
                  if (content && window.GenChannel) {
                    window.GenChannel.postMessage(content);
                  }

                } catch (err) {
                  // Ignore parsing errors for non-content lines
                }
              }
            }
          }
        } catch (err) {
          console.error("Stream Error", err);
        }
      })();
    }
    return response;
  };
})();
