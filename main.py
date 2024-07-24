import cv2
import mediapipe as mp
import numpy as np
import math
import tkinter as tk
import time
import threading
from PIL import Image, ImageTk
from multiprocessing import Process, Queue

# Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=True, min_detection_confidence=0.5)
mp_drawing = mp.solutions.drawing_utils

# Function to calculate angle
def calculate_angle(fp, sp, tp):
    fp, sp, tp = np.array(fp), np.array(sp), np.array(tp)
    radians = np.arctan2(tp[1] - sp[1], tp[0] - sp[0]) - np.arctan2(fp[1] - sp[1], fp[0] - sp[0])
    angle = np.abs(radians * 180 / np.pi)
    return angle if angle <= 180 else 360 - angle

# Function to get pose angles from an image
def get_pose_angles(img):
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    results = pose.process(img_rgb)

    if not results.pose_landmarks:
        return None

    landmarks = results.pose_landmarks.landmark

    def get_coords(landmark):
        return [landmarks[landmark.value].x, landmarks[landmark.value].y]

    try:
        left_shoulder, left_elbow, left_wrist = map(get_coords, [mp_pose.PoseLandmark.LEFT_SHOULDER,
                                                                 mp_pose.PoseLandmark.LEFT_ELBOW,
                                                                 mp_pose.PoseLandmark.LEFT_WRIST])
        right_shoulder, right_elbow, right_wrist = map(get_coords, [mp_pose.PoseLandmark.RIGHT_SHOULDER,
                                                                    mp_pose.PoseLandmark.RIGHT_ELBOW,
                                                                    mp_pose.PoseLandmark.RIGHT_WRIST])
        left_hip, left_knee, left_ankle = map(get_coords, [mp_pose.PoseLandmark.LEFT_HIP,
                                                           mp_pose.PoseLandmark.LEFT_KNEE,
                                                           mp_pose.PoseLandmark.LEFT_ANKLE])
        right_hip, right_knee, right_ankle = map(get_coords, [mp_pose.PoseLandmark.RIGHT_HIP,
                                                              mp_pose.PoseLandmark.RIGHT_KNEE,
                                                              mp_pose.PoseLandmark.RIGHT_ANKLE])
        center_shoulder = [(left_shoulder[0] + right_shoulder[0]) / 2, (left_shoulder[1] + right_shoulder[1]) / 2]
        center_hip = [(left_hip[0] + right_hip[0]) / 2, (left_hip[1] + right_hip[1]) / 2]
        vertical_refp = [(left_hip[0] + right_hip[0]) / 2, (left_hip[1] + right_hip[1]) / 2 + 10]

        angles = [
            calculate_angle(left_shoulder, left_elbow, left_wrist),
            calculate_angle(right_shoulder, right_elbow, right_wrist),
            calculate_angle(left_hip, left_knee, left_ankle),
            calculate_angle(right_hip, right_knee, right_ankle),
            180 - calculate_angle(center_shoulder, center_hip, vertical_refp)
        ]
        return angles

    except Exception as e:
        print(f"Error in get_pose_angles: {e}")
        return None

def angle_calculation_process(queue, motions0, motions1, parts):
    cap = cv2.VideoCapture(0)
    standard_video_path = "standard_video_1600k_540.mp4"
    standard_cap = cv2.VideoCapture(standard_video_path)

    standard_frame_rate = 15
    frame_period = int(1000 / standard_frame_rate) # millisecond
    standard_cap.set(cv2.CAP_PROP_FPS, standard_frame_rate)
    cap.set(cv2.CAP_PROP_FPS, standard_frame_rate)
    # ret, frame = cap.read()
    # original_height = 0
    # original_width = 0
    # while not ret:
    #     ret, frame = cap.read()
    #     original_height, original_width = frame.shape[:2]
    # print(f"Original frame size: {original_width}x{original_height}")
    width = 540
    height = 405
    assess_width = 60
    assess_height = 45
    has = 0
    has_1 = 0
    standard_angles = None
    angles = None
    # 获取毫秒级时间戳
    time_start = time.time()
    frame_count = 0
    frame_rate = 0
    # print(f"Resized frame size: {width}x{height}")

    while True:
        frame_count += 1
        time_now = time.time()
        if (time_now - time_start) * 1000 < frame_period * frame_count:
            time.sleep((frame_period * frame_count - (time_now - time_start) * 1000) * 0.001)
            
            
            
        if frame_count > 30:
            frame_rate = frame_count / (time_now - time_start)
        
        ret, frame = cap.read()
        # 将画面水平翻转
        if not ret:
            continue
        
        frame_original = frame.copy()
        frame_original = cv2.flip(frame_original, 1)
        frame_original = cv2.resize(frame_original, (width, height))
        
        frame = cv2.resize(frame, (assess_width, assess_height))

        ret_standard, standard_frame = standard_cap.read()
        if not ret_standard:
            queue.put("END")
            break
        original_standard_frame = standard_frame.copy()
        original_standard_frame = cv2.resize(original_standard_frame, (width, height))
        
        standard_frame = cv2.resize(standard_frame, (assess_width, assess_height))
        standard_frame_rgb = cv2.cvtColor(standard_frame, cv2.COLOR_BGR2RGB)
        if has == 0:
            standard_angles = get_pose_angles(standard_frame_rgb)
            # has = 1
        if standard_angles is None:
            queue.put(None)
            continue
        if has_1 == 0:
            angles = get_pose_angles(frame)
            # has_1 = 1
        if angles is None:
            queue.put(None)
            continue

        angles = np.round(angles, 2)
        diff_angle = angles - np.array(standard_angles)
        frame_scores = np.zeros(len(diff_angle))

        for part in range(len(diff_angle)):
            abs_diff = abs(diff_angle[part])
            if abs_diff <= 10:
                frame_scores[part] = 100 - 0.03 * abs_diff * abs_diff
            elif 10 < abs_diff <= 70:
                frame_scores[part] = 94.23 - 0.02 * (abs_diff - 8) * (abs_diff - 8)
            else:
                frame_scores[part] = 17.35 * math.exp(-(abs_diff - 70) / 20)

        frame_score = sum(frame_scores) / len(diff_angle)
        queue.put((frame_original, original_standard_frame, frame_score, diff_angle, frame_rate))

# Global variables
parts = ["左手", "右手", "左腿", "右腿", "身体"]
motions0 = ["展开", "展开", "展开", "展开", "向左倾斜"]
motions1 = ["收缩", "收缩", "收缩", "收缩", "向右倾斜"]

# Create main window
root = tk.Tk()
root.title("迳口麒麟舞AI传承大师")
root.geometry("2560x1600")
background_path = "./background.png"
background = Image.open(background_path)
background = ImageTk.PhotoImage(background)

# Create labels for displaying images and scores
background_label = tk.Label(root, image=background, compound="center")
background_label.place(x=0, y=0, relwidth=1, relheight=1)
standard_label = tk.Label(root, bd=0)
standard_label.place(x=140, y=300)
processed_label = tk.Label(root, bd=0)
processed_label.place(x=960, y=300)
score_label = tk.Label(root, text="得分: 0", font=('楷体', 50), bg="#ce4c4a", fg="white", anchor="center", height=1, width=15)
score_label.place(x=600, y=810)
background_label.lower()

# Create tips window
tips = tk.Tk()
tips.title("动作提示")
tips.geometry("250x180")
tips_label = tk.Label(tips, text="动作提示:", font=("楷体", 20))
tips_label.place(x=0, y=0)

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
    if not queue.empty():
        result = queue.get()
        if result is None:
            root.after(10, update_gui)
            return

        if result == "END":
            final_scores = [score for score in scores if score >= 30]
            final_score = sum(final_scores) / len(final_scores) if final_scores else 0
            score_label.config(text=f"最终得分: {final_score:.2f}", background="#ce4c4a")
            root.destroy()
            tips.destroy()
            process.terminate()
            cv2.destroyAllWindows()
            return

        frame, standard_frame, frame_score, diff_angle, frame_rate = result
        root.title(f'{frame_rate:.2f}')
        scores.append(frame_score)

        tips_text = "动作提示:\n"
        for part in range(len(diff_angle)):
            abs_diff = abs(diff_angle[part])
            if abs_diff <= 10:
                tips_text += f"{parts[part]}:正确动作\n"
            elif 10 < abs_diff <= 70:
                motion = motions0[part] if diff_angle[part] < 0 else motions1[part]
                tips_text += f"{motion}你的{parts[part]}\n"
            else:
                motion = motions0[part] if diff_angle[part] < 0 else motions1[part]
                tips_text += f"{motion}你的{parts[part]}\n"

        tips_label.config(text=tips_text)
        score_label.config(text=f"得分: {frame_score:.2f}", background="#ce4c4a")

        processed_image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        standard_frame_rgb = cv2.cvtColor(standard_frame, cv2.COLOR_BGR2RGB)

        max_width, max_height = 600, 450
        processed_image = resize_image(processed_image, max_width, max_height)
        standard_frame_rgb = resize_image(standard_frame_rgb, max_width, max_height)

        processed_pil = Image.fromarray(processed_image)
        processed_tk = ImageTk.PhotoImage(image=processed_pil)
        processed_label.img_tk = processed_tk
        processed_label.config(image=processed_tk)

        standard_pil = Image.fromarray(standard_frame_rgb)
        standard_tk = ImageTk.PhotoImage(image=standard_pil)
        standard_label.img_tk = standard_tk
        standard_label.config(image=standard_tk)

    root.after(1, update_gui)

def reset_program():
    global scores, process, queue
    scores = []
    queue = Queue()
    process = Process(target=angle_calculation_process, args=(queue, motions0, motions1, parts))
    process.start()
    score_label.config(text="得分: 0", background="#ce4c4a")
    tips_label.config(text="动作提示:")

def on_key_press(event):
    if event.keysym == 'Return':
        final_scores = [score for score in scores if score >= 30]
        final_score = sum(final_scores) / len(final_scores) if final_scores else 0
        score_label.config(text=f"最终得分: {final_score:.2f}", background="#ce4c4a")
        process.terminate()
        cv2.destroyAllWindows()
    elif event.keysym == 'Escape':
        root.destroy()
        tips.destroy()
        process.terminate()
        cv2.destroyAllWindows()
    elif event.keysym == 'space':
        process.terminate()
        reset_program()

def debug():
    while True:
        print(queue.qsize())
        time.sleep(1)

if __name__ == "__main__":
    
    scores = []
    queue = Queue()
    process = Process(target=angle_calculation_process, args=(queue, motions0, motions1, parts))
    process.start()

    root.bind('<KeyPress>', on_key_press)
    root.after(1, update_gui)
    # 启动debug线程
    # debug_thread = threading.Thread(target=debug)
    time_start = time.time()    
    root.mainloop()
    time_end = time.time()
    print(f"程序运行时间: {time_end - time_start:.2f}秒")

    process.terminate()
    cv2.destroyAllWindows()