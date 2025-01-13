// app.js - Refined Gesture Detection without Calibration Controls

// =========================
// DOM Element Selections
// =========================
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
const overlapThresholdSlider = document.getElementById("overlap-threshold");
const overlapThresholdNumber = document.getElementById(
  "overlap-threshold-number"
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

// Camera Selection Dropdown
const cameraPortsDropdown = document.getElementById("camera-ports");

// =========================
// Hand Selection Elements
// =========================

// Radio buttons for hand selection
const gestureHandRadioButtons = document.getElementsByName("gesture-hand");

// Variable to store the selected hand ('left' or 'right')
let selectedHand = "left"; // Default as per HTML's checked value

// Add event listeners to update selectedHand when radio buttons change
gestureHandRadioButtons.forEach((radio) => {
  radio.addEventListener("change", (event) => {
    if (event.target.checked) {
      selectedHand = event.target.value;
      console.log(`Selected hand for gesture controls: ${selectedHand}`);
      // Optionally, reset modulation wheel when hand selection changes
      modulationWheelOn = false;
      modulationStatus.textContent = `Modulation Wheel: OFF`;
      modulationStatus.classList.remove("on");
      modulationStatus.classList.add("off");
      modulationValueDisplay.textContent = `Modulation Value: 0`;
    }
  });
});

// =========================
// MediaPipe Hands Initialization
// =========================
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

// =========================
// Gesture Control Variables
// =========================
let modulationWheelOn = false; // State of modulation wheel
let lastGestureTime = 0; // Timestamp of last gesture to enforce cooldown
const gestureCooldown = 1000; // 1 second cooldown in milliseconds

// Configurable Hand Distance Variables
let minDistance = parseFloat(minDistanceSlider.value); // Initialize from slider
let maxDistance = parseFloat(maxDistanceSlider.value); // Initialize from slider

// Overlap Threshold Variable
let overlapThreshold = parseFloat(overlapThresholdSlider.value); // Initialize from slider

// MIDI Access and Output
let midiAccess = null;
let midiOutput = null;

// Implement a smoothing mechanism
let modulationValuesQueue = [];
const smoothingFactor = 5; // Number of frames to average

// Gesture Strictness Levels (1-10)
let openHandStrictness = 5; // Default value
let pointingUpStrictness = 5; // Default value

// Gesture State Tracking
let isPointingUpActive = false;

// Gesture Confirmation Counters
const gestureConfirmationThreshold = 5; // Number of consecutive frames gesture must be held

let pointingUpCounter = 0;

// FPS Calculation Variables
let frameCount = 0;
let fps = 0;
let lastTime = performance.now(); // Ensure this is declared only once

// Current MediaStream
let currentStream = null;

// Flag to prevent multiple loops
let processing = false;

// =========================
// MIDI Throttling Variables
// =========================
let lastMIDITime = 0;
const midiThrottleInterval = 10; // in milliseconds (~100 FPS)

// Flag for debounce
let lastToggleTime = 0;
const toggleDebounceTime = 1000; // 1 second

// =========================
// Canvas Initialization
// =========================
function initializeCanvas() {
  const scale = window.devicePixelRatio || 1;
  canvasElement.width = 960 * scale; // Internal canvas width
  canvasElement.height = 540 * scale; // Internal canvas height
  canvasElement.style.width = "960px"; // CSS width
  canvasElement.style.height = "540px"; // CSS height
  canvasCtx.scale(scale, scale);
  console.log("Canvas initialized with scaling:", scale);
}

// Listen for video metadata loaded to set canvas size
videoElement.addEventListener("loadedmetadata", () => {
  console.log("Video metadata loaded.");
  initializeCanvas();

  // Verify actual video settings
  const videoTrack = currentStream?.getVideoTracks()[0];
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

// =========================
// Video Processing
// =========================
async function processVideoFrame() {
  if (processing) return; // Prevent multiple instances
  processing = true;

  const sendFrame = async () => {
    if (videoElement.readyState >= 2) {
      // HAVE_CURRENT_DATA
      try {
        await hands.send({ image: videoElement });
      } catch (error) {
        console.error("Error sending frame to MediaPipe Hands:", error);
      }
    }
    requestAnimationFrame(sendFrame);
  };

  sendFrame();
}

// =========================
// Camera Handling
// =========================
async function populateCameraPorts() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(
      (device) => device.kind === "videoinput"
    );

    // Clear existing options
    cameraPortsDropdown.innerHTML =
      '<option value="">-- Select Camera --</option>';

    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      cameraPortsDropdown.appendChild(option);
    });

    // Attempt to select the internal camera by default
    const internalKeywords = ["internal", "built-in", "default", "integrated"];
    const internalDevice = videoDevices.find((device) =>
      internalKeywords.some((keyword) =>
        device.label.toLowerCase().includes(keyword)
      )
    );

    if (internalDevice) {
      cameraPortsDropdown.value = internalDevice.deviceId;
      console.log(`Auto-selecting internal camera: ${internalDevice.label}`);
      startCameraStream(internalDevice.deviceId);
    } else if (videoDevices.length > 0) {
      // If no internal camera found, select the first available
      cameraPortsDropdown.value = videoDevices[0].deviceId;
      console.log(
        `Auto-selecting first available camera: ${videoDevices[0].label}`
      );
      startCameraStream(videoDevices[0].deviceId);
    } else {
      console.warn("No video input devices found.");
      cameraPortsDropdown.innerHTML =
        '<option value="">-- No Cameras Available --</option>';
    }
  } catch (error) {
    console.error("Error enumerating devices:", error);
    cameraPortsDropdown.innerHTML =
      '<option value="">-- Error Loading Cameras --</option>';
  }
}

// Function to start the camera stream with the selected device ID
async function startCameraStream(deviceId) {
  try {
    // Stop existing stream if any
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      console.log("Stopped previous camera stream.");
    }

    // Get the new stream
    const constraints = {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    currentStream = stream;
    console.log(`Started camera stream with device ID: ${deviceId}`);

    // Ensure video starts playing
    await videoElement.play();

    // Start processing frames
    processVideoFrame();
  } catch (error) {
    console.error(
      `Failed to start camera stream with device ID: ${deviceId}`,
      error
    );
    alert(`Failed to start camera stream: ${error.message}`);
  }
}

// Event Listener for Camera Ports Dropdown Change
cameraPortsDropdown.addEventListener("change", (event) => {
  const selectedDeviceId = event.target.value;
  if (selectedDeviceId === "") {
    console.log("No camera selected.");
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
      videoElement.srcObject = null;
    }
    return;
  }
  console.log(`Camera selected: Device ID = ${selectedDeviceId}`);
  startCameraStream(selectedDeviceId);
});

// Initialize Camera Ports on Page Load
window.addEventListener("load", () => {
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    populateCameraPorts();

    // Listen for device changes to update camera list dynamically
    navigator.mediaDevices.addEventListener("devicechange", () => {
      console.log("Device change detected. Updating camera list.");
      populateCameraPorts();
    });
  } else {
    console.warn("Media Devices API not supported.");
    cameraPortsDropdown.innerHTML =
      '<option value="">-- Media Devices API Not Supported --</option>';
  }

  // MIDI Access Initialization
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

  // Synchronize Control Groups
  synchronizeControls();
});

// =========================
// MIDI Handling
// =========================

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
    midiStatus.classList.remove("connected", "on");
    midiStatus.classList.add("disconnected", "off");
    disconnectMIDIBtn.disabled = true;
  } else if (!midiOutput) {
    midiStatus.textContent = "MIDI Status: Disconnected";
    midiStatus.classList.remove("connected", "on");
    midiStatus.classList.add("disconnected", "off");
    disconnectMIDIBtn.disabled = true;
  } else {
    midiStatus.textContent = "MIDI Status: Connected";
    midiStatus.classList.remove("disconnected", "off");
    midiStatus.classList.add("connected", "on");
    disconnectMIDIBtn.disabled = false;
  }
}

// Function to update MIDI Status Indicator
function updateMIDIStatus() {
  if (midiOutput) {
    midiStatus.textContent = "MIDI Status: Connected";
    midiStatus.classList.remove("disconnected", "off");
    midiStatus.classList.add("connected", "on");
    disconnectMIDIBtn.disabled = false;
  } else {
    midiStatus.textContent = "MIDI Status: Disconnected";
    midiStatus.classList.remove("connected", "on");
    midiStatus.classList.add("disconnected", "off");
    disconnectMIDIBtn.disabled = true;
  }
}

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
    midiStatus.classList.remove("connected", "on");
    midiStatus.classList.add("disconnected", "off");
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

// =========================
// MIDI Message Sending
// =========================

/**
 * Sends a MIDI message with throttling and validation.
 * @param {number} command - MIDI command byte.
 * @param {number} controller - MIDI controller number.
 * @param {number} value - MIDI controller value.
 */
function sendMIDIMessage(command, controller, value) {
  const currentTime = performance.now();
  if (currentTime - lastMIDITime >= midiThrottleInterval) {
    // Clamp the MIDI values to valid ranges
    const clampedController = clamp(controller, 0, 127);
    const clampedValue = clamp(value, 0, 127);

    try {
      if (midiOutput) {
        // Ensure value is a valid number
        if (isNaN(clampedValue)) {
          console.warn(`Attempted to send invalid MIDI value: ${clampedValue}`);
          return;
        }

        midiOutput.send([command, clampedController, clampedValue]);
        lastMIDITime = currentTime;
        // Removed excessive logging for performance
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

/**
 * Clamps a value between a minimum and maximum.
 * @param {number} value - The value to clamp.
 * @param {number} min - The minimum allowable value.
 * @param {number} max - The maximum allowable value.
 * @returns {number} - The clamped value.
 */
function clamp(value, min, max) {
  if (typeof value !== "number" || isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

// =========================
// Gesture Detection
// =========================

/**
 * Calculates the angle between three points.
 * @param {Object} p1 - First point with x and y properties.
 * @param {Object} p2 - Second point with x and y properties (vertex).
 * @param {Object} p3 - Third point with x and y properties.
 * @returns {number} - The angle in degrees.
 */
function calculateAngle(p1, p2, p3) {
  const radians =
    Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
  let angle = Math.abs(radians * (180.0 / Math.PI));

  if (angle > 180.0) {
    angle = 360 - angle;
  }
  return angle;
}

/**
 * Detects if the hand is making a pointing up gesture.
 * @param {Array} landmarks - Hand landmarks.
 * @param {number} strictness - Strictness level (1-10) for gesture sensitivity.
 * @returns {boolean} - Whether the pointing gesture is detected.
 */
function isPointingUp(landmarks, strictness) {
  if (!landmarks || landmarks.length < 21) {
    console.warn("Invalid hand landmarks detected.");
    return false;
  }

  // Check if the index finger is extended
  const indexExtended = isFingerExtended(
    landmarks,
    5, // INDEX_FINGER_MCP
    6, // INDEX_FINGER_PIP
    7, // INDEX_FINGER_DIP
    8, // INDEX_FINGER_TIP
    strictness
  );

  // Check that all other fingers (middle, ring, pinky) are tightly curled
  const middleCurled = isFingerTightlyCurled(
    landmarks,
    9,
    10,
    11,
    12, // MIDDLE_FINGER_MCP, PIP, DIP, TIP
    strictness
  );
  const ringCurled = isFingerTightlyCurled(
    landmarks,
    13,
    14,
    15,
    16, // RING_FINGER_MCP, PIP, DIP, TIP
    strictness
  );
  const pinkyCurled = isFingerTightlyCurled(
    landmarks,
    17,
    18,
    19,
    20, // PINKY_FINGER_MCP, PIP, DIP, TIP
    strictness
  );

  // Ensure the index finger tip is above the wrist (natural pointing condition)
  const wrist = landmarks[0];
  const indexTip = landmarks[8];
  const indexAboveWrist = indexTip.y < wrist.y;

  // Check thumb condition - Ensure the thumb is curled (overlapping/curling)
  const thumbCurled = isThumbCurled(landmarks, strictness);

  // Pointing up gesture requires:
  // - Index finger extended
  // - Middle, ring, and pinky fingers tightly curled
  // - Thumb curled (overlapping/curling)
  // - Index finger tip above wrist
  const isPointingUpGesture =
    indexExtended &&
    thumbCurled &&
    middleCurled &&
    ringCurled &&
    pinkyCurled &&
    indexAboveWrist;

  console.log(
    `Gesture Detection: Index Extended=${indexExtended}, Thumb Curled=${thumbCurled}, Middle Tightly Curled=${middleCurled}, Ring Tightly Curled=${ringCurled}, Pinky Tightly Curled=${pinkyCurled}, Index Above Wrist=${indexAboveWrist} => Gesture=${isPointingUpGesture}`
  );

  return isPointingUpGesture;
}

/**
 * Determines if a specific finger is extended based on landmark positions and strictness.
 * @param {Array} handLandmarks - Array of hand landmarks.
 * @param {number} mcp - MCP joint index of the finger.
 * @param {number} pip - PIP joint index of the finger.
 * @param {number} dip - DIP joint index of the finger.
 * @param {number} tip - TIP joint index of the finger.
 * @param {number} strictness - Strictness level (1-10).
 * @returns {boolean} - True if the finger is extended, else false.
 */
function isFingerExtended(handLandmarks, mcp, pip, dip, tip, strictness) {
  // In image coordinates, y increases downward
  // Finger is extended if tip.y < pip.y
  // Strictness adjusts the required y difference

  const yDifference = handLandmarks[pip].y - handLandmarks[tip].y;

  // Define a threshold based on strictness (higher strictness requires larger difference)
  const baseThreshold = 0.015; // Increased base threshold for stricter extension
  const delta = 0.01; // Adjusted delta for smoother scaling

  const threshold = baseThreshold + delta * (strictness - 1);

  // Finger is extended if the y difference exceeds the threshold
  const isExtended = yDifference > threshold;

  // Log the finger extension status for debugging
  console.log(
    `Finger [MCP:${mcp} PIP:${pip} DIP:${dip} TIP:${tip}] yDifference: ${yDifference.toFixed(
      3
    )} | Threshold: ${threshold.toFixed(3)} | Extended: ${isExtended}`
  );

  return isExtended;
}

/**
 * Determines if a specific finger is tightly curled based on landmark positions and strictness.
 * Ensures that the fingertip is approximately ⅔ down to the palm base.
 * @param {Array} handLandmarks - Array of hand landmarks.
 * @param {number} mcp - MCP joint index of the finger.
 * @param {number} pip - PIP joint index of the finger.
 * @param {number} dip - DIP joint index of the finger.
 * @param {number} tip - TIP joint index of the finger.
 * @param {number} strictness - Strictness level (1-10).
 * @returns {boolean} - True if the finger is tightly curled with fingertip near desired position, else false.
 */
function isFingerTightlyCurled(handLandmarks, mcp, pip, dip, tip, strictness) {
  // In image coordinates, y increases downward
  // Finger is tightly curled if tip.y is approximately ⅔ down to the palm
  // AND the fingertip is at the desired distance from the wrist

  // Calculate the expected y-coordinate for ⅔ down to the palm
  const wrist = handLandmarks[0];
  const mcpLandmark = handLandmarks[mcp];
  const expectedTipY = wrist.y + (mcpLandmark.y - wrist.y) * (2 / 3);

  // Allow a margin based on strictness
  const margin = 0.02 * (11 - strictness); // Less margin as strictness increases

  const actualTipY = handLandmarks[tip].y;

  const isApproachingTarget =
    actualTipY > expectedTipY - margin && actualTipY < expectedTipY + margin;

  // Additionally, ensure fingertip is not too close to the wrist
  const fingertip = handLandmarks[tip];
  const distanceToWrist = Math.sqrt(
    Math.pow(fingertip.x - wrist.x, 2) + Math.pow(fingertip.y - wrist.y, 2)
  );

  // Define a distance threshold to prevent fingertips from being too close
  const distanceThreshold = 0.15; // Adjust as needed

  const isAtProperDistance = distanceToWrist > distanceThreshold;

  // Log the finger curled status for debugging
  console.log(
    `Finger [MCP:${mcp} PIP:${pip} DIP:${dip} TIP:${tip}] Actual Tip Y: ${actualTipY.toFixed(
      3
    )} | Expected Tip Y: ${expectedTipY.toFixed(
      3
    )} | Within Margin: ${isApproachingTarget}`
  );
  console.log(
    `Finger [TIP:${tip}] Distance to Wrist: ${distanceToWrist.toFixed(
      3
    )} | Threshold: ${distanceThreshold.toFixed(
      3
    )} | At Proper Distance: ${isAtProperDistance}`
  );

  // Finger is considered tightly curled if it's approaching the target position and at the proper distance
  return isApproachingTarget && isAtProperDistance;
}

/**
 * Determines if the thumb is curled based on its position relative to the palm center.
 * The thumb should be in the middle of the palm when curled.
 * @param {Array} handLandmarks - Array of hand landmarks.
 * @param {number} strictness - Strictness level (1-10).
 * @returns {boolean} - True if thumb is curled in the middle of the palm, else false.
 */
function isThumbCurled(handLandmarks, strictness) {
  // Retrieve necessary landmarks
  const thumbTIP = handLandmarks[4]; // Thumb TIP
  const palmCenter = {
    x: (handLandmarks[0].x + handLandmarks[9].x) / 2, // Average of wrist and MCP of middle finger
    y: (handLandmarks[0].y + handLandmarks[9].y) / 2,
  };

  // Calculate Euclidean distance between thumb TIP and palm center
  const distanceTipToCenter = Math.sqrt(
    Math.pow(thumbTIP.x - palmCenter.x, 2) +
      Math.pow(thumbTIP.y - palmCenter.y, 2)
  );

  // Define a distance threshold based on strictness
  // Higher strictness requires the thumb TIP to be closer to the palm center
  const baseThreshold = 0.15; // Increased base distance threshold for less strictness
  const delta = 0.005; // Increment per strictness level

  const threshold = baseThreshold - delta * (strictness - 1);
  const finalThreshold = Math.max(threshold, 0.1); // Prevent threshold from being too low

  console.log(
    `Thumb TIP to Palm Center Distance: ${distanceTipToCenter.toFixed(
      3
    )} | Threshold: ${finalThreshold.toFixed(3)} | Curled: ${
      distanceTipToCenter < finalThreshold
    }`
  );

  // Thumb is considered curled if the distance is below the threshold
  return distanceTipToCenter < finalThreshold;
}

/**
 * Checks if the hand is wide open by verifying all fingers are extended.
 * @param {Array} handLandmarks - Array of hand landmarks.
 * @returns {boolean} - True if all fingers are extended, else false.
 */
function isHandWideOpen(handLandmarks) {
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

// =========================
// Modulation Wheel Control
// =========================

/**
 * Toggles the modulation wheel on or off.
 */
function toggleModulationWheel() {
  const currentTime = Date.now();
  if (currentTime - lastToggleTime < toggleDebounceTime) {
    // Prevent toggling if within debounce period
    console.log("Toggle action is debounced.");
    return;
  }

  modulationWheelOn = !modulationWheelOn;
  console.log(`Modulation Wheel Toggled: ${modulationWheelOn ? "On" : "Off"}`);

  // Update Modulation Status Text and Classes
  modulationStatus.textContent = `Modulation Wheel: ${
    modulationWheelOn ? "ON" : "OFF"
  }`;

  // Toggle 'on' and 'off' classes to align with CSS
  modulationStatus.classList.toggle("on", modulationWheelOn);
  modulationStatus.classList.toggle("off", !modulationWheelOn);

  if (!modulationWheelOn) {
    // Freeze the current modulation value
    const lastValue =
      modulationValuesQueue.length > 0
        ? modulationValuesQueue[modulationValuesQueue.length - 1]
        : 0;
    modulationValueDisplay.textContent = `Modulation Value: ${lastValue}`;
    console.log("Modulation Wheel turned OFF. Value frozen.");
  }

  // Update the last toggle time
  lastToggleTime = currentTime;
}

// =========================
// Gesture Detection and Handling
// =========================

/**
 * Handles the results from MediaPipe Hands.
 * @param {Object} results - The results object from MediaPipe Hands.
 */
function onResults(results) {
  try {
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

    // Reset hand detection statuses
    leftHandDetected = false;
    rightHandDetected = false;
    leftHandOpen = false;
    rightHandOpen = false;

    if (results.multiHandLandmarks && results.multiHandedness) {
      results.multiHandedness.forEach((hand, index) => {
        const landmarks = results.multiHandLandmarks[index];
        const handedness = hand.label; // "Left" or "Right"

        // **Invert the handedness labels to account for CSS mirroring**
        const isRightHand = handedness === "Left"; // Inverted due to mirroring
        const isLeftHand = handedness === "Right"; // Inverted due to mirroring

        // Log detected hands
        console.log(
          `Detected Hand: ${
            isLeftHand ? "Left" : isRightHand ? "Right" : "Unknown"
          }`
        );

        if (isRightHand) {
          rightHandDetected = true;
          rightHandStatus.textContent = "Right Hand: Detected";
        }

        if (isLeftHand) {
          leftHandDetected = true;
          leftHandStatus.textContent = "Left Hand: Detected";
        }

        // Draw hand landmarks with enhanced visual quality
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
          color: isRightHand ? "#00FF00" : "#FF0000",
          lineWidth: 3,
        });
        drawLandmarks(canvasCtx, landmarks, {
          color: isRightHand ? "#00FF00" : "#FF0000",
          lineWidth: 2,
          radius: 3,
        });

        // **Add Visual Indicators on Hand Landmarks**
        // [Existing code for drawing landmarks and annotations]

        // Update Hand State (Open/Closed)
        const handOpen = isHandWideOpen(landmarks);
        if (isRightHand) {
          rightHandState.textContent = `Right Hand State: ${
            handOpen ? "Open" : "Closed"
          }`;
          rightHandState.classList.toggle("active", handOpen);
          rightHandOpen = handOpen;
        }
        if (isLeftHand) {
          leftHandState.textContent = `Left Hand State: ${
            handOpen ? "Open" : "Closed"
          }`;
          leftHandState.classList.toggle("active", handOpen);
          leftHandOpen = handOpen;
        }

        // **Process Gestures Only for Selected Hand**
        let isSelectedHand = false;
        if (selectedHand === "left" && isLeftHand) {
          isSelectedHand = true;
        } else if (selectedHand === "right" && isRightHand) {
          isSelectedHand = true;
        }

        if (isSelectedHand) {
          // Initialize or retrieve gesture state for the selected hand
          if (typeof gestureState === "undefined") {
            gestureState = {
              isPointingUpActive: false,
              pointingUpCounter: 0,
            };
          }

          // **Pointing Up Gesture Detection**
          if (isPointingUp(landmarks, pointingUpStrictness)) {
            gestureState.pointingUpCounter++;
            // Update the progress bar
            const progressPercentage = Math.min(
              (gestureState.pointingUpCounter / gestureConfirmationThreshold) *
                100,
              100
            );
            gestureProgressBar.style.width = `${progressPercentage}%`;

            if (
              gestureState.pointingUpCounter >= gestureConfirmationThreshold &&
              !gestureState.isPointingUpActive
            ) {
              toggleModulationWheel(); // Activate or deactivate modulation wheel
              gestureProgressBar.style.width = `0%`; // Reset progress bar
              gestureState.pointingUpCounter = 0; // Reset counter
              gestureState.isPointingUpActive = true; // Prevent immediate re-toggling
            }
          } else {
            gestureState.pointingUpCounter = 0; // Reset counter if gesture not detected
            gestureState.isPointingUpActive = false; // Reset gesture active state
            gestureProgressBar.style.width = `0%`; // Reset progress bar
          }

          // **Handle MIDI Controls Only for Selected Hand**
          if (modulationWheelOn && handOpen && midiOutput) {
            const modulationValue = calculateModulationValue(landmarks);
            // Update Modulation Value Display
            modulationValueDisplay.textContent = `Modulation Value: ${modulationValue}`;
            // Send MIDI Control Change for Modulation Wheel (CC1) on Channel 1
            sendMIDIMessage(0xb0, 1, modulationValue); // 0xB0 = CC1 on channel 1
          }
        }
        // No action needed when modulationWheelOn is false and hand is open
      });
    } else {
      // No hands detected
      leftHandStatus.textContent = "Left Hand: Not Detected";
      rightHandStatus.textContent = "Right Hand: Not Detected";
      leftHandState.textContent = "Left Hand State: Closed";
      rightHandState.textContent = "Right Hand State: Closed";
      modulationValueDisplay.textContent = `Modulation Value: 0`;
      gestureProgressBar.style.width = `0%`; // Reset progress bar
      gestureState = {
        isPointingUpActive: false,
        pointingUpCounter: 0,
      };
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
  } catch (error) {
    console.error("Error in onResults function:", error);
    // Optionally, implement more sophisticated error handling here
  }
}

/**
 * Calculates the modulation wheel value based on hand distance.
 * @param {Array} handLandmarks - Array of hand landmarks.
 * @returns {number} - The modulation value (0-127).
 */
function calculateModulationValue(handLandmarks) {
  // Calculate the bounding box height as a proxy for distance
  let minY = Infinity;
  let maxY = -Infinity;

  handLandmarks.forEach((landmark) => {
    if (landmark.y < minY) minY = landmark.y;
    if (landmark.y > maxY) maxY = landmark.y;
  });

  const boundingBoxHeight = maxY - minY;

  // Normalize boundingBoxHeight between minDistance and maxDistance
  let normalized =
    (boundingBoxHeight - minDistance) / (maxDistance - minDistance);

  // Clamp normalized value between 0 and 1
  normalized = clamp(normalized, 0, 1);

  // Map to MIDI value (0-127)
  let modulationValue = Math.floor(normalized * 127);

  // Check if Reversal is Enabled
  if (reverseModulationCheckbox.checked) {
    modulationValue = Math.floor((1 - normalized) * 127);
  }

  // Smoothing (optional)
  modulationValuesQueue.push(modulationValue);
  if (modulationValuesQueue.length > smoothingFactor) {
    modulationValuesQueue.shift(); // Remove oldest value
  }

  // Calculate average for smoothing
  const sum = modulationValuesQueue.reduce((a, b) => a + b, 0);
  const average = Math.floor(sum / modulationValuesQueue.length);

  return average;
}

/**
 * Clamps a value between a minimum and maximum.
 * @param {number} value - The value to clamp.
 * @param {number} min - The minimum allowable value.
 * @param {number} max - The maximum allowable value.
 * @returns {number} - The clamped value.
 */
function clamp(value, min, max) {
  if (typeof value !== "number" || isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

// =========================
// Initialization Functions
// =========================

/**
 * Synchronizes all control groups (distance and strictness).
 */
function synchronizeControls() {
  if (
    minDistanceSlider &&
    minDistanceNumber &&
    maxDistanceSlider &&
    maxDistanceNumber
  ) {
    syncSliderAndNumber(minDistanceSlider, minDistanceNumber, true);
    syncSliderAndNumber(maxDistanceSlider, maxDistanceNumber, false);
  } else {
    console.warn(
      "Distance controls are missing in the HTML. Please ensure that elements with IDs 'min-distance', 'min-distance-number', 'max-distance', and 'max-distance-number' exist."
    );
  }

  if (overlapThresholdSlider && overlapThresholdNumber) {
    syncOverlapThreshold();
  } else {
    console.warn(
      "Overlap Threshold controls are missing in the HTML. Please ensure that elements with IDs 'overlap-threshold' and 'overlap-threshold-number' exist."
    );
  }

  // Listen for changes in strictness level dropdowns
  const openHandStrictnessDropdown = document.getElementById(
    "open-hand-strictness"
  );
  const pointingUpStrictnessDropdown = document.getElementById(
    "pointing-up-strictness"
  );

  if (openHandStrictnessDropdown) {
    openHandStrictnessDropdown.addEventListener("change", (event) => {
      openHandStrictness = parseInt(event.target.value);
      console.log(`Open Hand Strictness Level set to: ${openHandStrictness}`);
    });
  } else {
    console.warn(
      "Open Hand Strictness Dropdown is missing in the HTML. Please ensure that element with ID 'open-hand-strictness' exists."
    );
  }

  if (pointingUpStrictnessDropdown) {
    pointingUpStrictnessDropdown.addEventListener("change", (event) => {
      pointingUpStrictness = parseInt(event.target.value);
      console.log(
        `Pointing Up Strictness Level set to: ${pointingUpStrictness}`
      );
    });
  } else {
    console.warn(
      "Pointing Up Strictness Dropdown is missing in the HTML. Please ensure that element with ID 'pointing-up-strictness' exists."
    );
  }
}

/**
 * Synchronizes a slider and number input pair.
 * @param {HTMLElement} slider - The slider input element.
 * @param {HTMLElement} numberInput - The number input element.
 * @param {boolean} isMin - Indicates if the pair is for minimum distance.
 */
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
      numberInput.value = value.toFixed(3);
      console.log(`Minimum Distance set to: ${minDistance}`);
    } else {
      // Ensure maxDistance does not go below minDistance
      if (value <= minDistance) {
        value = minDistance + 0.005;
        slider.value = value.toFixed(3);
      }
      maxDistance = value;
      numberInput.value = value.toFixed(3);
      console.log(`Maximum Distance set to: ${maxDistance}`);
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
      slider.value = value.toFixed(3);
      numberInput.value = value.toFixed(3);
      console.log(`Minimum Distance set to: ${minDistance}`);
    } else {
      // Ensure maxDistance does not go below minDistance
      if (value <= minDistance) {
        value = minDistance + 0.005;
      }
      maxDistance = value;
      slider.value = value.toFixed(3);
      numberInput.value = value.toFixed(3);
      console.log(`Maximum Distance set to: ${maxDistance}`);
    }
  });
}

/**
 * Synchronizes the overlap threshold slider and number input.
 */
function syncOverlapThreshold() {
  // When slider changes, update number input
  overlapThresholdSlider.addEventListener("input", (event) => {
    overlapThreshold = parseFloat(event.target.value);
    overlapThresholdNumber.value = overlapThreshold.toFixed(2);
    console.log(`Thumb Overlap Threshold set to: ${overlapThreshold}`);
  });

  // When number input changes, update slider
  overlapThresholdNumber.addEventListener("input", (event) => {
    let value = parseFloat(event.target.value);
    value = clamp(value, 0.01, 0.1);
    overlapThreshold = value;
    overlapThresholdSlider.value = value.toFixed(2);
    console.log(`Thumb Overlap Threshold set to: ${overlapThreshold}`);
  });
}

// =========================
// Final Initialization on Load
// =========================
window.addEventListener("load", () => {
  // Camera Ports and MIDI Initialization handled above
  // All necessary synchronization is done in synchronizeControls()
});
