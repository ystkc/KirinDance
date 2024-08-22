import av
import cv2
import io
import numpy as np
import time
import logging

logger = logging.getLogger(__name__)

def decode(video_blob) -> list:
    '''将webm格式的视频帧数据解码为帧数据'''
    bio = io.BytesIO(video_blob) 
    if not bio:
        logger.info('Empty recorder data received.')
        return
    logger.info(f'Received recorder data_size: {len(video_blob)}')
    try:
        container = av.open(bio, 'r', format="webm")  # 注意：format参数可以留空，PyAV会尝试自动检测  
    except Exception as e:
        logger.error(f'{e}')
        return
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

if __name__ == '__main__':
    with open("test_video.webm", "rb") as f:
        video_blob = f.read()
    
    frame_data = decode(video_blob)
    print(f'frame_count: {len(frame_data)}')
    # 显示第一帧
    cv2.imshow('frame', frame_data[0])
    cv2.waitKey(0)

    cv2.destroyAllWindows()

