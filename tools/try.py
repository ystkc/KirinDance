import cv2
import mediapipe as mp
import numpy as np
import math
import tkinter as tk
from PIL import Image, ImageTk

# Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=True, min_detection_confidence=0.5)
mp_drawing = mp.solutions.drawing_utils


# Function to calculate angle
def calculate_angle(fp, sp, tp):
    fp = np.array(fp)
    sp = np.array(sp)
    tp = np.array(tp)

    radians = np.arctan2(tp[1] - sp[1], tp[0] - sp[0]) - np.arctan2(fp[1] - sp[1], fp[0] - sp[0])
    angle = np.abs(radians * 180 / np.pi)

    if angle > 180:
        angle = 360 - angle

    return angle


# Function to get pose angles from an image
def get_pose_angles(img):
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    results = pose.process(img_rgb)

    if not results.pose_landmarks:
        print("NO LANDMARKS DETECTED")
        return None

    landmarks = results.pose_landmarks.landmark

    try:
        left_shoulder = [landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].x,
                         landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].y]
        left_elbow = [landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].x,
                      landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].y]
        left_wrist = [landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].x,
                      landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].y]

        right_shoulder = [landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].x,
                          landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].y]
        right_elbow = [landmarks[mp_pose.PoseLandmark.RIGHT_ELBOW.value].x,
                       landmarks[mp_pose.PoseLandmark.RIGHT_ELBOW.value].y]
        right_wrist = [landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].x,
                       landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].y]

        left_hip = [landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].x,
                    landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].y]
        left_knee = [landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].x,
                     landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].y]
        left_ankle = [landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].x,
                      landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].y]

        right_hip = [landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value].x,
                     landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value].y]
        right_knee = [landmarks[mp_pose.PoseLandmark.RIGHT_KNEE.value].x,
                      landmarks[mp_pose.PoseLandmark.RIGHT_KNEE.value].y]
        right_ankle = [landmarks[mp_pose.PoseLandmark.RIGHT_ANKLE.value].x,
                       landmarks[mp_pose.PoseLandmark.RIGHT_ANKLE.value].y]

        center_shoulder = [(left_shoulder[0] + right_shoulder[0]) / 2,
                           (left_shoulder[1] + right_shoulder[1]) / 2]
        center_hip = [(left_hip[0] + right_hip[0]) / 2,
                      (left_hip[1] + right_hip[1]) / 2]
        vertical_refp = [(left_hip[0] + right_hip[0]) / 2,
                         (left_hip[1] + right_hip[1]) / 2 + 10]

        left_arm_angle = calculate_angle(left_shoulder, left_elbow, left_wrist)
        left_leg_angle = calculate_angle(left_hip, left_knee, left_ankle)
        right_arm_angle = calculate_angle(right_shoulder, right_elbow, right_wrist)
        right_leg_angle = calculate_angle(right_hip, right_knee, right_ankle)
        body_angle = 180 - calculate_angle(center_shoulder, center_hip, vertical_refp)

        angles = [left_arm_angle, right_arm_angle, left_leg_angle, right_leg_angle, body_angle]

        return angles

    except Exception as e:
        print(f"Error in get_pose_angles: {e}")
        return None


# Initialize webcam
cap = cv2.VideoCapture(0)

# Load standard video
standard_video_path = "./standard_video.mp4"
standard_cap = cv2.VideoCapture(standard_video_path)

# Global variables
frame_score = 0
parts = ["left arm", "right arm", "left leg", "right leg", "body"]
motions0 = ["Stretch", "Stretch", "Stretch", "Stretch", "Tilt left"]
motions1 = ["Contract", "Contract", "Contract", "Contract", "Tilt right"]

# Create GUI window
root = tk.Tk()
root.title("迳口麒麟舞AI传承大师")
root.geometry("2560x1600")
background_path = "./background.jpg"
background = Image.open(background_path)
background = ImageTk.PhotoImage(background)


# Create labels for displaying images and scores
background_label = tk.Label(root, image=background, compound="center")
background_label.place(x=0, y=0, relwidth=1, relheight=1)

standard_label = tk.Label(root)
standard_label.pack(side="left", expand=True)

processed_label = tk.Label(root)
processed_label.pack(side="left", expand=True)

score_label = tk.Label(root, text="Score: 0", font=('Helvetica', 16))
score_label.pack(side="top")

background_label = tk.Label(root, image=background, compound="center")
background_label.place(x=0, y=0, relwidth=1, relheight=1)
background_label.lower()


# Function to resize image while maintaining aspect ratio
def resize_image(image, max_width, max_height):
    height, width = image.shape[:2]
    aspect_ratio = width / height

    if width > max_width:
        width = max_width
        height = int(width / aspect_ratio)

    if height > max_height:
        height = max_height
        width = int(height * aspect_ratio)

    return cv2.resize(image, (width, height))


def update_gui():
    global frame_score

    ret, frame = cap.read()
    if not ret:
        return

    image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image.flags.writeable = False

    results = pose.process(image)

    image.flags.writeable = True
    processed_image = image.copy()

    try:
        ret_standard, standard_frame = standard_cap.read()
        if not ret_standard:
            standard_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret_standard, standard_frame = standard_cap.read()

        standard_frame_rgb = cv2.cvtColor(standard_frame, cv2.COLOR_BGR2RGB)
        standard_angles = get_pose_angles(standard_frame_rgb)

        if not standard_angles:
            print("Skipping frame due to no landmarks detected in standard video.")
            root.after(10, update_gui)
            return

        landmarks = results.pose_landmarks.landmark

        left_shoulder = [landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].x,
                         landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].y]
        left_elbow = [landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].x,
                      landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].y]
        left_wrist = [landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].x,
                      landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].y]

        right_shoulder = [landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].x,
                          landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].y]
        right_elbow = [landmarks[mp_pose.PoseLandmark.RIGHT_ELBOW.value].x,
                       landmarks[mp_pose.PoseLandmark.RIGHT_ELBOW.value].y]
        right_wrist = [landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].x,
                       landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].y]

        left_hip = [landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].x,
                    landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].y]
        left_knee = [landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].x,
                     landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].y]
        left_ankle = [landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].x,
                      landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].y]

        right_hip = [landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value].x,
                     landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value].y]
        right_knee = [landmarks[mp_pose.PoseLandmark.RIGHT_KNEE.value].x,
                      landmarks[mp_pose.PoseLandmark.RIGHT_KNEE.value].y]
        right_ankle = [landmarks[mp_pose.PoseLandmark.RIGHT_ANKLE.value].x,
                       landmarks[mp_pose.PoseLandmark.RIGHT_ANKLE.value].y]

        center_shoulder = [(left_shoulder[0] + right_shoulder[0]) / 2,
                           (left_shoulder[1] + right_shoulder[1]) / 2]
        center_hip = [(left_hip[0] + right_hip[0]) / 2,
                      (left_hip[1] + right_hip[1]) / 2]
        vertical_refp = [(left_hip[0] + right_hip[0]) / 2,
                         (left_hip[1] + right_hip[1]) / 2 + 10]

        left_arm_angle = calculate_angle(left_shoulder, left_elbow, left_wrist)
        left_leg_angle = calculate_angle(left_hip, left_knee, left_ankle)
        right_arm_angle = calculate_angle(right_shoulder, right_elbow, right_wrist)
        right_leg_angle = calculate_angle(right_hip, right_knee, right_ankle)
        body_angle = 180 - calculate_angle(center_shoulder, center_hip, vertical_refp)

        angles = [left_arm_angle, right_arm_angle, left_leg_angle, right_leg_angle, body_angle]
        angles = np.round(angles, 2)

        diff_angle = angles - np.array(standard_angles)
        frame_scores = np.zeros(len(diff_angle))

        for part in range(len(diff_angle)):
            if abs(diff_angle[part]) <= 10:
                frame_scores[part] = 100 - 0.03 * diff_angle[part] * diff_angle[part]
            elif 10 < abs(diff_angle[part]) <= 70:
                frame_scores[part] = 94.23 - 0.02 * (abs(diff_angle[part]) - 8) * (abs(diff_angle[part]) - 8)
            else:
                frame_scores[part] = 17.35 * math.exp(-(abs(diff_angle[part]) - 70) / 20)

        frame_score = sum(frame_scores) / len(diff_angle)
        score_label.config(text=f"Score: {frame_score:.2f}")

    except Exception as e:
        print(f"Error in update_gui: {e}")

    mp_drawing.draw_landmarks(processed_image, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
    mp_drawing.draw_landmarks(standard_frame_rgb, pose.process(standard_frame_rgb).pose_landmarks,
                              mp_pose.POSE_CONNECTIONS)

    # Resize images to fit within the GUI window
    max_width, max_height = 600, 450  # Adjust as needed
    processed_image = resize_image(processed_image, max_width, max_height)
    standard_frame_rgb = resize_image(standard_frame_rgb, max_width, max_height)

    # Convert the images to PIL format for displaying in Tkinter
    processed_pil = Image.fromarray(processed_image)
    processed_tk = ImageTk.PhotoImage(image=processed_pil)
    processed_label.img_tk = processed_tk
    processed_label.config(image=processed_tk)

    standard_pil = Image.fromarray(standard_frame_rgb)
    standard_tk = ImageTk.PhotoImage(image=standard_pil)
    standard_label.img_tk = standard_tk
    standard_label.config(image=standard_tk)

    if frame_score >= 60:
        root.after(10, update_gui)
    else:
        root.after(10, update_gui)


root.after(10, update_gui)
root.mainloop()

cap.release()
standard_cap.release()
cv2.destroyAllWindows()