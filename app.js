// app.js

import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js";

const videoElement = document.getElementById("video-input");
const canvasElement = document.getElementById("output-canvas");
const canvasCtx = canvasElement.getContext("2d");
let midiAccess = null; // MIDI Access object
let virtualOutput = null; // Virtual MIDI output port

// Variables for gesture logic
let isMidiControlEnabled = false; // Toggle for MIDI modulation control
let lastGestureTime = performance.now(); // Debounce toggling
let gestureStartTimes = { Left: null, Right: null }; // Stability timer for gestures
let lastFrameTime = performance.now(); // For FPS calculation
let fps = 0;

// Sensitivity and distance limits
const maxNearDistance = 0.5; // Minimum distance for modulation (near)
const maxFarDistance = 0.8; // Maximum distance for modulation (far)

// Store previous landmarks for consistent hand color assignment
let previousHands = { Left: null, Right: null };

// Control hand selection
let controlHand = "Right"; // Default control hand is now Right

// Gesture strictness levels (1-10)
let gestureStrictness = 5; // Default gesture strictness level
let handOpenStrictness = 5; // Default hand-open strictness level

(async function initializeApp() {
  try {
    console.log("Initializing MediaPipe Hand Landmarker...");

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    const handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2, // Track both hands
    });

    console.log("Hand Landmarker initialized successfully.");
    await setupCamera();

    videoElement.onloadedmetadata = () => {
      videoElement.play();
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;

      processVideoFrame(handLandmarker);
    };

    await initializeMIDIAccess();

    // Initialize control hand selection
    const controlHandSelect = document.getElementById("control-hand-select");
    controlHandSelect.addEventListener("change", (event) => {
      controlHand = event.target.value;
      console.log("Control hand changed to:", controlHand);
    });

    // Initialize gesture strictness selection
    const gestureStrictnessSelect = document.getElementById(
      "gesture-strictness-level-select"
    );
    gestureStrictnessSelect.addEventListener("change", (event) => {
      gestureStrictness = parseInt(event.target.value);
      console.log("Gesture strictness level changed to:", gestureStrictness);
    });

    // Initialize hand-open strictness selection
    const handOpenStrictnessSelect = document.getElementById(
      "hand-open-strictness-level-select"
    );
    handOpenStrictnessSelect.addEventListener("change", (event) => {
      handOpenStrictness = parseInt(event.target.value);
      console.log("Hand-open strictness level changed to:", handOpenStrictness);
    });
  } catch (error) {
    console.error("Error initializing the app:", error);
    alert("Initialization error. Check console for details.");
  }
})();

async function setupCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoElement.srcObject = stream;
  } catch (error) {
    console.error("Error accessing the camera:", error);
    alert(
      "Failed to access the camera. Please ensure permissions are granted."
    );
  }
}

function processVideoFrame(handLandmarker) {
  async function detect() {
    const currentFrameTime = performance.now();
    fps = Math.round(1000 / (currentFrameTime - lastFrameTime));
    lastFrameTime = currentFrameTime;

    if (videoElement.readyState === 4) {
      const results = await handLandmarker.detectForVideo(
        videoElement,
        performance.now()
      );
      renderResults(results);
    }
    requestAnimationFrame(detect);
  }
  detect();
}

// Function to adjust landmarks for mirrored video
function adjustLandmarksForMirroredVideo(landmarks) {
  return landmarks.map((landmark) => ({
    ...landmark,
    x: 1 - landmark.x,
  }));
}

// Function to swap handedness labels due to mirroring
function swapHandednessLabel(label) {
  return label === "Left" ? "Right" : label === "Right" ? "Left" : label;
}

function renderResults(results) {
  const fpsDisplay = document.getElementById("fps-display");
  const statusDisplay = document.getElementById("status-display");
  const leftHandDisplay = document.getElementById("left-hand-display");
  const rightHandDisplay = document.getElementById("right-hand-display");
  const midiDisplay = document.getElementById("midi-display");
  const modulationDisplay = document.getElementById("modulation-display");

  // Update FPS
  fpsDisplay.textContent = `FPS: ${fps}`;

  // Clear the canvas and draw the video feed
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // Flip the canvas horizontally (mirror effect)
  canvasCtx.save();
  canvasCtx.scale(-1, 1); // Flip horizontally
  canvasCtx.drawImage(
    videoElement,
    -canvasElement.width,
    0, // Adjust x position for mirroring
    canvasElement.width,
    canvasElement.height
  );
  canvasCtx.restore();

  // Adjust landmarks for mirrored video
  if (results.landmarks) {
    results.landmarks = results.landmarks.map(adjustLandmarksForMirroredVideo);
  }

  if (!results.landmarks || results.landmarks.length === 0) {
    statusDisplay.textContent = "No Hands Detected";
    leftHandDisplay.textContent = "Left Hand: Not Detected";
    rightHandDisplay.textContent = "Right Hand: Not Detected";
    midiDisplay.textContent = `MIDI Control: ${
      isMidiControlEnabled ? "ON" : "OFF"
    }`;
    modulationDisplay.textContent = "Modulation: --";

    // Clear previous hands if no hands are detected
    previousHands.Left = null;
    previousHands.Right = null;
    gestureStartTimes.Left = null;
    gestureStartTimes.Right = null;
    return;
  }

  statusDisplay.textContent = "Hands Detected";

  // Initialize hands as null
  previousHands.Left = null;
  previousHands.Right = null;

  if (
    results.handedness &&
    results.handedness.length === results.landmarks.length
  ) {
    // Use handedness if available
    results.handedness.forEach((hand, index) => {
      const handednessLabel = swapHandednessLabel(hand.label); // Swap labels due to mirroring
      const landmarks = results.landmarks[index];

      if (handednessLabel === "Right") {
        previousHands.Right = landmarks;
      } else if (handednessLabel === "Left") {
        previousHands.Left = landmarks;
      }
    });
  } else {
    // Fallback: Assign based on x-coordinates (after mirroring)
    const sortedHands = results.landmarks.sort((a, b) => a[0].x - b[0].x);
    if (sortedHands.length === 1) {
      // Only one hand detected; assign based on position
      const landmarks = sortedHands[0];

      if (landmarks[0].x < 0.5) {
        // Hand is on the left side of the screen
        previousHands.Left = landmarks;
        previousHands.Right = null;
      } else {
        // Hand is on the right side of the screen
        previousHands.Right = landmarks;
        previousHands.Left = null;
      }
    } else {
      // Assign right hand first
      previousHands.Right = sortedHands[1];
      previousHands.Left = sortedHands[0];
    }
  }

  // Draw and display the right hand
  if (previousHands.Right) {
    rightHandDisplay.textContent = "Right Hand: Detected";
    drawHand(canvasCtx, previousHands.Right, "red"); // Draw right hand in red
  } else {
    rightHandDisplay.textContent = "Right Hand: Not Detected";
  }

  // Draw and display the left hand
  if (previousHands.Left) {
    leftHandDisplay.textContent = "Left Hand: Detected";
    drawHand(canvasCtx, previousHands.Left, "blue"); // Draw left hand in blue
  } else {
    leftHandDisplay.textContent = "Left Hand: Not Detected";
  }

  // Process the control hand
  let controlHandLandmarks = previousHands[controlHand];

  if (controlHandLandmarks) {
    // MIDI control logic for the selected hand
    const gestureDetected = checkPointingUp(controlHandLandmarks);
    console.log(`${controlHand} Gesture Detected:`, gestureDetected);

    // Stabilize the gesture before toggling
    const stableGesture = stableGestureDetection(gestureDetected, controlHand);
    console.log(`Stable ${controlHand} Gesture:`, stableGesture);

    if (stableGesture && canToggle()) {
      isMidiControlEnabled = !isMidiControlEnabled; // Toggle MIDI control
      lastGestureTime = performance.now();
      console.log(
        `MIDI Control Toggled by ${controlHand} Hand:`,
        isMidiControlEnabled ? "ON" : "OFF"
      );
    }

    // Update MIDI display after toggling
    midiDisplay.textContent = `MIDI Control: ${
      isMidiControlEnabled ? "ON" : "OFF"
    }`;

    // Modulation logic for the control hand
    if (isMidiControlEnabled) {
      const isHandOpen = checkHandOpen(controlHandLandmarks);
      if (isHandOpen) {
        const modWheelValue = calculateModWheelValue(controlHandLandmarks);
        sendMIDIControlChange(1, modWheelValue); // Send modulation wheel (CC 1)
        modulationDisplay.textContent = `Modulation: ${modWheelValue}`;
      } else {
        modulationDisplay.textContent = "Modulation: Hand Not Open";
      }
    } else {
      modulationDisplay.textContent = "Modulation: --";
    }
  } else {
    // Control hand not detected
    modulationDisplay.textContent = "Modulation: --";
    gestureStartTimes[controlHand] = null; // Reset gestureStartTime when control hand is not detected
  }
}

// Gesture detection logic: pointing-up gesture
function checkPointingUp(landmarks) {
  // Adjust thresholds based on gesture strictness level
  const gestureStrictnessFactor = (gestureStrictness - 1) / 9; // Normalize to 0 (least strict) to 1 (most strict)

  // Index finger angle threshold ranges from 150° to 180°
  const minIndexAngle = 150 + 30 * gestureStrictnessFactor;

  // Max curl angle ranges from 100° (least strict) to 70° (most strict)
  const maxCurlAngle = 100 - 30 * gestureStrictnessFactor;

  // Max distance ratio ranges from 0.8 (least strict) to 0.5 (most strict)
  const maxDistanceRatio = 0.8 - 0.3 * gestureStrictnessFactor;

  // Helper function to calculate the angle between three points (includes z-axis)
  function calculateAngle(A, B, C) {
    const BA = { x: A.x - B.x, y: A.y - B.y, z: A.z - B.z };
    const BC = { x: C.x - B.x, y: C.y - B.y, z: C.z - B.z };
    const dotProduct = BA.x * BC.x + BA.y * BC.y + BA.z * BC.z;
    const magnitudeBA = Math.hypot(BA.x, BA.y, BA.z);
    const magnitudeBC = Math.hypot(BC.x, BC.y, BC.z);

    if (magnitudeBA === 0 || magnitudeBC === 0) {
      return 180; // Assume fully extended
    }

    let cosAngle = dotProduct / (magnitudeBA * magnitudeBC);
    cosAngle = Math.max(-1, Math.min(1, cosAngle));

    const angle = Math.acos(cosAngle);
    return angle * (180 / Math.PI); // Convert to degrees
  }

  // Function to check if a finger is curled based on both angle and distance
  function isFingerCurled(
    landmarks,
    fingerIndices,
    maxCurlAngle,
    maxDistanceRatio,
    fingerName
  ) {
    const mcp = landmarks[fingerIndices[0]];
    const pip = landmarks[fingerIndices[1]];
    const dip = landmarks[fingerIndices[2]];
    const tip = landmarks[fingerIndices[3]];
    const palmBase = landmarks[0];

    // Calculate angles at PIP and DIP joints
    const anglePIP = calculateAngle(mcp, pip, dip);
    const angleDIP = calculateAngle(pip, dip, tip);

    // Calculate distance ratio
    const tipToPalmDistance = Math.hypot(
      tip.x - palmBase.x,
      tip.y - palmBase.y,
      tip.z - palmBase.z
    );
    const mcpToPalmDistance = Math.hypot(
      mcp.x - palmBase.x,
      mcp.y - palmBase.y,
      mcp.z - palmBase.z
    );
    const distanceRatio = tipToPalmDistance / mcpToPalmDistance;

    console.log(
      `${fingerName} Angles: PIP ${anglePIP.toFixed(2)}, DIP ${angleDIP.toFixed(
        2
      )}`
    );
    console.log(`${fingerName} Distance Ratio: ${distanceRatio.toFixed(2)}`);

    // Finger is considered curled if either angle is less than maxCurlAngle
    // or if the distance ratio is less than maxDistanceRatio
    const isCurledByAngle = anglePIP < maxCurlAngle || angleDIP < maxCurlAngle;
    const isCurledByDistance = distanceRatio < maxDistanceRatio;

    return isCurledByAngle || isCurledByDistance;
  }

  // Finger indices
  const fingerIndices = {
    index: [5, 6, 7, 8],
    middle: [9, 10, 11, 12],
    ring: [13, 14, 15, 16],
    pinky: [17, 18, 19, 20],
  };

  // 1. Check if the index finger is extended
  const indexAngle1 = calculateAngle(
    landmarks[fingerIndices.index[0]],
    landmarks[fingerIndices.index[1]],
    landmarks[fingerIndices.index[2]]
  );
  const indexAngle2 = calculateAngle(
    landmarks[fingerIndices.index[1]],
    landmarks[fingerIndices.index[2]],
    landmarks[fingerIndices.index[3]]
  );
  const isIndexFingerStraight =
    indexAngle1 > minIndexAngle && indexAngle2 > minIndexAngle;

  // 2. Check if the index finger is pointing upwards
  const isIndexFingerPointingUp =
    landmarks[fingerIndices.index[3]].y < landmarks[fingerIndices.index[0]].y;

  // 3. Check if other fingers are curled based on both angle and distance
  const isMiddleFingerCurled = isFingerCurled(
    landmarks,
    fingerIndices.middle,
    maxCurlAngle,
    maxDistanceRatio,
    "Middle"
  );
  const isRingFingerCurled = isFingerCurled(
    landmarks,
    fingerIndices.ring,
    maxCurlAngle,
    maxDistanceRatio,
    "Ring"
  );
  const isPinkyFingerCurled = isFingerCurled(
    landmarks,
    fingerIndices.pinky,
    maxCurlAngle,
    maxDistanceRatio,
    "Pinky"
  );

  // 4. Combine all conditions
  const gestureDetected =
    isIndexFingerStraight &&
    isIndexFingerPointingUp &&
    isMiddleFingerCurled &&
    isRingFingerCurled &&
    isPinkyFingerCurled;

  // Debugging outputs
  console.log("Gesture Detection Debugging:");
  console.log("Gesture Strictness Level:", gestureStrictness);
  console.log("Gesture Strictness Factor:", gestureStrictnessFactor.toFixed(2));
  console.log("Min Index Angle:", minIndexAngle.toFixed(2));
  console.log("Max Curl Angle:", maxCurlAngle.toFixed(2));
  console.log("Max Distance Ratio:", maxDistanceRatio.toFixed(2));
  console.log("Index Angles:", indexAngle1.toFixed(2), indexAngle2.toFixed(2));
  console.log("Is Index Finger Straight:", isIndexFingerStraight);
  console.log("Is Index Finger Pointing Up:", isIndexFingerPointingUp);
  console.log("Is Middle Finger Curled:", isMiddleFingerCurled);
  console.log("Is Ring Finger Curled:", isRingFingerCurled);
  console.log("Is Pinky Finger Curled:", isPinkyFingerCurled);
  console.log("Gesture Detected:", gestureDetected);

  return gestureDetected;
}

// Stabilization logic for gestures
function stableGestureDetection(gestureDetected, handLabel) {
  const currentTime = performance.now();

  if (gestureDetected) {
    if (!gestureStartTimes[handLabel]) {
      gestureStartTimes[handLabel] = currentTime;
    }
    if (currentTime - gestureStartTimes[handLabel] > 200) {
      return true;
    }
  } else {
    gestureStartTimes[handLabel] = null;
  }

  return false;
}

// Ensure debounce for toggling gesture
function canToggle() {
  const currentTime = performance.now();
  return currentTime - lastGestureTime > 1000; // At least 1 second between toggles
}

function checkHandOpen(landmarks) {
  // Helper function to calculate the angle between three points
  function calculateAngle(A, B, C) {
    const BA = { x: A.x - B.x, y: A.y - B.y };
    const BC = { x: C.x - B.x, y: C.y - B.y };
    const dotProduct = BA.x * BC.x + BA.y * BC.y;
    const magnitudeBA = Math.hypot(BA.x, BA.y);
    const magnitudeBC = Math.hypot(BC.x, BC.y);

    // Prevent division by zero
    if (magnitudeBA === 0 || magnitudeBC === 0) {
      return 180; // Assume fully extended
    }

    let cosAngle = dotProduct / (magnitudeBA * magnitudeBC);
    // Clamp cosAngle to the range [-1, 1]
    cosAngle = Math.max(-1, Math.min(1, cosAngle));

    const angle = Math.acos(cosAngle);
    return angle * (180 / Math.PI); // Convert to degrees
  }

  // Adjust thresholds based on hand-open strictness level
  // Higher strictness means stricter conditions
  const handOpenStrictnessFactor = (handOpenStrictness - 1) / 9; // Normalize to 0 (least strict) to 1 (most strict)

  // Threshold for straightness of fingers
  const minFingerAngle = 150 + 30 * handOpenStrictnessFactor; // Ranges from 150° to 180°
  // Minimum distance between fingertips to consider fingers spread
  const minFingerSeparation = 0.02 + 0.03 * handOpenStrictnessFactor; // Ranges from 0.02 to 0.05

  // Extract finger landmarks
  const fingers = [
    { mcp: landmarks[5], pip: landmarks[6], tip: landmarks[8] }, // Index
    { mcp: landmarks[9], pip: landmarks[10], tip: landmarks[12] }, // Middle
    { mcp: landmarks[13], pip: landmarks[14], tip: landmarks[16] }, // Ring
    { mcp: landmarks[17], pip: landmarks[18], tip: landmarks[20] }, // Pinky
  ];

  // Check if fingers are straight
  const fingersStraight = fingers.every((finger) => {
    const angle = calculateAngle(finger.mcp, finger.pip, finger.tip);
    return angle > minFingerAngle;
  });

  // Optionally, include thumb in the detection
  const thumbAngle = calculateAngle(landmarks[1], landmarks[2], landmarks[4]);
  const isThumbStraight = thumbAngle > minFingerAngle;

  // Check if fingers are spread apart
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const indexMiddleDist = Math.hypot(
    indexTip.x - middleTip.x,
    indexTip.y - middleTip.y
  );
  const middleRingDist = Math.hypot(
    middleTip.x - ringTip.x,
    middleTip.y - ringTip.y
  );
  const ringPinkyDist = Math.hypot(
    ringTip.x - pinkyTip.x,
    ringTip.y - pinkyTip.y
  );

  const fingersSpread =
    indexMiddleDist > minFingerSeparation &&
    middleRingDist > minFingerSeparation &&
    ringPinkyDist > minFingerSeparation;

  // Combine all conditions
  const handIsOpen = fingersStraight && fingersSpread && isThumbStraight;

  // Debugging outputs
  console.log("Hand Open Detection:");
  console.log("Hand-Open Strictness Level:", handOpenStrictness);
  console.log("Min Finger Angle:", minFingerAngle);
  console.log("Min Finger Separation:", minFingerSeparation);
  console.log("Fingers Straight:", fingersStraight);
  console.log("Thumb Straight:", isThumbStraight);
  console.log("Fingers Spread:", fingersSpread);
  console.log("Hand Is Open:", handIsOpen);

  return handIsOpen;
}

// Map hand size to MIDI modulation range
function calculateModWheelValue(landmarks) {
  const palmBase = landmarks[0];
  const indexTip = landmarks[8];
  const distance = Math.hypot(indexTip.x - palmBase.x, indexTip.y - palmBase.y);

  // Clamp the distance within the valid range
  const clampedDistance = Math.min(
    Math.max(distance, maxNearDistance),
    maxFarDistance
  );

  // Normalize to MIDI modulation range (0–127)
  const normalizedValue =
    (clampedDistance - maxNearDistance) / (maxFarDistance - maxNearDistance);
  return Math.round(normalizedValue * 127);
}

// Draw the detected hand with connections and landmarks
function drawHand(ctx, landmarks, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  const connections = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4], // Thumb
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8], // Index finger
    [5, 9],
    [9, 10],
    [10, 11],
    [11, 12], // Middle finger
    [9, 13],
    [13, 14],
    [14, 15],
    [15, 16], // Ring finger
    [13, 17],
    [17, 18],
    [18, 19],
    [19, 20], // Pinky
    [0, 17], // Palm
  ];

  // Draw connections
  connections.forEach(([start, end]) => {
    const startLandmark = landmarks[start];
    const endLandmark = landmarks[end];
    ctx.beginPath();
    ctx.moveTo(
      startLandmark.x * canvasElement.width,
      startLandmark.y * canvasElement.height
    );
    ctx.lineTo(
      endLandmark.x * canvasElement.width,
      endLandmark.y * canvasElement.height
    );
    ctx.stroke();
  });

  // Draw landmarks
  landmarks.forEach((landmark) => {
    ctx.beginPath();
    ctx.arc(
      landmark.x * canvasElement.width,
      landmark.y * canvasElement.height,
      5,
      0,
      2 * Math.PI
    );
    ctx.fill();
  });
}

// Initialize MIDI access
async function initializeMIDIAccess() {
  try {
    midiAccess = await navigator.requestMIDIAccess();
    console.log("MIDI Access Initialized.");

    // Use the first available output port for virtual MIDI
    virtualOutput = Array.from(midiAccess.outputs.values())[0];
    if (!virtualOutput) {
      console.error("No virtual MIDI output found.");
      alert("Please enable a virtual MIDI output for this app to function.");
    }
  } catch (error) {
    console.error("Failed to initialize MIDI access:", error);
  }
}

// Send MIDI control change messages
function sendMIDIControlChange(controller, value) {
  if (!virtualOutput) return;

  // Send MIDI Control Change message: [status, controller number, value]
  virtualOutput.send([0xb0, controller, value]);
}
