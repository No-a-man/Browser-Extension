// Content script to ensure extension is invoked on web pages
console.log('Audio Recorder Extension: Content script loaded on', window.location.href);

// This ensures the extension is properly invoked on the page
// which is required for tabCapture to work
document.addEventListener('DOMContentLoaded', () => {
  console.log('Audio Recorder Extension: Page ready for capture');
});

// Also listen for when the page is fully loaded
window.addEventListener('load', () => {
  console.log('Audio Recorder Extension: Page fully loaded and ready for capture');
});

// Listen for messages from the sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script: Received message:', request);
  
  if (request.action === 'prepareForCapture') {
    console.log('Content script: Preparing page for capture');
    
    // Ensure the page is ready for capture
    if (document.readyState === 'complete') {
      console.log('Content script: Page is ready for capture');
      sendResponse({ success: true, ready: true, url: window.location.href });
    } else {
      console.log('Content script: Page not fully loaded, waiting...');
      window.addEventListener('load', () => {
        console.log('Content script: Page now ready for capture');
        sendResponse({ success: true, ready: true, url: window.location.href });
      });
    }
  }
  
  return true; // Keep the message channel open for async response
});

// Notify that content script is ready
console.log('Audio Recorder Extension: Content script initialized and ready');
