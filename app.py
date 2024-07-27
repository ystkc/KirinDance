from werkzeug.serving import WSGIRequestHandler, _log
from flask import Flask, render_template, Response
from flask_socketio import SocketIO, emit
import mediapipe as mp
from PIL import Image
import av
import pickle
import io
import cv2
import logging
import hashlib
import os
import time
import numpy as np


app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)

logging.basicConfig(level=logging.DEBUG)
logger_flask_socketio = logging.getLogger('flask_socketio')
logger = logging.getLogger(__name__)


mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=True, min_detection_confidence=0.5)

# Configuration
standard_video_path = "standard_video_1600k_540_15fps_6s.mp4"
standard_frame_rate = 15 # 帧率
frame_period = 1000 / standard_frame_rate # 毫秒
width = 540 # 观察画面尺寸（显卡性能限制，不掉帧即可）
height = 405
assess_width = 60 # 姿态计算画面尺寸（过高浪费性能，过低丢失精度）
assess_height = 45
video_bits_per_second = 800000


standard_cap = None


total_frames = 0
total_time = 0
standard_total_frames = 0
frame_count = 0



paused = False
stopped = False





def video_generator():
    global standard_cap, total_frames, total_time, standard_total_frames, frame_count
    time_start = time.time()
    frame_count = 0
    frame_rate = 0
    standard_data = None
    # 加载缓存数据
    
    with open(cache_path, "rb") as f:
        standard_data = pickle.load(f)
    
    global stopped, paused
    
    paused = False
    stopped = False

    standard_cap = cv2.VideoCapture(standard_video_path)
    standard_total_frames = int(standard_cap.get(cv2.CAP_PROP_FRAME_COUNT))
    logger.info(f'standard_total_frames:{standard_total_frames}')
    
    while True:
        # 处理暂停和停止
        if paused:
            while paused:
                time.sleep(1)
            time_start = time.time()
            frame_count = 0

        if stopped:
            standard_cap.release()
            socketio.emit('stop')
            break

        # 计算帧率
        frame_count += 1
        if frame_count >= standard_total_frames:
            # 通过socket通知客户端停止
            socketio.emit('stop')
            break
        time_now = time.time()
        if (time_now - time_start) * 1000 < frame_period * frame_count: # 帧率限制，因为frame是没有缓存的
            time.sleep((frame_period * frame_count - (time_now - time_start) * 1000) * 0.001)
        ret, frame = standard_cap.read()

        if not ret:
            time.sleep(1)
            continue
        
        frame = cv2.resize(frame, (width, height))
        ret, jpeg = cv2.imencode('.jpg', frame)
        frame_data = jpeg.tobytes()
        # socketio.emit('angles', {'data': standard_data[frame_count-1]})
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_data + b'\r\n')
        


WSGIRequestHandler.address_string = lambda self: self.headers.get('x-real-ip', self.client_address[0])
class MyRequestHandler(WSGIRequestHandler):
    def log(self, type, message, *args):
        _log(type, f'{self.address_string()} {message % args}\n')

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


@app.route('/video_feed')
def video_feed():
    return Response(video_generator(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('start')
def init():
    global stopped
    stopped = False


@socketio.on('stop')
def release():
    global stopped
    stopped = True

@socketio.on('pause')
def pause():
    global paused
    paused = not paused

# 旧版：使用webm格式编码视频帧，前端连续分片，需要解码和编码，暂时弃用

# def decode(video_blob) -> list:
#     '''将webm格式的视频帧数据解码为帧数据，由于前端连续分片，因此需要保留文件头向bio追加'''
#     # 向bio中追加video_blob
#     logger.info(f'length of bio:{len(bio.getvalue())}')
#     logger.info(f'first 10 bytes of bio:{bio.getvalue()[:10]}')
#     try:
#         container = av.open(bio, 'r', format="webm")  # 注意：format参数可以留空，PyAV会尝试自动检测  
#     except Exception as e:
#         logger.error(f'{e}')
#         # 打印附近的字节
#         logger.info(bio.getvalue()[max(0, len(bio.getvalue()) - 100):len(bio.getvalue())])
#         raise e
    
#     # 找到视频流  
#     video_stream = next((stream for stream in container.streams if stream.type == 'video'), None)  
#     if video_stream is None:  
#         raise ValueError("No video stream found in the file.")  
#     frame_data = []
#     for packet in container.demux(video_stream):  
#         for frame in packet.decode():  
#             # 转换为numpy数组
            
#             image = np.array(frame.to_image().convert('RGB'))
#             image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
#             frame_data.append(image)
#     return frame_data


# def encode(frame_data):
#     '''将帧数据编码为webm格式'''
#     bio = io.BytesIO()
#     container = av.open(bio, 'w', format='webm')  # 容器格式应为 'webm'
#     stream = container.add_stream('libvpx-vp9', rate=standard_frame_rate) # 视频流格式应为 'libvpx-vp9'（VP9编码）
#     stream.width = width
#     stream.height = height
#     stream.pix_fmt = 'yuv420p'
#     stream.bit_rate = video_bits_per_second
#     try:
#         for frame in frame_data:
#             img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
#             img = cv2.resize(img, (width, height))
#             img_pil = Image.fromarray(img)
#             img_av = av.VideoFrame.from_image(img_pil)
#             for packet in stream.encode(img_av):
#                 container.mux(packet)
#         for packet in stream.encode():
#             container.mux(packet)
#     except Exception as e:
#         print(f"编码过程中发生错误: {e}")
#         container.close()
#         return None
#     container.close()
#     return bio.getvalue()


# ret_cnt = 0
# @socketio.on('record')
# def handle_recorder(blob):
#     global ret_cnt
#     with open(f'output{ret_cnt}.webm','wb') as f:
#         f.write(blob)

#         ret_cnt += 1
#     try:
#         frame_data = decode(blob)

#         # cv2.imshow('frame0', frame_data[0])
#         # cv2.waitKey(500)
#         # cv2.destroyAllWindows()
        
        
#         logger.info(f'Frame count: {len(frame_data)}')
#         # 水平翻转
#         video = []
#         for frame in frame_data:
#             video.append(cv2.flip(frame, 1))

#         # 发送视频回前端
#         emit('video', encode(video))  
  
#         # emit('video', frame_data, binary = True)
#     except Exception as e:
#         logger.error(f'Error in handle_recorder: {e}')  
#         raise e



@app.route('/config', methods=['GET'])   
def config():
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

def calculate_angle(fp, sp, tp):
    fp, sp, tp = np.array(fp), np.array(sp), np.array(tp)
    radians = np.arctan2(tp[1] - sp[1], tp[0] - sp[0]) - np.arctan2(fp[1] - sp[1], fp[0] - sp[0])
    angle = np.abs(radians * 180 / np.pi)
    return angle if angle <= 180 else 360 - angle

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

        # angles = [
        #     calculate_angle(left_shoulder, left_elbow, left_wrist),
        #     calculate_angle(right_shoulder, right_elbow, right_wrist),
        #     calculate_angle(left_hip, left_knee, left_ankle),
        #     calculate_angle(right_hip, right_knee, right_ankle),
        #     180 - calculate_angle(center_shoulder, center_hip, vertical_refp)
        # ] # 旧版：计算肢体之间的角度
        # 新版：直接返回各个肢体的位置
        # 0	nose
        # 1	leftEye
        # 2	rightEye
        # 3	leftEar
        # 4	rightEar
        # 5	leftShoulder
        # 6	rightShoulder
        # 7	leftElbow
        # 8	rightElbow
        # 9	leftWrist
        # 10	rightWrist
        # 11	leftHip
        # 12	rightHip
        # 13	leftKnee
        # 14	rightKnee
        # 15	leftAnkle
        # 16	rightAnkle
        angles = [
            0,
            0,
            0,
            0,  
            0,
            left_shoulder,
            right_shoulder,
            left_elbow,
            right_elbow,
            left_wrist,
            right_wrist,
            left_hip,
            right_hip,  
            left_knee,
            right_knee,
            left_ankle,
            right_ankle,
            vertical_refp
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
        print(f"缓存进度: {current_frame}/{total_frames} ({current_frame/total_frames*100:.2f}%)")

    cap.release()
    with open(cache_path, "wb") as f:
        pickle.dump(standard_data, f)


def start_preprocessing(cache_path):
    global total_frames, total_time

    cap = cv2.VideoCapture(standard_video_path)
    cap.set(cv2.CAP_PROP_FPS, standard_frame_rate)

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_time = total_frames / standard_frame_rate
    cap.release()


    preprocess_standard_video(standard_video_path, total_frames, cache_path)

if __name__ == '__main__':
    

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
    # 每次启动执行cls
    os.system('cls')

    socketio.run(app, debug=True)
