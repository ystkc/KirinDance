import cv2  
import numpy as np  
import av
import io
from PIL import Image
  
def encode_frames_to_webm(frames, output_filename, fps=30, width=None, height=None):  
    """  
    将一系列RGB帧编码为WebM格式的视频文件。  
  
    参数:  
    frames (list of np.ndarray): RGB帧的列表，每个帧的形状为(height, width, 3)。  
    output_filename (str): 输出视频文件的名称。  
    fps (int): 视频的帧率。  
    width, height (int): 视频的宽度和高度（如果frames中的帧尺寸不一致，则需要指定）。  
  
    注意：  
    如果frames中的帧尺寸不一致，且未指定width和height，则会引发错误。  
    """  
    # 如果未指定宽度和高度，则从第一个帧中获取  
    if width is None or height is None:  
        if len(frames) == 0:  
            raise ValueError("需要至少一个帧来确定尺寸，或者手动指定width和height")  
        width, height, _ = frames[0].shape  
  
    # 创建一个VideoWriter对象来写入视频  
    fourcc = cv2.VideoWriter_fourcc(*'VP80')  # 或者尝试 'VP90' 如果您的OpenCV支持  
    out = cv2.VideoWriter(output_filename, fourcc, fps, (width, height))  
  
    # 遍历所有帧并写入视频  
    for frame in frames:  
        # 注意：OpenCV使用BGR格式，而不是RGB  
        frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)  
        out.write(frame)  
  
    # 释放资源  
    out.release() 
import io
import av
import cv2
from PIL import Image

standard_frame_rate = 30  # 示例值
width = 640  # 示例值
height = 480  # 示例值
video_bits_per_second = 1000000  # 示例值

def encode(frame_data):
    '''将帧数据编码为webm格式'''
    bio = io.BytesIO()
    container = av.open(bio, 'w', format='webm')  # 修改容器格式为 'webm'
    stream = container.add_stream('libvpx-vp9', rate=standard_frame_rate)
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


# 示例用法  
if __name__ == "__main__":  
    # 假设我们有一些RGB帧（这里用随机数据模拟）  
    frames = [np.random.randint(0, 256, (480, 640, 3), dtype=np.uint8) for _ in range(10)]  
  
    # 编码为WebM视频  
    with open('output.webm', 'wb') as f:  
        f.write(encode(frames))