import cv2
import mediapipe as mp
import time
import subprocess
import numpy as np
from PyQt5.QtWidgets import QApplication, QMainWindow, QLabel, QComboBox, QVBoxLayout, QWidget, QHBoxLayout
from PyQt5.QtGui import QImage, QPixmap, QPainter, QColor
from PyQt5.QtCore import QTimer, Qt, QRect
import rtmidi  # For creating a virtual MIDI port

# Initialize MediaPipe Hands
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
    max_num_hands=2,
    model_complexity=0  # Lightweight model for faster processing
)

# Initialize the video capture
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("Error: Could not open webcam.")
    exit()

# Create a virtual MIDI port
def create_virtual_midi_port(port_name="VirtualMidiPort"):
    """Create a virtual MIDI port using rtmidi."""
    midi_out = rtmidi.MidiOut()
    midi_out.open_virtual_port(port_name)
    print(f"Virtual MIDI port '{port_name}' created.")
    return midi_out

midi_out = create_virtual_midi_port()

# Helper functions for gesture detection
def is_hand_strictly_open(hand_landmarks):
    for finger_tip, dip, pip in [
        (mp_hands.HandLandmark.THUMB_TIP, mp_hands.HandLandmark.THUMB_IP, mp_hands.HandLandmark.THUMB_MCP),
        (mp_hands.HandLandmark.INDEX_FINGER_TIP, mp_hands.HandLandmark.INDEX_FINGER_DIP, mp_hands.HandLandmark.INDEX_FINGER_PIP),
        (mp_hands.HandLandmark.MIDDLE_FINGER_TIP, mp_hands.HandLandmark.MIDDLE_FINGER_DIP, mp_hands.HandLandmark.MIDDLE_FINGER_PIP),
        (mp_hands.HandLandmark.RING_FINGER_TIP, mp_hands.HandLandmark.RING_FINGER_DIP, mp_hands.HandLandmark.RING_FINGER_PIP),
        (mp_hands.HandLandmark.PINKY_TIP, mp_hands.HandLandmark.PINKY_DIP, mp_hands.HandLandmark.PINKY_PIP),
    ]:
        tip = hand_landmarks.landmark[finger_tip]
        dip = hand_landmarks.landmark[dip]
        pip = hand_landmarks.landmark[pip]

        if np.linalg.norm([tip.x - dip.x, tip.y - dip.y]) < 0.05 or \
           np.linalg.norm([tip.x - pip.x, tip.y - pip.y]) < 0.10:
            return False
    return True

def calculate_hand_size(hand_landmarks):
    index_base = hand_landmarks.landmark[mp_hands.HandLandmark.INDEX_FINGER_MCP]
    pinky_base = hand_landmarks.landmark[mp_hands.HandLandmark.PINKY_MCP]
    distance = np.linalg.norm([(index_base.x - pinky_base.x), (index_base.y - pinky_base.y)])
    return distance

def is_strictly_pointing_up(hand_landmarks):
    index_tip = hand_landmarks.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
    index_dip = hand_landmarks.landmark[mp_hands.HandLandmark.INDEX_FINGER_DIP]
    middle_tip = hand_landmarks.landmark[mp_hands.HandLandmark.MIDDLE_FINGER_TIP]
    ring_tip = hand_landmarks.landmark[mp_hands.HandLandmark.RING_FINGER_TIP]
    pinky_tip = hand_landmarks.landmark[mp_hands.HandLandmark.PINKY_TIP]

    pointing_up = (
        index_tip.y < index_dip.y and
        middle_tip.y > index_dip.y and
        ring_tip.y > index_dip.y and
        pinky_tip.y > index_dip.y
    )
    return pointing_up

def play_system_sound(sound_name):
    subprocess.Popen(["afplay", f"/System/Library/Sounds/{sound_name}.aiff"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Widget to display modulation wheel with improved design
class ModWheelWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.current_value = 0  # Modulation value (0-127)

    def set_value(self, value):
        self.current_value = value
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        # Draw dark grey background
        painter.setBrush(QColor(50, 50, 50))  # Dark grey
        painter.setPen(Qt.NoPen)
        painter.drawRect(0, 0, self.width(), self.height())

        # Draw border
        painter.setPen(QColor(100, 100, 100))  # Slightly lighter grey for border
        painter.drawRect(0, 0, self.width() - 1, self.height() - 1)

        # Draw thin blue indicator for the current modulation level
        mod_height = int((127 - self.current_value) / 127 * self.height())
        painter.setBrush(QColor(0, 180, 255))  # Bright blue for indicator
        indicator_height = 10  # Height of the blue rectangle
        painter.drawRect(
            10,  # Start 10px from the left for spacing
            mod_height - indicator_height // 2,  # Center the rectangle on the mod level
            self.width() - 20,  # Subtract 20px for left and right spacing
            indicator_height
        )

# Main application
class HandTrackingApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Hand Tracking MIDI Control")
        self.resize(1000, 800)

        # UI elements
        self.selected_hand = "Right"
        self.modulation_active = False
        self.gesture_start_time = None
        self.holding_pointing = False
        self.current_mod_value = 0
        self.enable_easing = True  # Option to toggle easing effect

        # Video feed label
        self.video_label = QLabel(self)
        self.video_label.setAlignment(Qt.AlignCenter)
        self.video_label.setStyleSheet("background-color: black;")

        # Dropdown to select hand
        self.hand_selection = QComboBox(self)
        self.hand_selection.addItems(["Right", "Left"])
        self.hand_selection.currentTextChanged.connect(self.update_selected_hand)

        # Mod Wheel
        self.mod_wheel = ModWheelWidget()
        self.mod_wheel.setFixedSize(60, 300)  # Adjust size to match the new style

        # Status and FPS
        self.status_label = QLabel("Modulation: OFF | FPS: 0.00", self)

        control_layout = QHBoxLayout()
        control_layout.addWidget(QLabel("Select Hand: "))
        control_layout.addWidget(self.hand_selection)

        layout = QVBoxLayout()
        layout.addWidget(self.status_label)
        layout.addWidget(self.video_label, stretch=3)
        layout.addLayout(control_layout)

        main_layout = QHBoxLayout()
        main_layout.addLayout(layout)
        main_layout.addWidget(self.mod_wheel, alignment=Qt.AlignCenter)

        container = QWidget()
        container.setLayout(main_layout)
        self.setCentralWidget(container)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update_frame)
        self.timer.start(10)

    def update_selected_hand(self, hand):
        self.selected_hand = hand

    def update_frame(self):
        ret, frame = cap.read()
        if not ret:
            return

        start_time = time.time()
        frame = cv2.flip(frame, 1)
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(frame_rgb)

        if results.multi_hand_landmarks:
            for hand_landmarks, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
                hand_label = handedness.classification[0].label
                color = (0, 255, 0) if hand_label == "Left" else (0, 0, 255)

                # Draw hand landmarks
                mp.solutions.drawing_utils.draw_landmarks(
                    frame, hand_landmarks, mp_hands.HAND_CONNECTIONS,
                    mp.solutions.drawing_utils.DrawingSpec(color=color, thickness=2, circle_radius=2),
                    mp.solutions.drawing_utils.DrawingSpec(color=(255, 255, 255), thickness=2)
                )

                if hand_label == self.selected_hand:
                    # Toggle modulation on/off with pointing up gesture
                    if is_strictly_pointing_up(hand_landmarks):
                        if not self.holding_pointing:
                            self.gesture_start_time = time.time()
                            self.holding_pointing = True
                        elif time.time() - self.gesture_start_time > 1.0:
                            self.modulation_active = not self.modulation_active
                            self.holding_pointing = False
                            sound_name = "Glass" if self.modulation_active else "Basso"
                            play_system_sound(sound_name)

                    else:
                        self.holding_pointing = False

                    # Modulation logic
                    if self.modulation_active and is_hand_strictly_open(hand_landmarks):
                        hand_size = calculate_hand_size(hand_landmarks)
                        target_mod_value = np.interp(hand_size, [0.10, 0.15], [0, 127])
                        target_mod_value = max(0, min(127, target_mod_value))

                        # Update modulation value with optional easing
                        if self.enable_easing:
                            self.current_mod_value += (target_mod_value - self.current_mod_value) * 0.1
                        else:
                            self.current_mod_value = target_mod_value

                        # Update mod wheel
                        self.mod_wheel.set_value(self.current_mod_value)

                        # Send MIDI message
                        if midi_out:
                            midi_out.send_message([0xB0, 1, int(self.current_mod_value)])

        # Update video feed
        height, width, _ = frame.shape
        qimg = QImage(frame.data, width, height, QImage.Format_BGR888)
        pixmap = QPixmap.fromImage(qimg).scaled(
            self.video_label.width(), self.video_label.height(), Qt.KeepAspectRatio
        )
        self.video_label.setPixmap(pixmap)

        # Update FPS and status
        fps = 1.0 / (time.time() - start_time)
        self.status_label.setText(f"Modulation: {'ON' if self.modulation_active else 'OFF'} | FPS: {fps:.2f}")

    def closeEvent(self, event):
        cap.release()
        if midi_out:
            midi_out.close()
        super().closeEvent(event)


if __name__ == "__main__":
    app = QApplication([])
    window = HandTrackingApp()
    window.show()
    app.exec()