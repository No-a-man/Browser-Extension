chrome.runtime.onInstalled.addListener(() => {
  console.log("TwinMind Transcriber Extension Installed");
});

// Listen for messages from the sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background: Received message:', request);
  
  if (request.action === 'injectContentScript') {
    console.log('Background: Injecting content script into tab:', request.tabId);
    
    chrome.scripting.executeScript({
      target: { tabId: request.tabId },
      files: ['src/content.js']
    }).then(() => {
      console.log('Background: Content script injected successfully');
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Background: Failed to inject content script:', error);
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Keep the message channel open for async response
  }
});

// Inject content script when tabs are updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && 
      tab.url.startsWith('http') && 
      !tab.url.startsWith('chrome://') &&
      !tab.url.startsWith('chrome-extension://')) {
    
    console.log('Background: Tab updated, injecting content script:', tab.url);
    
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['src/content.js']
    }).then(() => {
      console.log('Background: Content script auto-injected into tab:', tabId);
    }).catch((error) => {
      console.warn('Background: Could not auto-inject content script:', error);
    });
  }
});
