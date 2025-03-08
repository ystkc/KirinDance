import cv2
import mediapipe as mp

# 初始化多人姿态检测（需配置多实例）
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(min_detection_confidence=0.4, min_tracking_confidence=0.4, model_complexity=1)  # 降低复杂度
cap = cv2.VideoCapture(0)

while True:
    success, image = cap.read()
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = pose.process(image)  # 自动处理多人（需MediaPipe最新版本）
    # 绘制关键点
    if results.pose_landmarks:
        mp.solutions.drawing_utils.draw_landmarks(image, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
    cv2.imshow('Multi-Pose Detection', image)
    if cv2.waitKey(1) == ord('q'):
        break
cap.release()
