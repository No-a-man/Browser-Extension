class AudioRecorder {
  constructor() {
    this.tabs = [];
    this.recordings = [];
    this.activeRecordings = new Map(); // tabId -> recording state
    this.audioContexts = new Map(); // tabId -> audio context
    this.analysers = new Map(); // tabId -> analyser
    this.animationIds = new Map(); // tabId -> animation id
    this.transcriptions = new Map(); // tabId -> transcription segments
    this.chunkTimers = new Map(); // tabId -> chunk timer
    
    // Gemini API configuration
    this.geminiApiKey = 'AIzaSyCg8OOanPeGz-_TtieiTxgV8ScE_4ueh28'; // Replace with your actual API key
    this.geminiApiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
    
    this.initializeUI();
    this.loadRecordings();
    this.discoverTabs();
  }

  initializeUI() {
    this.tabsList = document.getElementById('tabsList');
    this.recordingsList = document.getElementById('recordingsList');
    this.transcriptionContainer = document.getElementById('transcriptionContainer');
    this.transcriptionText = document.getElementById('transcriptionText');
    
    // API key button (removed since we're using hardcoded key)
    // document.querySelector('.api-key-btn').addEventListener('click', () => {
    //   this.promptForApiKey();
    // });
  }

  async discoverTabs() {
    try {
      console.log('Discovering tabs...');
      const tabs = await chrome.tabs.query({});
      console.log('Found tabs:', tabs);
      
      this.tabs = tabs.filter(tab => {
        const isValid = tab.url && 
                       tab.url.startsWith('http') && 
                       !tab.url.startsWith('chrome://') &&
                       !tab.url.startsWith('chrome-extension://') &&
                       !tab.url.startsWith('about:') &&
                       !tab.url.startsWith('moz-extension://') &&
                       !tab.url.startsWith('edge://') &&
                       !tab.url.startsWith('brave://');
        console.log(`Tab ${tab.id}: ${tab.title} - ${tab.url} - Valid: ${isValid}`);
        return isValid;
      });
      
      console.log('Filtered tabs:', this.tabs);
      this.renderTabs();
    } catch (error) {
      console.error('Error discovering tabs:', error);
      this.tabsList.innerHTML = `
        <div style="text-align: center; color: #f44336; padding: 20px;">
          <div style="margin-bottom: 10px;">❌ Error accessing tabs</div>
          <div style="font-size: 12px;">${error.message}</div>
        </div>
      `;
    }
  }

  renderTabs() {
    this.tabsList.innerHTML = '';
    
    if (this.tabs.length === 0) {
      this.tabsList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No tabs available</div>';
      return;
    }

    this.tabs.forEach(tab => {
      const tabItem = this.createTabItem(tab);
      this.tabsList.appendChild(tabItem);
    });
  }

  createTabItem(tab) {
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';
    
    const domain = new URL(tab.url).hostname;
    const isRecording = this.activeRecordings.has(tab.id);
    const recordingState = this.activeRecordings.get(tab.id);
    
    let buttonText = 'Start';
    let buttonClass = 'record-btn';
    let showPauseButton = false;
    
    if (isRecording && recordingState) {
      if (recordingState.state === 'paused') {
        buttonText = 'Resume';
        buttonClass = 'record-btn paused';
      } else if (recordingState.state === 'recording') {
        buttonText = 'Stop';
        buttonClass = 'record-btn recording';
        showPauseButton = true;
      }
    }
    
    tabItem.innerHTML = `
      <div class="tab-info">
        <div class="tab-icon">
          <img src="${tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23666"/><text x="8" y="12" font-size="10" text-anchor="middle" fill="white">🌐</text></svg>'}" 
               alt="tab icon" 
               style="width: 16px; height: 16px; border-radius: 2px;"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <span style="display: none; font-size: 14px;">🌐</span>
        </div>
        <div class="tab-details">
          <div class="tab-title">${tab.title}</div>
          <div class="tab-subtitle">${domain}</div>
        </div>
      </div>
      <div class="tab-controls">
        <div class="audio-line">
          <div class="audio-line-fill" data-tab-id="${tab.id}"></div>
        </div>
        <div class="recording-buttons">
          ${showPauseButton ? `<button class="record-btn pause-btn" data-tab-id="${tab.id}">Pause</button>` : ''}
          <button class="${buttonClass}" data-tab-id="${tab.id}">
            <div class="record-icon"></div>
            ${buttonText}
          </button>
        </div>
      </div>
    `;

    const recordBtn = tabItem.querySelector('.record-btn:not(.pause-btn)');
    const pauseBtn = tabItem.querySelector('.pause-btn');
    
    recordBtn.addEventListener('click', () => this.toggleRecording(tab.id));
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.pauseRecording(tab.id));
    }

    return tabItem;
  }

  async toggleRecording(tabId) {
    console.log('Sidepanel: Toggle recording for tab:', tabId);
    const isRecording = this.activeRecordings.has(tabId);
    const recordingState = this.activeRecordings.get(tabId);
    
    console.log('Sidepanel: Current recording state:', isRecording, recordingState);
    
    if (!isRecording) {
      // Start recording
      console.log('Sidepanel: Starting recording');
      await this.startRecording(tabId);
    } else if (recordingState && recordingState.state === 'recording') {
      // Stop recording
      console.log('Sidepanel: Stopping recording');
      await this.stopRecording(tabId);
    } else if (recordingState && recordingState.state === 'paused') {
      // Resume recording
      console.log('Sidepanel: Resuming recording');
      await this.resumeRecording(tabId);
    } else {
      // Fallback: if state is unclear, stop recording
      console.log('Sidepanel: Unclear state, stopping recording');
      await this.stopRecording(tabId);
    }
  }

     async startRecording(tabIdFromList) {
     try {
       console.log('Sidepanel: Starting recording process');
       
       // Get the currently active tab
       const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
       if (!activeTabs || activeTabs.length === 0) {
         throw new Error('No active tab found. Please open a website and try again.');
       }
       
       const activeTab = activeTabs[0];
       console.log('Sidepanel: Active tab:', activeTab.title, activeTab.url);
       
       // Enhanced validation for the active tab
       if (!activeTab.url) {
         throw new Error('No URL found for the active tab. Please refresh the page and try again.');
       }
       
       // Check if it's a Chrome internal page
       if (activeTab.url.startsWith('chrome://') || 
           activeTab.url.startsWith('chrome-extension://') || 
           activeTab.url.startsWith('about:') ||
           activeTab.url.startsWith('moz-extension://') ||
           activeTab.url.startsWith('edge://') ||
           activeTab.url.startsWith('brave://')) {
         throw new Error(`Cannot capture Chrome internal pages: ${activeTab.url}. Please navigate to a regular website (like google.com, youtube.com, etc.) and try recording again.`);
       }
       
       // Check if it's a regular website
       if (!activeTab.url.startsWith('http://') && !activeTab.url.startsWith('https://')) {
         throw new Error(`Cannot capture this type of page: ${activeTab.url}. Please navigate to a regular website and try again.`);
       }
       
       // Use the active tab ID for recording
       const currentTabId = activeTab.id;
       
       // Check if the tab is actually playing audio
       if (!activeTab.audible) {
         throw new Error('No audio detected on this tab. Please ensure audio is playing (like a video, music, or voice call) and try again.');
       }
       
       console.log('Sidepanel: Tab is audible, proceeding with capture');
       
               // Set recording state (will be properly set in setupRecording)
        this.updateTabUI(currentTabId);
       
       // Show user guidance - update button text to show capturing status
       const recordBtn = document.querySelector(`[data-tab-id="${currentTabId}"]`);
       if (recordBtn) {
         const originalText = recordBtn.textContent;
         recordBtn.textContent = 'Capturing...';
         recordBtn.disabled = true;
         
         // Store original text to restore later
         recordBtn.dataset.originalText = originalText;
       }
       
                                // Use tab capture API for specific tab audio
         console.log('Sidepanel: Attempting tab capture for specific tab audio');
         
         try {
           // First, ensure the extension is invoked by executing a script on the page
           await chrome.scripting.executeScript({
             target: { tabId: currentTabId },
             func: () => {
               console.log('Extension invoked on page for tab capture');
               // This ensures the extension is properly invoked
             }
           });
           
           // Small delay to ensure the script execution is complete
           await new Promise(resolve => setTimeout(resolve, 100));
           
           // Now attempt tab capture
           const stream = await new Promise((resolve, reject) => {
             chrome.tabCapture.capture({ 
               audio: true,
               video: false
             }, (capturedStream) => {
               console.log('Sidepanel: Tab capture callback executed');
               console.log('Sidepanel: Stream received:', capturedStream);
               
               if (chrome.runtime.lastError) {
                 console.error('Sidepanel: Tab capture error:', chrome.runtime.lastError);
                 reject(new Error(chrome.runtime.lastError.message));
                 return;
               }
               
               if (!capturedStream) {
                 reject(new Error('No audio stream available. Please ensure the tab has audio content and try again.'));
                 return;
               }
               
               console.log('Sidepanel: Tab capture successful');
               resolve(capturedStream);
             });
           });
           
           console.log('Sidepanel: Tab capture successful, setting up recording');
           this.setupRecording(currentTabId, stream);
           
           // Restore button state after successful capture
           const successBtn = document.querySelector(`[data-tab-id="${currentTabId}"]`);
           if (successBtn && successBtn.dataset.originalText) {
             successBtn.textContent = successBtn.dataset.originalText;
             successBtn.disabled = false;
             delete successBtn.dataset.originalText;
           }
         } catch (tabCaptureError) {
           console.error('Sidepanel: Tab capture failed:', tabCaptureError);
           
           let errorMessage = 'Unable to capture tab audio. ';
           if (tabCaptureError.message.includes('Extension has not been invoked')) {
             errorMessage = 'Extension not properly invoked. Please click on the YouTube tab, click the extension icon (🎤) in the toolbar, then try recording again.';
           } else if (tabCaptureError.message.includes('Cannot capture Chrome internal pages')) {
             errorMessage = tabCaptureError.message;
           } else if (tabCaptureError.message.includes('Cannot capture this type of page')) {
             errorMessage = tabCaptureError.message;
           } else if (tabCaptureError.message.includes('No audio stream available')) {
             errorMessage = 'No audio detected. Please ensure the tab has audio content (like a video, music, or voice call) and try again.';
           } else {
             errorMessage += 'Please ensure you are on a regular website with audio content and try again.';
           }
           
           this.handleRecordingError(currentTabId, errorMessage);
         }
       
     } catch (error) {
       console.error('Error starting recording:', error);
       this.handleRecordingError(tabIdFromList, error.message);
     }
   }
   
   handleRecordingError(tabId, errorMessage) {
     // Reset UI state
     if (tabId) {
       this.activeRecordings.delete(tabId);
       this.updateTabUI(tabId);
       
       // Restore button state
       const errorBtn = document.querySelector(`[data-tab-id="${tabId}"]`);
       if (errorBtn && errorBtn.dataset.originalText) {
         errorBtn.textContent = errorBtn.dataset.originalText;
         errorBtn.disabled = false;
         delete errorBtn.dataset.originalText;
       }
     }
     
     // Show user-friendly error message
     alert(`Recording error: ${errorMessage}`);
   }

       async stopRecording(tabId) {
    console.log('Sidepanel: Stopping recording for tab:', tabId);
    const recording = this.activeRecordings.get(tabId);
    console.log('Sidepanel: Recording object:', recording);
    
    if (recording && recording.mediaRecorder) {
      console.log('Sidepanel: Stopping MediaRecorder');
      try {
        recording.mediaRecorder.stop();
        console.log('Sidepanel: MediaRecorder.stop() called successfully');
      } catch (error) {
        console.error('Sidepanel: Error stopping MediaRecorder:', error);
        // Force cleanup on error
        this.cleanupRecording(tabId);
        this.activeRecordings.delete(tabId);
        this.updateTabUI(tabId);
      }
    } else {
      console.log('Sidepanel: No active recording found for tab:', tabId);
      // Force cleanup anyway
      this.cleanupRecording(tabId);
      this.activeRecordings.delete(tabId);
      this.updateTabUI(tabId);
    }
  }

  async pauseRecording(tabId) {
    console.log('Sidepanel: Pausing recording for tab:', tabId);
    const recording = this.activeRecordings.get(tabId);
    if (recording && recording.mediaRecorder) {
      try {
        recording.mediaRecorder.pause();
        console.log('Sidepanel: Recording paused successfully');
        // Update the recording state to paused
        recording.state = 'paused';
        this.activeRecordings.set(tabId, recording);
        this.updateTabUI(tabId);
      } catch (error) {
        console.error('Sidepanel: Error pausing recording:', error);
      }
    }
  }

  async resumeRecording(tabId) {
    const recording = this.activeRecordings.get(tabId);
    if (recording && recording.mediaRecorder) {
      try {
        recording.mediaRecorder.resume();
        console.log('Sidepanel: Recording resumed successfully');
        // Update the recording state to recording
        recording.state = 'recording';
        this.activeRecordings.set(tabId, recording);
        this.updateTabUI(tabId);
      } catch (error) {
        console.error('Sidepanel: Error resuming recording:', error);
      }
    }
  }

                       setupRecording(tabId, stream) {
       // Try to use WAV format if supported, fallback to WebM
       let mimeType = 'audio/wav';
       if (!MediaRecorder.isTypeSupported('audio/wav')) {
         mimeType = 'audio/webm';
         console.log('WAV not supported, using WebM format');
       }
       
       const mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
       const chunks = [];
       let chunkStartTime = Date.now();
       let currentChunk = [];

       mediaRecorder.ondataavailable = (e) => {
         chunks.push(e.data);
         currentChunk.push(e.data);
       };

      mediaRecorder.onstart = () => {
        console.log('Sidepanel: Recording started');
        this.showAudioLine(tabId, stream);
        
        // Initialize transcription for this tab
        this.transcriptions.set(tabId, []);
        this.renderTranscription(tabId);
        
                 // Start chunk timer (5 seconds)
         const chunkTimer = setInterval(async () => {
           console.log('Sidepanel: Chunk timer fired, currentChunk length:', currentChunk.length);
           if (currentChunk.length > 0) {
             console.log('Sidepanel: Processing 5s audio chunk');
             
             // Create blob from current chunk
             const chunkBlob = new Blob(currentChunk, { type: mimeType });
             const timestamp = new Date(chunkStartTime);
             console.log('Sidepanel: Created chunk blob, size:', chunkBlob.size, 'type:', mimeType);
             
             // Only transcribe if chunk is substantial enough
             if (chunkBlob.size > 1000) { // At least 1KB of audio data
               try {
                 // Transcribe the chunk
                 const transcription = await this.transcribeAudioChunk(chunkBlob, timestamp);
                 if (transcription) {
                   this.addTranscriptionSegment(tabId, transcription, timestamp);
                 }
               } catch (error) {
                 console.warn('Sidepanel: Chunk transcription failed:', error);
               }
             } else {
               console.log('Sidepanel: Chunk too small, skipping transcription');
             }
             
             // Reset for next chunk
             currentChunk = [];
             chunkStartTime = Date.now();
           } else {
             console.log('Sidepanel: No audio data in current chunk');
           }
         }, 5000); // 5 seconds
        
        this.chunkTimers.set(tabId, chunkTimer);
      };

                                                 mediaRecorder.onstop = () => {
          console.log('Sidepanel: Recording stopped, saving recording');
          this.hideAudioLine(tabId);
          
          // Process final chunk if any - but only if it has sufficient data
          if (currentChunk.length > 0) {
            const finalChunkBlob = new Blob(currentChunk, { type: mimeType });
            console.log('Sidepanel: Final chunk size:', finalChunkBlob.size, 'bytes');
            
            // Only transcribe if the final chunk is substantial enough
            if (finalChunkBlob.size > 1000) { // At least 1KB of audio data
              const finalTimestamp = new Date(chunkStartTime);
              console.log('Sidepanel: Transcribing final chunk...');
              this.transcribeAudioChunk(finalChunkBlob, finalTimestamp).then(transcription => {
                if (transcription) {
                  this.addTranscriptionSegment(tabId, transcription, finalTimestamp);
                }
              }).catch(error => {
                console.warn('Sidepanel: Final chunk transcription failed:', error);
              });
            } else {
              console.log('Sidepanel: Final chunk too small, skipping transcription');
            }
          }
          
          // Clear chunk timer
          const chunkTimer = this.chunkTimers.get(tabId);
          if (chunkTimer) {
            clearInterval(chunkTimer);
            this.chunkTimers.delete(tabId);
          }
          
          this.saveRecording(tabId, chunks);
          
          // Clear the recording state after saving
          this.activeRecordings.delete(tabId);
          this.updateTabUI(tabId);
          console.log('Sidepanel: Recording cleanup completed');
        };

            mediaRecorder.onpause = () => {
         console.log('Sidepanel: Recording paused');
         const currentRecording = this.activeRecordings.get(tabId);
         if (currentRecording) {
           currentRecording.state = 'paused';
           this.activeRecordings.set(tabId, currentRecording);
         }
         this.updateTabUI(tabId);
       };

       mediaRecorder.onresume = () => {
         console.log('Sidepanel: Recording resumed');
         const currentRecording = this.activeRecordings.get(tabId);
         if (currentRecording) {
           currentRecording.state = 'recording';
           this.activeRecordings.set(tabId, currentRecording);
         }
         this.updateTabUI(tabId);
       };

      mediaRecorder.onerror = (event) => {
        console.error('Sidepanel: Recording error:', event);
        this.cleanupRecording(tabId);
        this.activeRecordings.delete(tabId);
        this.updateTabUI(tabId);
        alert('An error occurred during recording.');
      };

                         // Store media recorder and chunks in the recording state
        this.activeRecordings.set(tabId, {
          state: 'recording',
          mediaRecorder: mediaRecorder,
          chunks: chunks,
          mimeType: mimeType
        });

       console.log('Sidepanel: Starting MediaRecorder');
       mediaRecorder.start(1000); // Request data every 1 second
       
       // Update UI after setting up recording
       this.updateTabUI(tabId);
    }

  showAudioLine(tabId, stream) {
    console.log('Sidepanel: Setting up audio line for tab:', tabId);
    
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      this.audioContexts.set(tabId, audioContext);
      this.analysers.set(tabId, analyser);
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updateLine = () => {
        const animationId = requestAnimationFrame(updateLine);
        this.animationIds.set(tabId, animationId);
        
        analyser.getByteFrequencyData(dataArray);
        
                 // Calculate average volume
         const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
         const volumePercent = Math.min((average / 128) * 100, 100);
         
                  // Update the audio line for this specific tab - use more robust selector
         const audioLineFill = document.querySelector(`.tab-item:has([data-tab-id="${tabId}"]) .audio-line-fill`) || 
                              document.querySelector(`[data-tab-id="${tabId}"] .audio-line-fill`);
         if (audioLineFill) {
           audioLineFill.style.width = `${volumePercent}%`;
         } else {
           // Try to find it by looking through all tab items
           const allTabItems = document.querySelectorAll('.tab-item');
           let found = false;
           for (const tabItem of allTabItems) {
             const tabIdElement = tabItem.querySelector('[data-tab-id]');
             if (tabIdElement && tabIdElement.getAttribute('data-tab-id') === tabId.toString()) {
               const audioLine = tabItem.querySelector('.audio-line-fill');
               if (audioLine) {
                 audioLine.style.width = `${volumePercent}%`;
                 found = true;
                 break;
               }
             }
           }
           if (!found) {
             console.warn('Sidepanel: Audio line fill element not found for tab:', tabId);
           }
         }
      };
      
      updateLine();
    } catch (error) {
      console.error('Sidepanel: Error setting up audio line:', error);
    }
  }

  hideAudioLine(tabId) {
    const animationId = this.animationIds.get(tabId);
    if (animationId) {
      cancelAnimationFrame(animationId);
      this.animationIds.delete(tabId);
    }
    
    const audioContext = this.audioContexts.get(tabId);
    if (audioContext) {
      audioContext.close();
      this.audioContexts.delete(tabId);
    }
    
    this.analysers.delete(tabId);
    
         // Reset the audio line - use robust selector
     const audioLineFill = document.querySelector(`.tab-item:has([data-tab-id="${tabId}"]) .audio-line-fill`) || 
                          document.querySelector(`[data-tab-id="${tabId}"] .audio-line-fill`);
     if (audioLineFill) {
       audioLineFill.style.width = '0%';
     } else {
       // Try to find it by looking through all tab items
       const allTabItems = document.querySelectorAll('.tab-item');
       for (const tabItem of allTabItems) {
         const tabIdElement = tabItem.querySelector('[data-tab-id]');
         if (tabIdElement && tabIdElement.getAttribute('data-tab-id') === tabId.toString()) {
           const audioLine = tabItem.querySelector('.audio-line-fill');
           if (audioLine) {
             audioLine.style.width = '0%';
             break;
           }
         }
       }
     }
  }

  cleanupRecording(tabId) {
    this.hideAudioLine(tabId);
    
    // Clear chunk timer
    const chunkTimer = this.chunkTimers.get(tabId);
    if (chunkTimer) {
      clearInterval(chunkTimer);
      this.chunkTimers.delete(tabId);
    }
    
    // Clear transcription for this tab
    this.transcriptions.delete(tabId);
    this.renderTranscription(tabId);
  }

     updateTabUI(tabId) {
     // Re-render the specific tab to update its button state
     const tab = this.tabs.find(t => t.id === tabId);
     if (tab) {
       const tabItem = this.createTabItem(tab);
       const existingTabItem = document.querySelector(`[data-tab-id="${tabId}"]`)?.closest('.tab-item');
       if (existingTabItem) {
         // Preserve the audio line state before replacing
         const currentAudioLine = existingTabItem.querySelector('.audio-line-fill');
         const currentWidth = currentAudioLine ? currentAudioLine.style.width : '0%';
         
         existingTabItem.replaceWith(tabItem);
         
         // Restore the audio line state after replacement
         const newAudioLine = tabItem.querySelector('.audio-line-fill');
         if (newAudioLine && currentWidth !== '0%') {
           newAudioLine.style.width = currentWidth;
         }
       }
     }
   }

     saveRecording(tabId, chunks) {
     console.log('Sidepanel: Saving recording for tab:', tabId, 'chunks:', chunks.length);
     
     const tab = this.tabs.find(t => t.id === tabId);
     if (!tab) {
       console.error('Sidepanel: Tab not found for recording:', tabId);
       return;
     }

                 const activeRecording = this.activeRecordings.get(tabId);
      const mimeType = activeRecording ? activeRecording.mimeType : 'audio/webm';
      const blob = new Blob(chunks, { type: mimeType });
      const recording = {
        id: Date.now() + tabId,
        title: `Recording - ${tab.title}`,
        timestamp: new Date(),
        blob: blob,
        tabId: tabId,
        domain: new URL(tab.url).hostname
      };

     console.log('Sidepanel: Created recording:', recording);
     
     this.recordings.unshift(recording);
     this.saveRecordingsToStorage();
     this.renderRecordings();
     
     console.log('Sidepanel: Total recordings:', this.recordings.length);
   }

  renderRecordings() {
    this.recordingsList.innerHTML = '';
    
    if (this.recordings.length === 0) {
      this.recordingsList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No recordings yet</div>';
      return;
    }

    this.recordings.forEach(recording => {
      const recordingItem = this.createRecordingItem(recording);
      this.recordingsList.appendChild(recordingItem);
    });
  }

  createRecordingItem(recording) {
    const recordingItem = document.createElement('div');
    recordingItem.className = 'recording-item';
    
    const timeAgo = this.getTimeAgo(recording.timestamp);
    
    recordingItem.innerHTML = `
      <div class="recording-info">
        <div class="recording-title">${recording.title}</div>
        <div class="recording-time">${timeAgo} • ${recording.domain}</div>
      </div>
      <div class="recording-actions">
        <button class="action-btn play-btn" data-recording-id="${recording.id}">Play</button>
        <button class="action-btn export-btn" data-recording-id="${recording.id}">Export</button>
        <button class="action-btn delete-btn" data-recording-id="${recording.id}">Delete</button>
      </div>
    `;

    const playBtn = recordingItem.querySelector('.play-btn');
    const exportBtn = recordingItem.querySelector('.export-btn');
    const deleteBtn = recordingItem.querySelector('.delete-btn');

    playBtn.addEventListener('click', () => this.togglePlayRecording(recording, playBtn));
    exportBtn.addEventListener('click', () => this.exportRecording(recording));
    deleteBtn.addEventListener('click', () => this.deleteRecording(recording.id));

    return recordingItem;
  }

  getTimeAgo(timestamp) {
    const now = new Date();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  }

  togglePlayRecording(recording, playBtn) {
    if (!recording.blob) {
      alert('This recording is no longer available. It may have been loaded from storage without the audio data.');
      return;
    }
    
    // Check if audio is already playing
    if (recording.audioElement) {
      if (recording.audioElement.paused) {
        // Resume playback
        recording.audioElement.play();
        playBtn.textContent = 'Pause';
        playBtn.classList.add('playing');
      } else {
        // Pause playback
        recording.audioElement.pause();
        playBtn.textContent = 'Play';
        playBtn.classList.remove('playing');
      }
      return;
    }
    
    // Start new playback
    const url = URL.createObjectURL(recording.blob);
    const audio = new Audio(url);
    recording.audioElement = audio;
    
    audio.onended = () => {
      URL.revokeObjectURL(url);
      playBtn.textContent = 'Play';
      playBtn.classList.remove('playing');
      recording.audioElement = null;
    };
    
    audio.onpause = () => {
      playBtn.textContent = 'Play';
      playBtn.classList.remove('playing');
    };
    
    audio.onplay = () => {
      playBtn.textContent = 'Pause';
      playBtn.classList.add('playing');
    };
    
    audio.play();
  }

  exportRecording(recording) {
    if (!recording.blob) {
      alert('This recording is no longer available. It may have been loaded from storage without the audio data.');
      return;
    }
    
    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recording.title}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  deleteRecording(recordingId) {
    if (confirm("Are you sure you want to delete this recording?")) {
      this.recordings = this.recordings.filter(r => r.id !== recordingId);
      this.saveRecordingsToStorage();
      this.renderRecordings();
    }
  }

  saveRecordingsToStorage() {
    console.log('Recordings saved:', this.recordings.length);
    // Convert recordings to storage format (remove blob as it can't be stored)
    const recordingsForStorage = this.recordings.map(recording => ({
      id: recording.id,
      title: recording.title,
      timestamp: recording.timestamp,
      tabId: recording.tabId,
      domain: recording.domain
      // Note: blob is not stored, it will be recreated when needed
    }));
    
    chrome.storage.local.set({ recordings: recordingsForStorage }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving recordings:', chrome.runtime.lastError);
      } else {
        console.log('Recordings saved to storage successfully');
      }
    });
  }

  // API key methods removed since we're using hardcoded key
  // loadApiKey() {
  //   chrome.storage.local.get(['geminiApiKey'], (result) => {
  //     if (result.geminiApiKey) {
  //       this.geminiApiKey = result.geminiApiKey;
  //       console.log('Gemini API key loaded');
  //     } else {
  //       // Prompt user for API key
  //       this.promptForApiKey();
  //     }
  //   });
  // }

  // promptForApiKey() {
  //   const apiKey = prompt('Please enter your Google Gemini API key to enable transcription:');
  //   if (apiKey && apiKey.trim()) {
  //     this.geminiApiKey = apiKey.trim();
  //     chrome.storage.local.set({ geminiApiKey: this.geminiApiKey }, () => {
  //       console.log('Gemini API key saved');
  //     });
  //   }
  // }

  // Utility function to convert audio buffer to WAV
  audioBufferToWav(buffer) {
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * numberOfChannels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * numberOfChannels * 2, true);
    
    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    return arrayBuffer;
  }

  async webmBlobToBase64(webmBlob) {
    try {
      console.log('Converting WebM blob directly to base64...');
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1]; // Strip `data:audio/webm;base64,`
          console.log('Direct WebM base64 conversion complete, length:', base64.length);
          resolve(base64);
        };
        reader.onerror = (error) => {
          console.error('FileReader error:', error);
          reject(error);
        };
        reader.readAsDataURL(webmBlob);
      });
    } catch (error) {
      console.error('Error converting WebM to base64:', error);
      throw error;
    }
  }

  async webmBlobToWavBase64(webmBlob) {
    try {
      console.log('Starting WebM to WAV conversion...');
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      console.log('Converting blob to array buffer...');
      const arrayBuffer = await webmBlob.arrayBuffer();
      console.log('Array buffer size:', arrayBuffer.byteLength, 'bytes');
      
      console.log('Decoding audio data...');
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      console.log('Audio buffer decoded, length:', audioBuffer.length, 'samples');
      
      console.log('Converting to WAV format...');
      // Convert to WAV
      const wav = this.audioBufferToWav(audioBuffer);
      const wavBlob = new Blob([wav], { type: 'audio/wav' });
      console.log('WAV blob created, size:', wavBlob.size, 'bytes');
      
      console.log('Converting WAV to base64...');
      // Convert WAV to base64
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1]; // Strip `data:audio/wav;base64,`
          console.log('Base64 conversion complete, length:', base64.length);
          resolve(base64);
        };
        reader.onerror = (error) => {
          console.error('FileReader error:', error);
          reject(error);
        };
        reader.readAsDataURL(wavBlob);
      });
    } catch (error) {
      console.error('Error converting WebM to WAV:', error);
      throw error;
    }
  }

  async transcribeAudioChunk(audioBlob, timestamp) {
    console.log('Transcribing audio chunk:', audioBlob.size, 'bytes');

    if (!this.geminiApiKey) {
      console.warn('No Gemini API key provided.');
      return null;
    }

    // Validate audio blob
    if (!audioBlob || audioBlob.size === 0) {
      console.warn('Invalid audio blob provided');
      return null;
    }

    try {
      // Try direct WebM base64 first (more reliable)
      console.log('Converting WebM to base64 directly...');
      let base64Audio;
      
      try {
        base64Audio = await this.webmBlobToBase64(audioBlob);
        console.log('Direct WebM base64 conversion successful, length:', base64Audio.length);
      } catch (webmError) {
        console.log('Direct WebM conversion failed, trying WAV conversion...');
        // Fallback to WAV conversion
        base64Audio = await this.webmBlobToWavBase64(audioBlob);
        console.log('WAV conversion successful, base64 length:', base64Audio.length);
      }

      // Determine the MIME type based on the conversion method used
      const mimeType = audioBlob.type || 'audio/webm';
      console.log('Using MIME type for API:', mimeType);
      
      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: "Please transcribe this audio accurately. Return only the transcribed text without any additional formatting or punctuation unless it's part of the speech."
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Audio
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 1024
        }
      };

      console.log('Sending request to Gemini API...');
      const response = await fetch(`${this.geminiApiUrl}?key=${this.geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Gemini API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', response.status, errorText);
        throw new Error(`Gemini API returned error ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('Gemini API response:', result);

      if (
        result.candidates &&
        result.candidates[0] &&
        result.candidates[0].content &&
        result.candidates[0].content.parts &&
        result.candidates[0].content.parts[0]
      ) {
        const transcription = result.candidates[0].content.parts[0].text;
        console.log('Transcription successful:', transcription);
        return transcription;
      } else {
        console.warn('No valid transcription returned from Gemini:', result);
        return null;
      }

    } catch (error) {
      console.error('Transcription error:', error);
      return null;
    }
  }

  addTranscriptionSegment(tabId, text, timestamp) {
    console.log('Sidepanel: Adding transcription segment for tab:', tabId);
    console.log('Sidepanel: Text:', text);
    console.log('Sidepanel: Timestamp:', timestamp);
    
    if (!this.transcriptions.has(tabId)) {
      this.transcriptions.set(tabId, []);
    }
    
    const segments = this.transcriptions.get(tabId);
    segments.push({
      text: text,
      timestamp: timestamp
    });
    
    console.log('Sidepanel: Total segments for tab:', segments.length);
    this.renderTranscription(tabId);
  }

  renderTranscription(tabId) {
    console.log('Sidepanel: Rendering transcription for tab:', tabId);
    console.log('Sidepanel: Transcription element:', this.transcriptionText);
    
    if (!this.transcriptions.has(tabId)) {
      console.log('Sidepanel: No transcriptions for tab, showing "No transcription available"');
      this.transcriptionText.innerHTML = '<div class="transcription-loading">No transcription available</div>';
      return;
    }

    const segments = this.transcriptions.get(tabId);
    console.log('Sidepanel: Found segments:', segments.length);
    
    if (segments.length === 0) {
      console.log('Sidepanel: No segments, showing "Waiting for transcription..."');
      this.transcriptionText.innerHTML = '<div class="transcription-loading">Waiting for transcription...</div>';
      return;
    }

    console.log('Sidepanel: Building HTML for segments...');
    const transcriptionHtml = segments.map(segment => {
      const timeStr = new Date(segment.timestamp).toLocaleTimeString();
      return `
        <div class="transcription-segment">
          <div class="transcription-timestamp">${timeStr}</div>
          <div class="transcription-content">${segment.text}</div>
        </div>
      `;
    }).join('');

    console.log('Sidepanel: Setting innerHTML with transcription HTML');
    this.transcriptionText.innerHTML = transcriptionHtml;
    
    // Auto-scroll to bottom
    this.transcriptionContainer.scrollTop = this.transcriptionContainer.scrollHeight;
    console.log('Sidepanel: Transcription rendering complete');
  }

  loadRecordings() {
    chrome.storage.local.get(['recordings'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading recordings:', chrome.runtime.lastError);
        this.renderRecordings();
        return;
      }
      
      if (result.recordings) {
        // Convert storage format back to recording objects
        this.recordings = result.recordings.map(recording => ({
          ...recording,
          blob: null // Blob will be null for loaded recordings
        }));
        console.log('Recordings loaded from storage:', this.recordings.length);
      }
      
      this.renderRecordings();
    });
  }



}

// Initialize the extension
document.addEventListener('DOMContentLoaded', () => {
  new AudioRecorder();
});