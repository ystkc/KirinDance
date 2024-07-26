from werkzeug.serving import WSGIRequestHandler, _log
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
from PIL import Image
import av
import io
import cv2
import logging
import os
import time
import numpy as np


app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)

logging.basicConfig(level=logging.DEBUG)
logger_flask_socketio = logging.getLogger('flask_socketio')
logger = logging.getLogger(__name__)

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


standard_cap = cv2.VideoCapture(standard_video_path)


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

  

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/camera')
def camera_test():
    return render_template('camera.html')

bio = None
@socketio.on('start')
def init_decoder():
    global bio
    bio = io.BytesIO()

@socketio.on('stop')
def release_decoder():
    global bio
    bio.close()
    bio = None

def decode(video_blob) -> list:
    '''将webm格式的视频帧数据解码为帧数据，由于前端连续分片，因此需要保留文件头向bio追加'''
    # 向bio中追加video_blob
    logger.info(f'length of bio:{len(bio.getvalue())}')
    logger.info(f'first 10 bytes of bio:{bio.getvalue()[:10]}')
    try:
        container = av.open(bio, 'r', format="webm")  # 注意：format参数可以留空，PyAV会尝试自动检测  
    except Exception as e:
        logger.error(f'{e}')
        # 打印附近的字节
        logger.info(bio.getvalue()[max(0, len(bio.getvalue()) - 100):len(bio.getvalue())])
        raise e
    
    # 找到视频流  
    video_stream = next((stream for stream in container.streams if stream.type == 'video'), None)  
    if video_stream is None:  
        raise ValueError("No video stream found in the file.")  
    frame_data = []
    for packet in container.demux(video_stream):  
        for frame in packet.decode():  
            # 转换为numpy数组
            
            image = np.array(frame.to_image().convert('RGB'))
            image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
            frame_data.append(image)
    return frame_data


def encode(frame_data):
    '''将帧数据编码为webm格式'''
    bio = io.BytesIO()
    container = av.open(bio, 'w', format='webm')  # 容器格式应为 'webm'
    stream = container.add_stream('libvpx-vp9', rate=standard_frame_rate) # 视频流格式应为 'libvpx-vp9'（VP9编码）
    stream.width = width
    stream.height = height
    stream.pix_fmt = 'yuv420p'
    stream.bit_rate = video_bits_per_second
    try:
        for frame in frame_data:
            img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = cv2.resize(img, (width, height))
            img_pil = Image.fromarray(img)
            img_av = av.VideoFrame.from_image(img_pil)
            for packet in stream.encode(img_av):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    except Exception as e:
        print(f"编码过程中发生错误: {e}")
        container.close()
        return None
    container.close()
    return bio.getvalue()





ret_cnt = 0
@socketio.on('record')
def handle_recorder(blob):
    global ret_cnt
    with open(f'output{ret_cnt}.webm','wb') as f:
        f.write(blob)

        ret_cnt += 1
    return
    try:
        frame_data = decode(blob)

        # cv2.imshow('frame0', frame_data[0])
        # cv2.waitKey(500)
        # cv2.destroyAllWindows()
        
        
        logger.info(f'Frame count: {len(frame_data)}')
        # 水平翻转
        video = []
        for frame in frame_data:
            video.append(cv2.flip(frame, 1))

        # 发送视频回前端
        emit('video', encode(video))  
  
        # emit('video', frame_data, binary = True)
    except Exception as e:
        logger.error(f'Error in handle_recorder: {e}')  
        raise e



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

@app.route('/stop', methods=['GET'])   
def stop():
    if standard_cap.isOpened():
        standard_cap.release()


if __name__ == '__main__':
    # 每次启动执行cls
    os.system('cls')
    socketio.run(app, debug=True)