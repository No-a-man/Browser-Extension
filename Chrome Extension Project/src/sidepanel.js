function initializeTranscriber() {
  const statusDiv = document.getElementById("permissionStatus");
  const statusElement = document.getElementById("status");

  // Check current permissions
  chrome.permissions.contains({ permissions: ["background"] }, (hasBg) => {
    statusDiv.innerText = hasBg
      ? "Background permission granted"
      : "Background permission NOT granted";
  });

  let mediaRecorder;
  let chunks = [];
  let isFirstRecording = true;

  document.getElementById("startBtn").addEventListener("click", async () => {
    const optionalPermissions = ["background", "tabCapture"];

    // Check if we have all required permissions
    chrome.permissions.contains({ permissions: optionalPermissions }, (hasAll) => {
      if (!hasAll) {
        // Request permissions if not granted
        chrome.permissions.request({ permissions: optionalPermissions }, (granted) => {
          if (granted) {
            console.log("✅ Optional permissions granted:", optionalPermissions);
            requestMicrophonePermission();
          } else {
            statusElement.innerText = "Status: Permission denied - Cannot record without required permissions";
            alert("❌ Cannot proceed without required permissions. Please grant tab capture and background permissions.");
          }
        });
      } else {
        requestMicrophonePermission();
      }
    });
  });

  // Function to request microphone permission
  async function requestMicrophonePermission() {
    try {
      statusElement.innerText = "Status: Requesting microphone permission...";
      
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true,
        video: false 
      });
      
      // Stop the test stream immediately
      stream.getTracks().forEach(track => track.stop());
      
      console.log("✅ Microphone permission granted");
      startRecording();
    } catch (error) {
      console.error("❌ Microphone permission denied:", error);
      statusElement.innerText = "Status: Microphone permission denied - Cannot record audio";
      alert("❌ Microphone permission is required to record audio. Please allow microphone access and try again.");
    }
  }


  document.getElementById("stopBtn").addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      statusElement.innerText = "Status: Processing recording...";
      document.getElementById("startBtn").disabled = false;
      document.getElementById("stopBtn").disabled = true;
    }
  });

  function startRecording() {
    statusElement.innerText = "Status: Starting tab audio capture...";

    chrome.tabCapture.capture({ audio: true }, function (stream) {
      if (!stream) {
        statusElement.innerText = "Status: Failed to capture tab audio - No audio stream available";
        alert("Unable to capture audio from tab. Please ensure there is audio playing in the active tab.");
        return;
      }

      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = function (e) {
        chunks.push(e.data);
      };

      mediaRecorder.onstart = function () {
        statusElement.innerText = "Status: Recording tab audio... (Click Stop when finished)";
        document.getElementById("startBtn").disabled = true;
        document.getElementById("stopBtn").disabled = false;
        isFirstRecording = false;
      };

      mediaRecorder.onstop = function () {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const audioURL = URL.createObjectURL(blob);
        const audioElement = document.createElement("audio");
        audioElement.src = audioURL;
        audioElement.controls = true;
        
        // Clear previous recordings
        const transcriptDiv = document.getElementById("transcript");
        transcriptDiv.innerHTML = "";
        transcriptDiv.appendChild(audioElement);
        
        statusElement.innerText = "Status: Recording completed - Audio ready for playback";
        chunks = []; // Reset chunks for next recording
      };

      mediaRecorder.onerror = function (event) {
        console.error("MediaRecorder error:", event);
        statusElement.innerText = "Status: Recording error occurred";
        alert("An error occurred during recording. Please try again.");
        document.getElementById("startBtn").disabled = false;
        document.getElementById("stopBtn").disabled = true;
      };

      mediaRecorder.start();
    });
  }
}

initializeTranscriber();
