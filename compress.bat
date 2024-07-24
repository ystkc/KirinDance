@echo off
::转2400k 
::ffmpeg -ss 00:00:00 -t 64 -i standard_video.mp4 -b 2400k standard_video_2400k.mp4
::转1080*1440
::ffmpeg -ss 00:00:00 -t 64 -i standard_video.mp4 -b 2400k -vf scale=1440:1080 standard_video_2400k_1080.mp4
::教学：540*720,1600k，去除音频
::ffmpeg -ss 00:00:00 -t 64 -i standard_video.mp4 -b 800k -vf scale=720:540 -an standard_video_800k_540.mp4
::15帧测试
ffmpeg -ss 00:00:00 -t 6 -i standard_video.mp4 -r 15 -b 1600k -vf scale=720:540 -an standard_video_1600k_540_15fps.mp4
