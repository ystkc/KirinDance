# 将output0~output4.webm读取到bio对象中，然后用av读取播放
import av
import io

bio = io.BytesIO()
with open('concat.webm','wb') as fout:
    for i in range(5):
        print(i)
        with open(f'output{i}.webm', 'rb') as f:
            fout.write(f.read())
            print(f.tell())  # 输出当前位置
raise
container = av.open(bio)
# 播放
for frame in container.decode(video=0):
    frame.to_image().show()