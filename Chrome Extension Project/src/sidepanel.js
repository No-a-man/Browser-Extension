function initializeTranscriber() {
  const statusDiv = document.getElementById("permissionStatus");

  chrome.permissions.contains({ permissions: ["background"] }, (hasBg) => {
    statusDiv.innerText = hasBg
      ? "Background permission granted"
      : "Background permission NOT granted";
  });

  let mediaRecorder;
  let chunks = [];

document.getElementById("startBtn").addEventListener("click", async () => {
  const optionalPermissions = ["background", "tabCapture"];

  chrome.permissions.contains({ permissions: optionalPermissions }, (hasAll) => {
    if (!hasAll) {
      chrome.permissions.request({ permissions: optionalPermissions }, (granted) => {
        if (granted) {
          console.log("✅ Optional permissions granted:", optionalPermissions);
          startRecording();
        } else {
          alert("❌ Cannot proceed without required permissions.");
        }
      });
    } else {
      startRecording();
    }
  });
});


  document.getElementById("stopBtn").addEventListener("click", () => {
    mediaRecorder.stop();
    document.getElementById("status").innerText = "Status: Stopped";
    document.getElementById("startBtn").disabled = false;
    document.getElementById("stopBtn").disabled = true;
  });

  function startRecording() {
    document.getElementById("status").innerText = "Status: Capturing audio...";

    chrome.tabCapture.capture({ audio: true }, function (stream) {
      if (!stream) {
        alert("Unable to capture audio from tab.");
        return;
      }

      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = function (e) {
        chunks.push(e.data);
      };

      mediaRecorder.onstop = function () {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const audioURL = URL.createObjectURL(blob);
        const audioElement = document.createElement("audio");
        audioElement.src = audioURL;
        audioElement.controls = true;
        document.getElementById("transcript").appendChild(audioElement);
      };

      mediaRecorder.start();
      document.getElementById("startBtn").disabled = true;
      document.getElementById("stopBtn").disabled = false;
    });
  }
}

initializeTranscriber();
