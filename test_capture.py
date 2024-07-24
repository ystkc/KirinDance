import cv2
 
capture = cv2.VideoCapture(0)   # 打开笔记本内置摄像头
while capture.isOpened():      # 笔记本摄像头被打开
    retval, image = capture.read()  # 从摄像头中实时读取画面
    cv2.imshow("Video", image)  # 在窗口显示读取到的视频
    key = cv2.waitKey(1)     # 等待用户按下键盘按键的时间为1毫秒
    if key == 32:        # 如果按键为空格，就跳出循环
        break
capture.release()   # 关闭摄像头
cv2.destroyAllWindows()    # 销毁窗口