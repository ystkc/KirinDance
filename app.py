from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi import WebSocket, WebSocketDisconnect
# import mediapipe as mp
# from PIL import Image
# import pickle
# import cv2
import logging
import hashlib
import os
# import time
# import numpy as np
# import asyncio
# import json

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

# 配置日志
logging.basicConfig(level=logging.DEBUG)
logger_flask_socketio = logging.getLogger('fastapi_socketio')
logger = logging.getLogger(__name__)

# MediaPipe姿势检测
# mp_pose = mp.solutions.pose
# pose = mp_pose.Pose(static_image_mode=True, min_detection_confidence=0.5)

standard_video_path = "./static/std64.mp4"
standard_frame_rate = 15  # 帧率
frame_period = 1000 / standard_frame_rate  # 毫秒
width = 540  # 观察画面尺寸（显卡性能限制，不掉帧即可）
height = 405
assess_width = 60  # 姿态计算画面尺寸（过高浪费性能，过低丢失精度）
assess_height = 45
video_bits_per_second = 800000

standard_cap = None
total_frames = 0
total_time = 0
standard_total_frames = 0
current_frame_count = 0

paused = False
stopped = False

# def video_generator():
#     global standard_cap, total_frames, total_time, standard_total_frames, current_frame_count
#     frame_count = 0 # 本次暂停后播放的帧数
#     current_frame_count = 0 # 当前文件播放的帧数
#     standard_data = None
#     with open(cache_path, "rb") as f:
#         standard_data = pickle.load(f)

#     standard_cap = cv2.VideoCapture(standard_video_path)
#     standard_total_frames = int(standard_cap.get(cv2.CAP_PROP_FRAME_COUNT))

#     global stopped, paused
    
#     paused = False
#     stopped = False

#     frame_rate = standard_cap.get(cv2.CAP_PROP_FPS)
#     print("frame_rate: ", frame_rate)
#     frame_interval = 1.0 / frame_rate

#     while True:
#         start_time = time.time()
#         print(f"frames: {current_frame_count} / {standard_total_frames} ({frame_count})")
#         ret, frame = standard_cap.read()
#         if paused:
#             while paused:
#                 time.sleep(1)
#             start_time = time.time()
#             frame_count = 0
#         if not ret:
#             # 重置视频
#             standard_cap.release()
#             break
        
#         frame_count += 1
#         current_frame_count += 1
#         frame = cv2.resize(frame, (width, height))
#         _, jpeg = cv2.imencode('.jpg', frame)
#         frame_data = jpeg.tobytes()
        
#         # 添加HTTP多部分边界
#         yield (b"--frame\r\n"
#                b"Content-Type: image/jpeg\r\n\r\n" + frame_data + b"\r\n")
        
#         # 控制帧率
#         elapsed = time.time() - start_time
#         time.sleep(max(0, frame_interval - elapsed))

# @app.get('/video_feed')
# async def video_feed():
#     return StreamingResponse(
#         video_generator(),
#         media_type="multipart/x-mixed-replace; boundary=frame"
#     )


@app.get('/')
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# async def message_generator():
#     while True:
#         await asyncio.sleep(0.2)
#         if standard_total_frames == 0:
#             continue
#         progress_percentage = ((current_frame_count) / standard_total_frames) * 100
#         yield f"data: progress${progress_percentage}#name$progress\n\n"

# @app.get('/message')
# async def message():
#     return StreamingResponse(message_generator(), media_type='text/event-stream')

# WebSocket部分
connected_websockets = set()

# @app.websocket("/ws")
# async def websocket_endpoint(websocket: WebSocket):
#     await websocket.accept()
#     connected_websockets.add(websocket)
#     global stopped
#     global paused
#     try:
#         while True:
#             data = await websocket.receive_text()
#             print(f"websocket receive: {data}")
#             if data == 'start':
#                 stopped = False
#             elif data == 'stop':
#                 stopped = True
#             elif data == 'pause':
#                 paused = not paused
#             elif data[:10] == "video_info":
#                 video_info = json.loads(data[10:])
#                 print(f"video_info: {video_info}")
#             elif data[:4] == "pose":
#                 pose_dict = json.loads(data[4:])
#                 print(f"pose_dict: {pose_dict}")
            
#             await asyncio.sleep(0.1)
#     except WebSocketDisconnect:
#         connected_websockets.remove(websocket)

def convert_canvas_to_cap(canvas_struct):
    """
    将canvas结构图片转换为cap结构图片。

    :param canvas_struct: canvas结构的二维数组，其中每个元素是长度为3*width的列表，包含每行像素的RGB值。
    :return: B结构的三维数组，维度为列、行、RGB。
    """
    if not canvas_struct or not canvas_struct[0]:
        return []
    width = len(canvas_struct[0]) // 3
    height = len(canvas_struct)
    cap_struct = [[[0, 0, 0] for _ in range(height)] for _ in range(width)]
    for row in range(height):
        for col in range(width):
            index = col * 3
            r, g, b = canvas_struct[row][index], canvas_struct[row][index + 1], canvas_struct[row][index + 2]
            cap_struct[col][row] = [r, g, b]
    return cap_struct

@app.get('/config')
async def config():
    logger.info('config request')
    return {
        "standard_video_path": standard_video_path,
        "standard_frame_rate": standard_frame_rate,
        "frame_period": frame_period,
        "width": width,
        "height": height,
        "assess_width": assess_width,
        "assess_height": assess_height,
        "total_frames": total_frames,
        "total_time": total_time
    }

# def calculate_angle(fp, sp, tp):
#     fp, sp, tp = np.array(fp), np.array(sp), np.array(tp)
#     radians = np.arctan2(tp[1] - sp[1], tp[0] - sp[0]) - np.arctan2(fp[1] - sp[1], fp[0] - sp[0])
#     angle = np.abs(radians * 180 / np.pi)
#     return angle if angle <= 180 else 360 - angle

# def get_pose_angles(img):
#     img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
#     results = pose.process(img_rgb)

#     if not results.pose_landmarks:
#         return None

#     landmarks = results.pose_landmarks.landmark

#     def get_coords(landmark):
#         return [landmarks[landmark.value].x, landmarks[landmark.value].y]

#     try:
#         left_shoulder, left_elbow, left_wrist = map(get_coords, [mp_pose.PoseLandmark.LEFT_SHOULDER,
#                                                                  mp_pose.PoseLandmark.LEFT_ELBOW,
#                                                                  mp_pose.PoseLandmark.LEFT_WRIST])
#         right_shoulder, right_elbow, right_wrist = map(get_coords, [mp_pose.PoseLandmark.RIGHT_SHOULDER,
#                                                                     mp_pose.PoseLandmark.RIGHT_ELBOW,
#                                                                     mp_pose.PoseLandmark.RIGHT_WRIST])
#         left_hip, left_knee, left_ankle = map(get_coords, [mp_pose.PoseLandmark.LEFT_HIP,
#                                                            mp_pose.PoseLandmark.LEFT_KNEE,
#                                                            mp_pose.PoseLandmark.LEFT_ANKLE])
#         right_hip, right_knee, right_ankle = map(get_coords, [mp_pose.PoseLandmark.RIGHT_HIP,
#                                                               mp_pose.PoseLandmark.RIGHT_KNEE,
#                                                               mp_pose.PoseLandmark.RIGHT_ANKLE])
#         center_shoulder = [(left_shoulder[0] + right_shoulder[0]) / 2, (left_shoulder[1] + right_shoulder[1]) / 2]
#         center_hip = [(left_hip[0] + right_hip[0]) / 2, (left_hip[1] + right_hip[1]) / 2]
#         vertical_refp = [(left_hip[0] + right_hip[0]) / 2, (left_hip[1] + right_hip[1]) / 2 + 10]

#         angles = [
#             0,
#             0,
#             0,
#             0,
#             0,
#             left_shoulder,
#             right_shoulder,
#             left_elbow,
#             right_elbow,
#             left_wrist,
#             right_wrist,
#             left_hip,
#             right_hip,
#             left_knee,
#             right_knee,
#             left_ankle,
#             right_ankle,
#             vertical_refp
#         ]
#         return angles
    
#     except Exception as e:
#         print(f"Error in get_pose_angles: {e}")
#         return None
    
# def preprocess_standard_video(standard_video_path, total_frames, cache_path):
#     cap = cv2.VideoCapture(standard_video_path)
#     standard_data = []

#     current_frame = 0
#     while cap.isOpened():
#         ret, frame = cap.read()
#         if not ret:
#             break
        
#         frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
#         angles = get_pose_angles(frame_rgb)
#         standard_data.append(angles)

#         current_frame += 1
#         print(f"缓存进度: {current_frame}/{total_frames} ({current_frame/total_frames*100:.2f}%)")

#     cap.release()
#     with open(cache_path, "wb") as f:
#         pickle.dump(standard_data, f)


# def start_preprocessing(cache_path):
#     global total_frames, total_time

#     cap = cv2.VideoCapture(standard_video_path)
#     cap.set(cv2.CAP_PROP_FPS, standard_frame_rate)

#     total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
#     total_time = total_frames / standard_frame_rate
#     cap.release()

#     preprocess_standard_video(standard_video_path, total_frames, cache_path)


if __name__ == '__main__':
    import uvicorn
    hash_obj = hashlib.sha256()
    with open(standard_video_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_obj.update(chunk)
    resource_id = hash_obj.hexdigest()
    if not os.path.exists("./cache"):
        os.mkdir("./cache")
    cache_path = f"./cache/{resource_id}.pkl"

    # if not os.path.exists(cache_path):
    #     start_preprocessing(cache_path)

    uvicorn.run(app, host='127.0.0.1', port=8860)
