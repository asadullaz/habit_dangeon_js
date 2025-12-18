(async function() {
  // Helper to wait for elements to appear in the DOM
  async function waitForElement(selector, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  try {
    // 1. Attempt to find the input text area
    // Selectors are updated for ChatGPT's late 2024/2025 DOM
    let textarea = await waitForElement('#prompt-textarea', 15000);
    
    // Fallback selectors if the ID changes
    if (!textarea) textarea = document.querySelector('div[contenteditable="true"]');
    if (!textarea) textarea = document.querySelector('textarea[data-id="root"]');

    if (!textarea) {
      // Notify the app that the DOM has changed significantly
      if (window.GenChannel) {
        window.GenChannel.postMessage("ERROR: Input box not found (Timeout). DOM might have changed.");
      }
      return;
    }

    // 2. Focus and clear existing text (if any)
    textarea.focus();
    
    // 3. Insert the prompt
    // 'PROMPT_PLACEHOLDER' is replaced by the Dart app before injection
    const promptText = "PROMPT_PLACEHOLDER";
    
    // Use innerHTML for contenteditable divs, value for textareas
    if (textarea.tagName === 'DIV') {
        textarea.innerHTML = promptText;
    } else {
        textarea.value = promptText;
    }

    // 4. Trigger React/Framework events so the UI knows text changed
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Small delay to let the UI update the "Send" button state
    await new Promise(r => setTimeout(r, 800));

    // 5. Click the Send Button
    const sendBtn = await waitForElement('[data-testid="send-button"]', 5000);
    
    if (sendBtn && !sendBtn.disabled) {
       sendBtn.click();
    } else {
       // Fallback: Simulate "Enter" key press
       const enterEvent = new KeyboardEvent('keydown', {
         bubbles: true,
         cancelable: true,
         key: 'Enter',
         code: 'Enter',
         keyCode: 13
       });
       textarea.dispatchEvent(enterEvent);
    }

  } catch (e) {
      if (window.GenChannel) {
        window.GenChannel.postMessage("ERROR: Script execution failed - " + e.toString());
      }
  }
})();
