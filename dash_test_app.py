from flask import Flask, Response, render_template_string
import numpy as np
import cv2
import os
import subprocess
import time

app = Flask(__name__)

# 生成随机噪声视频流
def generate_noise_video():
    frame_rate = 30
    duration = 10  # 视频时长（秒）
    width, height = 640, 480
    total_frames = frame_rate * duration

    for i in range(total_frames):
        frame = np.random.randint(0, 256, (height, width, 3), dtype=np.uint8)
        _, jpeg = cv2.imencode('.jpg', frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n\r\n')

# 路由到视频流
@app.route('/video_feed')
def video_feed():
    return Response(generate_noise_video(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

# 主页路由
@app.route('/')
def index():
    return render_template_string('''
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <title>实时噪声视频</title>
      </head>
      <body>
        <h1>实时噪声视频</h1>
        <img src="{{ url_for('video_feed') }}" width="640" height="480">
      </body>
    </html>
    ''')

if __name__ == '__main__':
    app.run(debug=True, host='192.168.1.114', port=5000)
