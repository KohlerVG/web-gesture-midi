// app.js

// Select DOM elements
const videoElement = document.getElementById("video");
const canvasElement = document.getElementById("canvas");
const canvasCtx = canvasElement.getContext("2d");

const leftHandStatus = document.getElementById("left-hand-status");
const rightHandStatus = document.getElementById("right-hand-status");
const leftHandState = document.getElementById("left-hand-state");
const rightHandState = document.getElementById("right-hand-state");
const modulationStatus = document.getElementById("modulation-status");
const modulationValueDisplay = document.getElementById("modulation-value");
const fpsCounter = document.getElementById("fps-counter"); // FPS Counter Element

// DOM elements for distance controls
const minDistanceSlider = document.getElementById("min-distance");
const maxDistanceSlider = document.getElementById("max-distance");
const minDistanceNumber = document.getElementById("min-distance-number");
const maxDistanceNumber = document.getElementById("max-distance-number");
const openHandStrictnessDropdown = document.getElementById(
  "open-hand-strictness"
);
const pointingUpStrictnessDropdown = document.getElementById(
  "pointing-up-strictness"
);

// MIDI Status Element
const midiStatus = document.getElementById("midi-status");

// MIDI Output Port Dropdown and Disconnect Button
const midiPortsDropdown = document.getElementById("midi-ports");
const disconnectMIDIBtn = document.getElementById("disconnect-midi");

// MIDI Access Overlay Elements
const midiOverlay = document.getElementById("midi-overlay");
const allowMIDIBtn = document.getElementById("allow-midi");

// Checkbox Element for Reversing Modulation Mapping
const reverseModulationCheckbox = document.getElementById("reverse-modulation");

// Gesture Progress Bar Element
const gestureProgressBar = document.getElementById("gesture-progress-bar");

// Initialize MediaPipe Hands
const hands = new Hands({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
  },
});

hands.setOptions({
  maxNumHands: 2, // Track both hands
  modelComplexity: 1, // Increased complexity for better accuracy
  minDetectionConfidence: 0.7, // Increased for more reliable detection
  minTrackingConfidence: 0.7,
});

hands.onResults(onResults);

// Flag to prevent multiple initializations
let canvasInitialized = false;

// Gesture Control Variables
let modulationWheelOn = false; // State of modulation wheel
let lastGestureTime = 0; // Timestamp of last gesture to enforce cooldown
const gestureCooldown = 1000; // 1 second cooldown in milliseconds

// Configurable Hand Distance Variables
let minDistance = parseFloat(minDistanceSlider.value); // Initialize from slider
let maxDistance = parseFloat(maxDistanceSlider.value); // Initialize from slider

// MIDI Access and Output
let midiAccess = null;
let midiOutput = null;

// Implement a smoothing mechanism
let modulationValuesQueue = [];
const smoothingFactor = 5; // Number of frames to average

// Gesture Strictness Levels (1-10)
let openHandStrictness = parseInt(openHandStrictnessDropdown.value); // Default 5
let pointingUpStrictness = parseInt(pointingUpStrictnessDropdown.value); // Default 5

// Gesture State Tracking
let isPointingUpActive = false;
let isHandOpenActive = false;

// Gesture Confirmation Counters
const gestureConfirmationThreshold = 10; // Increased from 5 to 10

let pointingUpCounter = 0;

// FPS Calculation Variables
let frameCount = 0;
let fps = 0;
let lastTime = performance.now(); // Ensure this is declared only once

// Function to initialize canvas scaling based on devicePixelRatio
function initializeCanvas() {
  if (canvasInitialized) {
    console.warn("Canvas has already been initialized.");
    return;
  }
  console.log("Initializing canvas scaling...");
  const scale = window.devicePixelRatio || 1;
  canvasElement.width = 960 * scale; // Internal canvas width
  canvasElement.height = 540 * scale; // Internal canvas height
  canvasElement.style.width = "960px"; // CSS width
  canvasElement.style.height = "540px"; // CSS height
  canvasCtx.scale(scale, scale);
  canvasInitialized = true; // Set flag after initialization
}

// Listen for video metadata loaded to set canvas size
videoElement.addEventListener("loadedmetadata", () => {
  console.log("Video metadata loaded.");
  initializeCanvas();

  // Verify actual video settings
  const videoTrack = videoElement.srcObject.getVideoTracks()[0];
  if (videoTrack) {
    const settings = videoTrack.getSettings();
    console.log(
      "Actual Video Dimensions:",
      settings.width,
      "x",
      settings.height
    );
    console.log("Actual Frame Rate:", settings.frameRate);
  }
});

// Initialize Camera with optimized settings
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 960, // Lower resolution to align with webcam capabilities
  height: 540, // Lower resolution
  frameRate: { ideal: 60, max: 60 }, // Request up to 60 FPS
});
camera.start();

// Function to handle MIDI Access Success
function onMIDISuccess(access) {
  midiAccess = access;
  console.log("MIDI Access Obtained:", midiAccess);
  populateMIDIPorts();
  updateMIDIStatus();

  // Listen for MIDI connection changes
  midiAccess.onstatechange = onstatechange;
}

// Function to handle MIDI Access Failure
function onMIDIFailure() {
  alert("Could not access your MIDI devices.");
}

// Function to handle MIDI State Changes
function onstatechange(event) {
  console.log(`MIDI port ${event.port.name} ${event.port.state}`);
  populateMIDIPorts();
  updateMIDIStatus();
}

// Function to list and populate MIDI Output Ports in Dropdown
function populateMIDIPorts() {
  if (!midiAccess) return;
  const outputs = Array.from(midiAccess.outputs.values());
  console.log("Available MIDI Outputs:", outputs);

  // Store currently selected port ID
  const currentPortId = midiPortsDropdown.value;

  // Clear existing options except the first placeholder
  midiPortsDropdown.innerHTML =
    '<option value="">-- Select MIDI Port --</option>';

  outputs.forEach((output) => {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name;
    midiPortsDropdown.appendChild(option);
  });

  // Check if current port is still available
  if (currentPortId && midiAccess.outputs.get(currentPortId)) {
    midiPortsDropdown.value = currentPortId;
    midiOutput = midiAccess.outputs.get(currentPortId);
    console.log("Re-selected MIDI Output:", midiOutput.name);
  } else {
    midiOutput = null;
    midiPortsDropdown.value = "";
    console.log("MIDI Output Disconnected or Changed.");
  }

  // Update MIDI Status Indicator
  if (outputs.length === 0) {
    midiStatus.textContent = "MIDI Status: No Outputs Available";
    midiStatus.classList.remove("connected");
    midiStatus.classList.add("disconnected");
    disconnectMIDIBtn.disabled = true;
  } else if (!midiOutput) {
    midiStatus.textContent = "MIDI Status: Disconnected";
    midiStatus.classList.add("disconnected");
    midiStatus.classList.remove("connected");
    disconnectMIDIBtn.disabled = true;
  } else {
    midiStatus.textContent = "MIDI Status: Connected";
    midiStatus.classList.add("connected");
    midiStatus.classList.remove("disconnected");
    disconnectMIDIBtn.disabled = false;
  }
}

// Function to update MIDI Status Indicator
function updateMIDIStatus() {
  if (midiOutput) {
    midiStatus.textContent = "MIDI Status: Connected";
    midiStatus.classList.add("connected");
    midiStatus.classList.remove("disconnected");
    disconnectMIDIBtn.disabled = false;
  } else {
    midiStatus.textContent = "MIDI Status: Disconnected";
    midiStatus.classList.add("disconnected");
    midiStatus.classList.remove("connected");
    disconnectMIDIBtn.disabled = true;
  }
}

// Automatically Request MIDI Access on Page Load
window.addEventListener("load", () => {
  if (navigator.requestMIDIAccess) {
    navigator
      .requestMIDIAccess()
      .then(onMIDISuccess, onMIDIFailure)
      .catch(() => {
        // If automatic request fails, show the overlay
        midiOverlay.style.display = "flex";
      });
  } else {
    alert("Web MIDI API is not supported in this browser.");
  }
});

// Event Listener for Allow MIDI Access Button in Overlay
allowMIDIBtn.addEventListener("click", () => {
  navigator
    .requestMIDIAccess()
    .then(onMIDISuccess, onMIDIFailure)
    .then(() => {
      // Hide the overlay upon successful MIDI access
      midiOverlay.style.display = "none";
    })
    .catch(() => {
      alert("Failed to obtain MIDI access.");
    });
});

// Event Listener for MIDI Ports Dropdown Change
midiPortsDropdown.addEventListener("change", (event) => {
  const selectedPortId = event.target.value;
  if (selectedPortId === "") {
    midiOutput = null;
    updateMIDIStatus();
    console.log("No MIDI Output Selected.");
    return;
  }

  midiOutput = midiAccess.outputs.get(selectedPortId);
  if (midiOutput) {
    console.log("Selected MIDI Output:", midiOutput.name);
    updateMIDIStatus();
  } else {
    console.log("Selected MIDI Output not found.");
    midiStatus.textContent = "MIDI Status: Disconnected";
    midiStatus.classList.remove("connected");
    midiStatus.classList.add("disconnected");
  }
});

// Event Listener for Disconnect MIDI Button
disconnectMIDIBtn.addEventListener("click", () => {
  if (midiOutput) {
    midiOutput = null;
    midiPortsDropdown.value = "";
    updateMIDIStatus();
    console.log("MIDI Output Disconnected.");
  } else {
    console.log("No MIDI Output to Disconnect.");
  }
});

// Function to send MIDI messages with throttling and validation
let lastMIDITime = 0;
const midiThrottleInterval = 10; // in milliseconds (~100 FPS)

function sendMIDIMessage(command, controller, value) {
  const currentTime = performance.now();
  if (currentTime - lastMIDITime >= midiThrottleInterval) {
    // Clamp the MIDI values to valid ranges
    const clampedController = clamp(controller, 0, 127);
    const clampedValue = clamp(value, 0, 127);

    try {
      if (midiOutput) {
        midiOutput.send([command, clampedController, clampedValue]);
        lastMIDITime = currentTime;
        console.log(
          `Sent MIDI Message: [${command.toString(
            16
          )}, ${clampedController}, ${clampedValue}]`
        );
      } else {
        console.warn(
          "Attempted to send MIDI message, but no MIDI output is connected."
        );
      }
    } catch (error) {
      console.error("Failed to send MIDI message:", error);
    }
  }
}

// Helper function to clamp values within a range
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Function to calculate angle between three points in degrees
function calculateAngle(p1, p2, p3) {
  const a = { x: p1.x - p2.x, y: p1.y - p2.y };
  const b = { x: p3.x - p2.x, y: p3.y - p2.y };

  const dotProduct = a.x * b.x + a.y * b.y;
  const magnitudeA = Math.sqrt(a.x * a.x + a.y * a.y);
  const magnitudeB = Math.sqrt(b.x * b.x + b.y * b.y);

  if (magnitudeA === 0 || magnitudeB === 0) return 0; // Prevent division by zero

  const angleRadians = Math.acos(
    clamp(dotProduct / (magnitudeA * magnitudeB), -1, 1)
  );
  const angleDegrees = angleRadians * (180 / Math.PI);

  return angleDegrees;
}

// Function to detect if a hand is pointing up with thumb overlap
function isPointingUp(handLandmarks, isRightHand) {
  // Index finger must be extended
  const indexExtended = isFingerExtended(
    handLandmarks,
    5,
    6,
    7,
    8,
    pointingUpStrictness
  );
  console.log(`Index Finger Extended: ${indexExtended}`);

  if (!indexExtended) {
    return false;
  }

  // Middle finger should not be extended
  const middleExtended = isFingerExtended(
    handLandmarks,
    9,
    10,
    11,
    12,
    pointingUpStrictness
  );
  console.log(`Middle Finger Extended: ${middleExtended}`);

  if (middleExtended) {
    return false; // Middle finger extended
  }

  // Ring finger should not be extended
  const ringExtended = isFingerExtended(
    handLandmarks,
    13,
    14,
    15,
    16,
    pointingUpStrictness
  );
  console.log(`Ring Finger Extended: ${ringExtended}`);

  if (ringExtended) {
    return false; // Ring finger extended
  }

  // Pinky finger should not be extended
  const pinkyExtended = isFingerExtended(
    handLandmarks,
    17,
    18,
    19,
    20,
    pointingUpStrictness
  );
  console.log(`Pinky Finger Extended: ${pinkyExtended}`);

  if (pinkyExtended) {
    return false; // Pinky finger extended
  }

  // Thumb should not be extended beyond a certain point
  const thumbExtended = isThumbExtended(
    handLandmarks,
    isRightHand,
    pointingUpStrictness
  );
  console.log(`Thumb Extended: ${thumbExtended}`);

  if (thumbExtended) {
    return false; // Thumb is extended
  }

  // **New Check: Thumb Overlaps Other Fingers**
  const thumbTip = handLandmarks[4];
  const indexMCP = handLandmarks[5];
  const indexPIP = handLandmarks[6];
  const indexTIP = handLandmarks[8];

  // Calculate distance between thumb tip and index PIP joint
  const distanceThumbIndex = Math.hypot(
    thumbTip.x - indexPIP.x,
    thumbTip.y - indexPIP.y,
    thumbTip.z - indexPIP.z
  );
  console.log(
    `Distance between Thumb Tip and Index PIP: ${distanceThumbIndex.toFixed(3)}`
  );

  // Define a threshold for overlapping (adjust based on testing)
  const overlapThreshold = 0.05; // Adjust as needed

  if (distanceThumbIndex > overlapThreshold) {
    console.log("Thumb does not overlap with index finger.");
    return false;
  }

  // **New Checks for Hand Orientation and Finger Position**

  // Calculate the angle between wrist (0) and index finger MCP (5) relative to the horizontal
  const wrist = handLandmarks[0];
  const angleRadians = Math.atan2(indexMCP.y - wrist.y, indexMCP.x - wrist.x);
  let angleDegrees = (angleRadians * 180) / Math.PI;

  // Normalize angle to [0, 360)
  if (angleDegrees < 0) angleDegrees += 360;

  console.log(`Hand Angle: ${angleDegrees.toFixed(2)}°`);

  // Define acceptable angle range for pointing up (e.g., 75° to 105°)
  const minAngle = 75;
  const maxAngle = 105;

  if (angleDegrees < minAngle || angleDegrees > maxAngle) {
    console.log("Hand is not oriented upwards.");
    return false;
  }

  // **Additional Check: Index Finger Tip Above Wrist**
  if (indexTIP.y >= wrist.y - 0.05) {
    // Adjust the threshold as needed
    console.log("Index finger tip is not above the wrist.");
    return false;
  }

  // Only index finger is extended, thumb overlaps, and hand is oriented upwards
  return true;
}

// Function to detect if a hand is wide open
function isHandWideOpen(handLandmarks) {
  // Adjusted to account for strictness level
  let allFingersExtended = true;

  // Check all fingers including thumb
  for (let finger of [
    { mcp: 1, pip: 2, dip: 3, tip: 4 }, // Thumb
    { mcp: 5, pip: 6, dip: 7, tip: 8 }, // Index
    { mcp: 9, pip: 10, dip: 11, tip: 12 }, // Middle
    { mcp: 13, pip: 14, dip: 15, tip: 16 }, // Ring
    { mcp: 17, pip: 18, dip: 19, tip: 20 }, // Pinky
  ]) {
    if (
      !isFingerExtended(
        handLandmarks,
        finger.mcp,
        finger.pip,
        finger.dip,
        finger.tip,
        openHandStrictness
      )
    ) {
      allFingersExtended = false;
      break;
    }
  }

  return allFingersExtended;
}

// Helper function to determine if a finger is extended with strictness
function isFingerExtended(handLandmarks, mcp, pip, dip, tip, strictness) {
  // In image coordinates, y increases downward
  // Finger is extended if tip.y < pip.y
  // Strictness adjusts the required y difference

  const yDifference = handLandmarks[pip].y - handLandmarks[tip].y;

  // Define a threshold based on strictness (higher strictness requires larger difference)
  // Linear scaling: baseThreshold + (delta * (strictness - 1))
  const baseThreshold = 0.005;
  const delta = 0.015; // Increment per strictness level
  const threshold = baseThreshold + delta * (strictness - 1);

  console.log(
    `Finger (MCP: ${mcp}) yDifference: ${yDifference.toFixed(
      3
    )} Threshold: ${threshold.toFixed(3)}`
  );

  return yDifference > threshold;
}

// Function to detect if the thumb is extended using angle between thumb joints
function isThumbExtended(handLandmarks, isRightHand, strictness) {
  const thumbMCP = handLandmarks[2];
  const thumbIP = handLandmarks[3];
  const thumbTip = handLandmarks[4];

  const angle = calculateAngle(thumbMCP, thumbIP, thumbTip);

  // Define thresholds: larger angles indicate more extension
  // These values need calibration
  // For example: angle > 160 => extended; angle < 120 => curled
  // Adjust based on strictness level
  const baseExtendedThreshold = 160; // degrees
  const delta = 10; // degrees per strictness level
  const extendedThreshold = baseExtendedThreshold - delta * (strictness - 1);

  console.log(
    `Thumb Angle: ${angle.toFixed(2)} Threshold: ${extendedThreshold}`
  );

  return angle > extendedThreshold;
}

// Function to calculate modulation wheel value based on hand distance
function calculateModulationValue(handLandmarks) {
  // Calculate the bounding box height as a proxy for distance
  let minY = Infinity;
  let maxY = -Infinity;

  handLandmarks.forEach((landmark) => {
    if (landmark.y < minY) minY = landmark.y;
    if (landmark.y > maxY) maxY = landmark.y;
  });

  const boundingBoxHeight = maxY - minY;
  console.log(`Bounding Box Height: ${boundingBoxHeight.toFixed(3)}`);

  // Clamp the height within min and max distances
  const clampedHeight = clamp(boundingBoxHeight, minDistance, maxDistance);
  console.log(`Clamped Height: ${clampedHeight.toFixed(3)}`);

  // Normalize such that closer hands (larger clampedHeight) have higher normalized values
  const normalized =
    (clampedHeight - minDistance) / (maxDistance - minDistance);
  console.log(`Normalized Value: ${normalized.toFixed(3)}`);

  // Clamp normalized value between 0 and 1
  const clampedNormalized = clamp(normalized, 0, 1);
  console.log(`Clamped Normalized Value: ${clampedNormalized.toFixed(3)}`);

  // **Direct Mapping:** Closer hand -> higher modulation value
  let modulationValue = Math.floor(clampedNormalized * 127);
  console.log(`Modulation Value (Before Reversal): ${modulationValue}`);

  // **Check if Reversal is Enabled**
  if (reverseModulationCheckbox.checked) {
    modulationValue = Math.floor((1 - clampedNormalized) * 127);
    console.log(`Modulation Value (After Reversal): ${modulationValue}`);
  }

  // Smoothing (optional)
  modulationValuesQueue.push(modulationValue);
  if (modulationValuesQueue.length > smoothingFactor) {
    modulationValuesQueue.shift(); // Remove oldest value
  }

  // Calculate average for smoothing
  const sum = modulationValuesQueue.reduce((a, b) => a + b, 0);
  const average = Math.floor(sum / modulationValuesQueue.length);
  console.log(`Modulation Value (After Smoothing): ${average}`);

  return average;
}

// Function to handle MediaPipe results
function onResults(results) {
  // Increment frame count
  frameCount++;

  // Current time
  const currentTime = performance.now();

  // Calculate elapsed time in seconds
  const elapsedTime = (currentTime - lastTime) / 1000;

  // Update FPS every second
  if (elapsedTime >= 1) {
    fps = frameCount / elapsedTime;
    fpsCounter.textContent = `FPS: ${fps.toFixed(1)}`;
    console.log(`FPS: ${fps.toFixed(1)}`); // Log FPS to console
    // Reset counters
    frameCount = 0;
    lastTime = currentTime;
  }

  // Reset transformations and clear the canvas
  canvasCtx.resetTransform();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // Draw the video frame covering the entire canvas
  canvasCtx.drawImage(
    results.image,
    0,
    0,
    canvasElement.width,
    canvasElement.height
  );

  let leftHandDetected = false;
  let rightHandDetected = false;
  let leftHandOpen = false;
  let rightHandOpen = false;

  if (results.multiHandLandmarks && results.multiHandedness) {
    results.multiHandedness.forEach((hand, index) => {
      // Invert the hand label due to mirroring
      const isRightHand = hand.label === "Left";
      const isLeftHand = hand.label === "Right";

      if (isRightHand) {
        rightHandDetected = true;
        rightHandStatus.textContent = "Right Hand: Detected";
      }

      if (isLeftHand) {
        leftHandDetected = true;
        leftHandStatus.textContent = "Left Hand: Detected";
      }

      // Draw hand landmarks with enhanced visual quality
      drawConnectors(
        canvasCtx,
        results.multiHandLandmarks[index],
        HAND_CONNECTIONS,
        { color: isRightHand ? "#00FF00" : "#FF0000", lineWidth: 3 }
      );
      drawLandmarks(canvasCtx, results.multiHandLandmarks[index], {
        color: isRightHand ? "#00FF00" : "#FF0000",
        lineWidth: 2,
        radius: 3,
      });

      const handLandmarks = results.multiHandLandmarks[index];

      // Update Hand State (Open/Closed)
      const handOpen = isHandWideOpen(handLandmarks);
      if (isRightHand) {
        rightHandState.textContent = `Right Hand State: ${
          handOpen ? "Open" : "Closed"
        }`;
        if (handOpen) {
          rightHandState.classList.add("active");
        } else {
          rightHandState.classList.remove("active");
        }
        rightHandOpen = handOpen;
        isHandOpenActive = handOpen;
      }
      if (isLeftHand) {
        leftHandState.textContent = `Left Hand State: ${
          handOpen ? "Open" : "Closed"
        }`;
        if (handOpen) {
          leftHandState.classList.add("active");
        } else {
          leftHandState.classList.remove("active");
        }
        leftHandOpen = handOpen;
        isHandOpenActive = handOpen;
      }

      // Gesture Control: Pointing Up to Toggle Modulation Wheel
      if (isPointingUp(handLandmarks, isRightHand)) {
        pointingUpCounter++;
        console.log(`Pointing Up Counter: ${pointingUpCounter}`);

        // Update the progress bar
        const progressPercentage = Math.min(
          (pointingUpCounter / gestureConfirmationThreshold) * 100,
          100
        );
        gestureProgressBar.style.width = `${progressPercentage}%`;

        if (
          pointingUpCounter >= gestureConfirmationThreshold &&
          !isPointingUpActive
        ) {
          toggleModulationWheel();
          gestureProgressBar.style.width = `0%`; // Reset after toggle
        }
      } else {
        pointingUpCounter = 0; // Reset counter if gesture not detected
        isPointingUpActive = false; // Reset gesture active state
        gestureProgressBar.style.width = `0%`; // Reset progress bar
      }

      // Modulation Wheel Control based on Hand Distance and Gesture
      if (modulationWheelOn && handOpen && midiOutput) {
        const modulationValue = calculateModulationValue(handLandmarks);
        console.log(`Modulation Wheel Value: ${modulationValue}`);
        // Update Modulation Value Display
        modulationValueDisplay.textContent = `Modulation Value: ${modulationValue}`;
        // Send MIDI Control Change for Modulation Wheel (CC1) on Channel 1
        sendMIDIMessage(0xb0, 1, modulationValue); // 0xB0 = CC1 on channel 1
      } else if (!modulationWheelOn && handOpen && midiOutput) {
        // Ensure modulation value remains frozen when modulation wheel is off
        // Do not update the modulation value display
      }
    });
  } else {
    leftHandStatus.textContent = "Left Hand: Not Detected";
    rightHandStatus.textContent = "Right Hand: Not Detected";
    leftHandState.textContent = "Left Hand State: Closed";
    rightHandState.textContent = "Right Hand State: Closed";
    modulationValueDisplay.textContent = `Modulation Value: 0`;
    pointingUpCounter = 0;
    isPointingUpActive = false;
    gestureProgressBar.style.width = `0%`; // Reset progress bar
  }

  // Reset status if hands are not detected
  if (!leftHandDetected) {
    leftHandStatus.textContent = "Left Hand: Not Detected";
    leftHandState.textContent = "Left Hand State: Closed";
  }
  if (!rightHandDetected) {
    rightHandStatus.textContent = "Right Hand: Not Detected";
    rightHandState.textContent = "Right Hand State: Closed";
  }

  // Reset modulation value display if modulation wheel is off
  if (!modulationWheelOn) {
    // Keep the current modulation value displayed without updating
    // No action needed as we freeze the value when toggling off
  }
}

// Function to toggle the Modulation Wheel
function toggleModulationWheel() {
  const currentTime = Date.now();
  if (currentTime - lastGestureTime < gestureCooldown) {
    // Prevent toggling if within cooldown period
    return;
  }

  modulationWheelOn = !modulationWheelOn;
  console.log(`Modulation Wheel Toggled: ${modulationWheelOn ? "On" : "Off"}`);

  // Update Modulation Status Text and Classes
  modulationStatus.textContent = `Modulation Wheel: ${
    modulationWheelOn ? "ON" : "OFF"
  }`;
  modulationStatus.classList.toggle("connected", modulationWheelOn);
  modulationStatus.classList.toggle("disconnected", !modulationWheelOn);

  if (!modulationWheelOn) {
    // Freeze the current modulation value
    modulationValueDisplay.textContent = `Modulation Value: ${
      modulationValuesQueue.length > 0
        ? modulationValuesQueue[modulationValuesQueue.length - 1]
        : 0
    }`;
  }

  // Update the last gesture time
  lastGestureTime = currentTime;
  isPointingUpActive = true; // Set gesture as active to prevent immediate re-toggling
}

// Function to synchronize sliders and numerical inputs
function syncSliderAndNumber(slider, numberInput, isMin = true) {
  // When slider changes, update number input
  slider.addEventListener("input", (event) => {
    let value = parseFloat(event.target.value);
    value = parseFloat(value.toFixed(3)); // Limit to 3 decimal places

    if (isMin) {
      // Ensure minDistance does not exceed maxDistance
      if (value >= maxDistance) {
        value = maxDistance - 0.005;
        slider.value = value.toFixed(3);
      }
      minDistance = value;
      minDistanceNumber.value = value.toFixed(3);
    } else {
      // Ensure maxDistance does not go below minDistance
      if (value <= minDistance) {
        value = minDistance + 0.005;
        slider.value = value.toFixed(3);
      }
      maxDistance = value;
      maxDistanceNumber.value = value.toFixed(3);
    }
  });

  // When number input changes, update slider
  numberInput.addEventListener("input", (event) => {
    let value = parseFloat(event.target.value);
    // Clamp the value between 0 and 1
    value = clamp(value, 0.0, 1.0);
    value = parseFloat(value.toFixed(3)); // Limit to 3 decimal places

    if (isMin) {
      // Ensure minDistance does not exceed maxDistance
      if (value >= maxDistance) {
        value = maxDistance - 0.005;
      }
      minDistance = value;
      minDistanceSlider.value = value.toFixed(3);
      minDistanceNumber.value = value.toFixed(3);
    } else {
      // Ensure maxDistance does not go below minDistance
      if (value <= minDistance) {
        value = minDistance + 0.005;
      }
      maxDistance = value;
      maxDistanceSlider.value = value.toFixed(3);
      maxDistanceNumber.value = value.toFixed(3);
    }
  });
}

// Initialize synchronization for sliders and numerical inputs
syncSliderAndNumber(minDistanceSlider, minDistanceNumber, true);
syncSliderAndNumber(maxDistanceSlider, maxDistanceNumber, false);

// Event Listeners for Gesture Strictness Level Dropdowns
openHandStrictnessDropdown.addEventListener("change", (event) => {
  openHandStrictness = parseInt(event.target.value);
  console.log(`Open Hand Strictness Level set to: ${openHandStrictness}`);
});

pointingUpStrictnessDropdown.addEventListener("change", (event) => {
  pointingUpStrictness = parseInt(event.target.value);
  console.log(`Pointing Up Strictness Level set to: ${pointingUpStrictness}`);
});
