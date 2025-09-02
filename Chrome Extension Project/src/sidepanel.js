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
    this.geminiApiKey = 'AIzaSyCg8OOanPeGz-_TtieiTxgV8ScE_4ueh28';
    this.geminiApiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
    
    // Transcription queue management
    this.transcriptionQueue = [];
    this.isProcessingQueue = false;
    this.lastTranscriptionTime = 0;
    
    // Audio conversion management
    this.audioConversionContexts = [];
    
    // Recording duration management
    this.durationTimers = new Map(); // tabId -> duration timer
    this.recordingStartTimes = new Map(); // tabId -> recording start time
    
    this.initializeUI();
    this.loadRecordings();
    this.discoverTabs();
    
    // Periodic cleanup of audio contexts
    setInterval(() => {
      this.cleanupAudioContexts();
    }, 30000); // Clean up every 30 seconds
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
          ${tab.favIconUrl ? 
            `<img src="${tab.favIconUrl}" alt="tab icon" style="width: 16px; height: 16px; border-radius: 2px; object-fit: contain;">` : 
            ''
          }
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
        <div class="recording-info">
          ${isRecording ? `<div class="recording-duration" data-tab-id="${tab.id}">0:00</div>` : ''}
          <div class="recording-buttons">
            ${showPauseButton ? `<button class="record-btn pause-btn" data-tab-id="${tab.id}">Pause</button>` : ''}
            <button class="${buttonClass}" data-tab-id="${tab.id}">
              <div class="record-icon"></div>
              ${buttonText}
            </button>
          </div>
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
             errorMessage = 'Extension not properly invoked. Please click on the YouTube tab, click the extension icon in the toolbar, then try recording again.';
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
        
        // Pause duration timer (but keep start time for resume)
        const durationTimer = this.durationTimers.get(tabId);
        if (durationTimer) {
          clearInterval(durationTimer);
          this.durationTimers.delete(tabId);
        }
        // Note: We keep the recordingStartTime so resume can work correctly
        
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
        
        // Resume duration timer using stored start time
        const storedStartTime = this.recordingStartTimes.get(tabId);
        if (storedStartTime) {
          const durationTimer = setInterval(() => {
            const duration = Date.now() - storedStartTime;
            this.updateRecordingDuration(tabId, duration);
          }, 1000);
          this.durationTimers.set(tabId, durationTimer);
        }
        
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
        
        // Get initial video timestamp
        this.getVideoTimestamp(tabId).then(initialTime => {
          console.log('Sidepanel: Initial video timestamp:', initialTime);
        });
        
        // Start recording duration timer
        const recordingStartTime = Date.now();
        const durationTimer = setInterval(() => {
          const duration = Date.now() - recordingStartTime;
          this.updateRecordingDuration(tabId, duration);
        }, 1000); // Update every second
        
        // Store duration timer and start time
        this.durationTimers.set(tabId, durationTimer);
        this.recordingStartTimes.set(tabId, recordingStartTime);
        
        // Start chunk timer (5 seconds)
        const chunkTimer = setInterval(async () => {
          console.log('Sidepanel: Chunk timer fired, currentChunk length:', currentChunk.length);
          if (currentChunk.length > 0) {
            console.log('Sidepanel: Processing 5s audio chunk');
            
            // Create blob from current chunk
            const chunkBlob = new Blob(currentChunk, { type: mimeType });
            
            // Get current video timestamp for this chunk
            const videoTimestamp = await this.getVideoTimestamp(tabId);
            const timestamp = {
              systemTime: new Date(chunkStartTime),
              videoTime: videoTimestamp
            };
            
            console.log('Sidepanel: Created chunk blob, size:', chunkBlob.size, 'type:', mimeType, 'video time:', videoTimestamp);
            
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

                                                 mediaRecorder.onstop = async () => {
          console.log('Sidepanel: Recording stopped, saving recording');
          this.hideAudioLine(tabId);
          
          // Process final chunk if any - but only if it has sufficient data
          if (currentChunk.length > 0) {
            const finalChunkBlob = new Blob(currentChunk, { type: mimeType });
            console.log('Sidepanel: Final chunk size:', finalChunkBlob.size, 'bytes');
            
            // Only transcribe if the final chunk is substantial enough
            if (finalChunkBlob.size > 1000) { // At least 1KB of audio data
              // Get final video timestamp
              const finalVideoTimestamp = await this.getVideoTimestamp(tabId);
              const finalTimestamp = {
                systemTime: new Date(chunkStartTime),
                videoTime: finalVideoTimestamp
              };
              console.log('Sidepanel: Transcribing final chunk at video time:', finalVideoTimestamp);
              try {
                const transcription = await this.transcribeAudioChunk(finalChunkBlob, finalTimestamp);
                if (transcription) {
                  this.addTranscriptionSegment(tabId, transcription, finalTimestamp);
                }
              } catch (error) {
                console.warn('Sidepanel: Final chunk transcription failed:', error);
              }
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
          
          // Clear duration timer
          const durationTimer = this.durationTimers.get(tabId);
          if (durationTimer) {
            clearInterval(durationTimer);
            this.durationTimers.delete(tabId);
          }
          
          // Clear recording start time
          this.recordingStartTimes.delete(tabId);
          
          // Immediately stop all pending transcriptions for this tab
          this.stopTranscriptionForTab(tabId);
          
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

       updateRecordingDuration(tabId, duration) {
    // Find the duration display element for this tab
    const durationElement = document.querySelector(`[data-tab-id="${tabId}"] .recording-duration`);
    if (durationElement) {
      const formattedDuration = this.formatDuration(duration);
      durationElement.textContent = formattedDuration;
      console.log(`Updated duration for tab ${tabId}: ${formattedDuration}`);
    } else {
      // If element not found, try to find it by looking through all tab items
      const allTabItems = document.querySelectorAll('.tab-item');
      for (const tabItem of allTabItems) {
        const tabIdElement = tabItem.querySelector('[data-tab-id]');
        if (tabIdElement && tabIdElement.getAttribute('data-tab-id') === tabId.toString()) {
          const durationEl = tabItem.querySelector('.recording-duration');
          if (durationEl) {
            const formattedDuration = this.formatDuration(duration);
            durationEl.textContent = formattedDuration;
            console.log(`Updated duration for tab ${tabId} (found via search): ${formattedDuration}`);
            return;
          }
        }
      }
      console.warn(`Duration element not found for tab ${tabId} after search`);
    }
  }

  formatDuration(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  getCurrentRecordingDuration(tabId) {
    const durationElement = document.querySelector(`[data-tab-id="${tabId}"] .recording-duration`);
    if (durationElement) {
      const durationText = durationElement.textContent;
      const [minutes, seconds] = durationText.split(':').map(Number);
      return minutes * 60 + seconds;
    }
    return 0;
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
     
     // Create recording with proper timestamp
     const recording = {
       id: Date.now() + tabId,
       title: `Recording - ${typeof tab.title === 'string' ? tab.title : 'Unknown Tab'}`,
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
    
    // Use proper timestamp formatting instead of relative time
    const formattedTimestamp = this.formatTimestamp(recording.timestamp);
    
    // Ensure title is always a string
    const safeTitle = typeof recording.title === 'string' ? recording.title : 'Recording - Unknown Tab';
    
    // Ensure domain is always a string
    const safeDomain = typeof recording.domain === 'string' ? recording.domain : 'Unknown Domain';
    
    recordingItem.innerHTML = `
      <div class="recording-info">
        <div class="recording-title">${safeTitle}</div>
        <div class="recording-time">${formattedTimestamp} - ${safeDomain}</div>
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

  formatTimestamp(timestamp) {
    return timestamp.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
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
    // Get transcription for this recording
    const tabId = recording.tabId;
    let transcriptionSegments = this.transcriptions.get(tabId) || [];
    
    // If no transcription found by tabId, try to find by recording ID or search all transcriptions
    if (transcriptionSegments.length === 0) {
      // Search through all transcriptions to find matching ones
      for (const [storedTabId, segments] of this.transcriptions.entries()) {
        if (segments && segments.length > 0) {
          // Check if any segment has a timestamp close to the recording timestamp
          const recordingTime = recording.timestamp.getTime();
          const hasMatchingTime = segments.some(segment => {
            const segmentTime = new Date(segment.timestamp).getTime();
            const timeDiff = Math.abs(recordingTime - segmentTime);
            return timeDiff < 60000; // Within 1 minute
          });
          
          if (hasMatchingTime) {
            transcriptionSegments = segments;
            break;
          }
        }
      }
    }
    
    if (transcriptionSegments.length === 0) {
      alert('No transcription available for this recording. Please ensure the recording has been transcribed.');
      return;
    }
    
    // Combine all transcription segments into one text with timestamps
    const fullTranscription = transcriptionSegments
      .map(segment => {
        let timestamp;
        if (segment.timestamp && typeof segment.timestamp === 'object' && segment.timestamp.videoTime !== undefined) {
          const videoTime = segment.timestamp.videoTime;
          const minutes = Math.floor(videoTime / 60);
          const seconds = videoTime % 60;
          timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else if (segment.timestamp) {
          timestamp = new Date(segment.timestamp).toLocaleTimeString();
        } else {
          timestamp = 'Unknown time';
        }
        return `[${timestamp}] ${segment.text}`;
      })
      .join('\n\n');
    
    // Create and download transcription file
    const blob = new Blob([fullTranscription], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recording.title}-transcription-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  deleteRecording(recordingId) {
    if (confirm("Are you sure you want to delete this recording?")) {
      const recording = this.recordings.find(r => r.id === recordingId);
      if (recording) {
        // Clean up transcriptions for this recording
        this.transcriptions.delete(recording.tabId);
      }
      
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
    
    // Save transcriptions along with recordings
    const transcriptionsForStorage = {};
    for (const [tabId, segments] of this.transcriptions.entries()) {
      transcriptionsForStorage[tabId] = segments;
    }
    
    chrome.storage.local.set({ 
      recordings: recordingsForStorage,
      transcriptions: transcriptionsForStorage
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving recordings and transcriptions:', chrome.runtime.lastError);
      } else {
        console.log('Recordings and transcriptions saved to storage successfully');
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
      
      // Validate input
      if (!webmBlob || webmBlob.size === 0) {
        throw new Error('Invalid audio blob provided');
      }
      
      // Try to get an existing audio context or create a new one
      let audioCtx = this.getOrCreateAudioContext();
      if (!audioCtx) {
        throw new Error('Failed to create audio context');
      }
      
      try {
        console.log('Converting blob to array buffer...');
        const arrayBuffer = await webmBlob.arrayBuffer();
        console.log('Array buffer size:', arrayBuffer.byteLength, 'bytes');
        
        if (arrayBuffer.byteLength === 0) {
          throw new Error('Empty array buffer');
        }
        
        console.log('Decoding audio data...');
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        console.log('Audio buffer decoded, length:', audioBuffer.length, 'samples');
        
        if (audioBuffer.length === 0) {
          throw new Error('Empty audio buffer');
        }
        
        console.log('Converting to WAV format...');
        // Convert to WAV
        const wav = this.audioBufferToWav(audioBuffer);
        const wavBlob = new Blob([wav], { type: 'audio/wav' });
        console.log('WAV blob created, size:', wavBlob.size, 'bytes');
        
        if (wavBlob.size === 0) {
          throw new Error('Empty WAV blob');
        }
        
        console.log('Converting WAV to base64...');
        // Convert WAV to base64
        const base64 = await this.blobToBase64(wavBlob);
        console.log('Base64 conversion complete, length:', base64.length);
        
        return base64;
        
      } catch (error) {
        // If decoding fails, mark this context as problematic and try with a new one
        console.warn('Audio context decoding failed, will try with new context:', error.message);
        this.markAudioContextAsFailed(audioCtx);
        throw error;
      }
      
    } catch (error) {
      console.error('Error converting WebM to WAV:', error);
      
      // Try fallback: direct WebM to base64 if WAV conversion fails
      console.log('Trying fallback WebM to base64 conversion...');
      try {
        const base64 = await this.blobToBase64(webmBlob);
        console.log('Fallback conversion successful, length:', base64.length);
        return base64;
      } catch (fallbackError) {
        console.error('Fallback conversion also failed:', fallbackError);
        throw new Error(`Audio conversion failed: ${error.message}. Fallback also failed: ${fallbackError.message}`);
      }
    }
  }

  getOrCreateAudioContext() {
    // Try to find an available audio context
    for (let i = 0; i < this.audioConversionContexts.length; i++) {
      const ctx = this.audioConversionContexts[i];
      if (ctx && ctx.state === 'running') {
        console.log('Reusing existing audio context');
        return ctx;
      }
    }
    
    // Create a new audio context if none available
    try {
      console.log('Creating new audio context');
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.audioConversionContexts.push(audioCtx);
      return audioCtx;
    } catch (error) {
      console.error('Failed to create audio context:', error);
      return null;
    }
  }

  markAudioContextAsFailed(audioCtx) {
    // Remove failed audio context from the list
    const index = this.audioConversionContexts.indexOf(audioCtx);
    if (index > -1) {
      this.audioConversionContexts.splice(index, 1);
      console.log('Removed failed audio context');
    }
    
    // Try to close it gracefully
    if (audioCtx && audioCtx.state !== 'closed') {
      try {
        audioCtx.close();
      } catch (error) {
        console.warn('Error closing failed audio context:', error);
      }
    }
  }

  async getVideoTimestamp(tabId) {
    try {
      // Inject script to get current video time
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // Try to find video elements and get current time
          const videos = document.querySelectorAll('video');
          if (videos.length > 0) {
            // Use the first video found (usually the main one)
            const video = videos[0];
            if (video.currentTime !== undefined && !isNaN(video.currentTime)) {
              return Math.floor(video.currentTime);
            }
          }
          
          // Try YouTube specific selectors
          const youtubePlayer = document.querySelector('.html5-video-player video');
          if (youtubePlayer && youtubePlayer.currentTime !== undefined) {
            return Math.floor(youtubePlayer.currentTime);
          }
          
          // Try other common video players
          const videoPlayers = document.querySelectorAll('[data-video-time], .video-player video, .player video');
          for (const player of videoPlayers) {
            if (player.currentTime !== undefined && !isNaN(player.currentTime)) {
              return Math.floor(player.currentTime);
            }
          }
          
          // If no video found, return 0
          return 0;
        }
      });
      
      if (results && results[0] && results[0].result !== undefined) {
        const videoTime = results[0].result;
        console.log('Sidepanel: Retrieved video timestamp:', videoTime);
        return videoTime;
      }
      
      return 0;
    } catch (error) {
      console.warn('Sidepanel: Failed to get video timestamp:', error);
      return 0;
    }
  }

  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const base64 = reader.result.split(',')[1]; // Strip data URL prefix
          if (!base64) {
            reject(new Error('Failed to extract base64 data'));
            return;
          }
          resolve(base64);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(error);
      };
      reader.readAsDataURL(blob);
    });
  }

  cleanupAudioContexts() {
    // Clean up any lingering audio contexts
    this.audioConversionContexts.forEach(async (ctx) => {
      if (ctx && ctx.state !== 'closed') {
        try {
          await ctx.close();
        } catch (error) {
          console.warn('Error closing audio context:', error);
        }
      }
    });
    this.audioConversionContexts = [];
    console.log('Audio contexts cleaned up');
  }

  async cleanupAndRetryAudioConversion(audioBlob, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`Audio conversion attempt ${attempt + 1}/${maxRetries}`);
        
        // Clean up contexts before retry
        if (attempt > 0) {
          this.cleanupAudioContexts();
          // Wait a bit before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return await this.webmBlobToWavBase64(audioBlob);
      } catch (error) {
        console.warn(`Audio conversion attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt === maxRetries - 1) {
          throw error; // Last attempt failed
        }
      }
    }
  }

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

  async transcribeAudioChunk(audioBlob, timestamp, retryCount = 0) {
    if (!this.geminiApiKey || !audioBlob?.size) return null;

    // Add to queue instead of processing immediately
    return new Promise((resolve) => {
      this.transcriptionQueue.push({
        audioBlob,
        timestamp,
        retryCount,
        resolve
      });
      
      // Start processing queue if not already running
      if (!this.isProcessingQueue) {
        this.processTranscriptionQueue();
      }
    });
  }

  async processTranscriptionQueue() {
    if (this.isProcessingQueue || this.transcriptionQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    console.log(`Processing transcription queue, ${this.transcriptionQueue.length} items pending`);

    while (this.transcriptionQueue.length > 0) {
      const item = this.transcriptionQueue.shift();
      
      try {
        // Add delay to prevent rate limiting (wait 1 second between calls)
        if (this.lastTranscriptionTime) {
          const timeSinceLastCall = Date.now() - this.lastTranscriptionTime;
          if (timeSinceLastCall < 1000) {
            const delay = 1000 - timeSinceLastCall;
            console.log(`Rate limiting: waiting ${delay}ms before next API call`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        this.lastTranscriptionTime = Date.now();

        // Convert audio chunk to base64 with retry mechanism
        let base64Audio, mimeType;
        try {
          const base64Wav = await this.cleanupAndRetryAudioConversion(item.audioBlob);
          base64Audio = base64Wav;
          mimeType = "audio/wav";
          console.log('Using WAV format for transcription');
        } catch (conversionError) {
          console.warn('WAV conversion failed after retries, using original format:', conversionError.message);
          // If WAV conversion fails, try to use the original blob directly
          try {
            base64Audio = await this.blobToBase64(item.audioBlob);
            mimeType = item.audioBlob.type || "audio/webm";
            console.log('Using original format for transcription:', mimeType);
          } catch (fallbackError) {
            console.error('All audio conversion methods failed:', fallbackError);
            item.resolve(null);
            continue;
          }
        }
        
        const requestBody = {
          contents: [{
            parts: [
              { text: "Generate a transcript of this audio." },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Audio
                }
              }
            ]
          }],
          generationConfig: { temperature: 0.1, topK: 1, topP: 1, maxOutputTokens: 1024 }
        };

        console.log(`Sending request to Gemini API... (attempt ${item.retryCount + 1})`);
        const res = await fetch(`${this.geminiApiUrl}?key=${this.geminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });

        if (!res.ok) {
          const msg = await res.text();
          console.error("Gemini API error:", res.status, msg);
          
          // Handle specific error cases with retry logic
          if (res.status === 429 && item.retryCount < 2) {
            console.warn("Rate limit exceeded, waiting before retry...");
            // Wait longer for rate limit errors
            await new Promise(resolve => setTimeout(resolve, 2000 * (item.retryCount + 1)));
            // Re-add to queue for retry
            this.transcriptionQueue.unshift({
              ...item,
              retryCount: item.retryCount + 1
            });
            continue;
          }
          
          if (res.status >= 500 && item.retryCount < 2) {
            console.warn("Server error, retrying...");
            await new Promise(resolve => setTimeout(resolve, 1000 * (item.retryCount + 1)));
            // Re-add to queue for retry
            this.transcriptionQueue.unshift({
              ...item,
              retryCount: item.retryCount + 1
            });
            continue;
          }
          
          item.resolve(null);
          continue;
        }

        const result = await res.json();
        const transcription = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
        
        if (transcription) {
          console.log('Transcription successful:', transcription);
        } else {
          console.warn('No valid transcription returned from Gemini:', result);
        }
        
        item.resolve(transcription);

      } catch (error) {
        console.error('Transcription error:', error);
        
        // Retry on network errors
        if ((error.name === 'TypeError' || error.message.includes('fetch')) && item.retryCount < 2) {
          console.warn('Network error, retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000 * (item.retryCount + 1)));
          // Re-add to queue for retry
          this.transcriptionQueue.unshift({
            ...item,
            retryCount: item.retryCount + 1
          });
          continue;
        }
        
        item.resolve(null);
      }
    }

    this.isProcessingQueue = false;
    console.log('Transcription queue processing complete');
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
    
    // Save transcriptions to storage whenever a new segment is added
    this.saveRecordingsToStorage();
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
      let timeStr;
      if (segment.timestamp && typeof segment.timestamp === 'object' && segment.timestamp.videoTime !== undefined) {
        // Use video timestamp if available
        const videoTime = segment.timestamp.videoTime;
        const minutes = Math.floor(videoTime / 60);
        const seconds = videoTime % 60;
        timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      } else if (segment.timestamp) {
        // Fallback to system time
        timeStr = new Date(segment.timestamp).toLocaleTimeString();
      } else {
        timeStr = 'Unknown time';
      }
      
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
    chrome.storage.local.get(['recordings', 'transcriptions'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading recordings:', chrome.runtime.lastError);
        this.renderRecordings();
        return;
      }
      
      if (result.recordings) {
        // Convert storage format back to recording objects
        this.recordings = result.recordings.map(recording => ({
          ...recording,
          title: typeof recording.title === 'string' ? recording.title : 'Recording - Unknown Tab',
          domain: typeof recording.domain === 'string' ? recording.domain : 'Unknown Domain',
          blob: null // Blob will be null for loaded recordings
        }));
        console.log('Recordings loaded from storage:', this.recordings.length);
      }
      
      if (result.transcriptions) {
        // Load transcriptions back into memory
        for (const [tabId, segments] of Object.entries(result.transcriptions)) {
          this.transcriptions.set(parseInt(tabId), segments);
        }
        console.log('Transcriptions loaded from storage:', Object.keys(result.transcriptions).length);
      }
      
      this.renderRecordings();
    });
  }

  stopTranscriptionForTab(tabId) {
    console.log('Sidepanel: Stopping transcription for tab:', tabId);
    const transcriptionQueue = this.transcriptionQueue.filter(item => item.tabId === tabId);
    transcriptionQueue.forEach(item => {
      console.log('Sidepanel: Resolving transcription queue item for tab:', tabId);
      item.resolve(null); // Resolve with null to indicate cancellation
    });
    this.transcriptionQueue = this.transcriptionQueue.filter(item => item.tabId !== tabId);
    console.log('Sidepanel: Transcription queue after stopping:', this.transcriptionQueue.length);
  }


}

// Initialize the extension
document.addEventListener('DOMContentLoaded', () => {
  new AudioRecorder();
});