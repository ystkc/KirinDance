import cv2
import mediapipe as mp
import numpy as np
import math
import pickle
import os
import flask
import time
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk
import hashlib
from multiprocessing import Process, Queue

# Configuration
standard_video_path = "standard_video_1600k_540_15fps_6s.mp4"
standard_frame_rate = 15 # 帧率
frame_period = 1000 / standard_frame_rate # 毫秒
width = 540 # 观察画面尺寸（显卡性能限制，不掉帧即可）
height = 405
assess_width = 60 # 姿态计算画面尺寸（过高浪费性能，过低丢失精度）
assess_height = 45
total_frames = 0
total_time = 0
video_bits_per_second = 800000


# Global variables
parts = ["左手", "右手", "左腿", "右腿", "身体"]
motions0 = ["展开", "展开", "展开", "展开", "向左倾斜"]
motions1 = ["收缩", "收缩", "收缩", "收缩", "向右倾斜"]

# Create main window
root = tk.Tk()
root.title("迳口麒麟舞AI传承大师")
root.geometry("2560x1080")
# root.attributes('-fullscreen', True)
background_path = "./background.png"
background = Image.open(background_path)
background = ImageTk.PhotoImage(background)

# Create labels for displaying images and scores
background_label = tk.Label(root, image=background, compound="center")
background_label.place(x=0, y=0, relwidth=1, relheight=1)
standard_label = tk.Label(root, bd=0)
standard_label.place(x=200, y=300)
processed_label = tk.Label(root, bd=0)
processed_label.place(x=920, y=300)
score_label = tk.Label(root, text="得分: 0", font=('楷体', 50), bg="#ce4c4a", fg="white", anchor="center", height=1, width=15)
score_label.place(x=700, y=825)
background_label.lower()

# 播放进度条
play_progress_var = tk.DoubleVar()
play_progress_label = tk.Label(root, text="00:00/00:00", font=('楷体', 15), bg="#ce4c4a")
play_progress_bar = ttk.Progressbar(root, variable=play_progress_var, maximum=100)

play_progress_bar.place(relx=0.5, rely=0.75, anchor=tk.CENTER, width=1280, height=10)
play_progress_label.place(relx=0.5, rely=0.75, anchor=tk.CENTER, y=40)

# 由于同一个视频只能创建一个
standard_cap = cv2.VideoCapture(standard_video_path)
standard_cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
standard_cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
standard_cap.set(cv2.CAP_PROP_FPS, standard_frame_rate)

# Create tips window
tips = tk.Tk()
tips.title("动作提示")
tips.geometry("300x250")
tips_label = tk.Label(tips, text="动作提示:", font=("楷体", 30))
tips_label.place(x=0, y=0)

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

def preprocess_standard_video(standard_video_path, progress_var, progress_label, total_frames, cache_path):
    cap = cv2.VideoCapture(standard_video_path)
    standard_data = []

    current_frame = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        angles = get_pose_angles(frame_rgb)
        standard_data.append(angles)

        current_frame += 1
        progress = (current_frame / total_frames) * 100
        progress_var.set(progress)
        progress_label.config(text=f"缓存进度: {progress:.2f}%")
        processed_label.update()

    cap.release()
    with open(cache_path, "wb") as f:
        pickle.dump(standard_data, f)
 

def angle_calculation_process(queue, motions0, motions1, parts, cache_path):
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FPS, standard_frame_rate)

    with open(cache_path, "rb") as f:
        standard_data = pickle.load(f)

    

    time_start = time.time()
    frame_count = 0
    frame_rate = 0

    while True:
        frame_count += 1
        if frame_count >= len(standard_data):
            queue.put("END")
            break

        time_now = time.time()
        if (time_now - time_start) * 1000 < frame_period * frame_count: # 帧率限制，因为frame是没有缓存的
            time.sleep((frame_period * frame_count - (time_now - time_start) * 1000) * 0.001)
            
        # if frame_count > 30:
        #     frame_rate = frame_count / (time_now - time_start)


        # 读取画面
        ret, frame = cap.read()
        if not ret:
            continue
        original_frame = frame.copy()
        original_frame = cv2.resize(original_frame, (width, height)) # 观看画面尺寸
        original_frame = cv2.flip(original_frame, 1) # 因为是摄像头录制的，所以需要翻转一下
        frame = resize_image(frame, assess_width, assess_height) # assess所需尺寸更小，节省计算资源

        ret, standard_frame = standard_cap.read()
        if not ret:
            queue.put(None) # 视频结束
            continue
        original_standard_frame = standard_frame.copy()
        original_standard_frame = cv2.resize(original_standard_frame, (width, height))
        standard_frame = resize_image(standard_frame, assess_width, assess_height)

        # 读取动作姿态
        standard_angles = standard_data[frame_count]
        if not standard_angles: # 初步判断是由于get_pose_angles可能存在记忆属性，不断切换判断可能导致卡慢
            queue.put(None)
            continue
        angles = get_pose_angles(frame)
        if not angles:
            queue.put(None)
            continue

        angles = np.round(angles, 2)
        diff_angles = angles - np.array(standard_angles)
        frame_scores = np.zeros(len(diff_angles))

        for part in range(len(diff_angles)):
            abs_diff = abs(diff_angles[part])
            if abs_diff <= 10:
                frame_scores[part] = 100 - 0.03 * abs_diff * abs_diff
            elif 10 < abs_diff <= 70:
                frame_scores[part] = 94.23 - 0.02 * (abs_diff - 8) * (abs_diff - 8)
            else:
                frame_scores[part] = 17.35 * math.exp(-(abs_diff - 70) / 20)

        frame_score = sum(frame_scores) / len(diff_angles)
        queue.put((original_frame, original_standard_frame, frame_score, diff_angles, frame_count))


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
            time.sleep(2)
            root.destroy()
            tips.destroy()
            process.terminate()
            cv2.destroyAllWindows()
            return
        # 读取总帧数
        total_frames = int(standard_cap.get(cv2.CAP_PROP_FRAME_COUNT))
        total_time = total_frames / standard_frame_rate

        frame, standard_frame, frame_score, diff_angle, frame_count = result
        if total_frames > 0:# 0就是还没初始化好
            
            play_progress_var.set(frame_count / total_frames * 100)
            play_progress_label.config(text=f"{time.strftime('%M:%S', time.gmtime(frame_count / standard_frame_rate))} / {time.strftime('%M:%S', time.gmtime(total_time))}")
            play_progress_label.update()

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
def start_preprocessing(cache_path):
    cap = cv2.VideoCapture(standard_video_path)
    cap.set(cv2.CAP_PROP_FPS, standard_frame_rate)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_time = total_frames / standard_frame_rate
    cap.release()

    progress_var = tk.DoubleVar()
    progress_label = tk.Label(root, text="缓存进度: 0.00%", font=('楷体', 20), bg="#ce4c4a")
    progress_bar = ttk.Progressbar(root, variable=progress_var, maximum=100)

    progress_bar.place(relx=0.5, rely=0.5, anchor=tk.CENTER, width=1280, height=30)
    progress_label.place(relx=0.5, rely=0.5, anchor=tk.CENTER, y=40)

    preprocess_standard_video(standard_video_path, progress_var, progress_label, total_frames, cache_path)

    progress_bar.destroy()
    progress_label.destroy()
    root.after(1, update_gui)


if __name__ == "__main__":

    hash_obj = hashlib.sha256()
    with open(standard_video_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_obj.update(chunk)
    resource_id = hash_obj.hexdigest()
    if not os.path.exists("./cache"):
        os.mkdir("./cache")
    cache_path = f"./cache/{resource_id}.pkl"

    if not os.path.exists(cache_path):
        start_preprocessing(cache_path)
    scores = []
    queue = Queue()

    process = Process(target=angle_calculation_process, args=(queue, motions0, motions1, parts, cache_path))
    
    process.start()

    root.bind('<KeyPress>', on_key_press)
    root.after(1, update_gui)
    time_start = time.time()
    root.mainloop()
    time_end = time.time()
    print(f"程序运行时间: {time_end - time_start:.2f}秒")

    process.terminate()
    cv2.destroyAllWindows()