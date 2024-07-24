@echo off
::转2400k 
::ffmpeg -ss 00:00:00 -t 64 -i standard_video.mp4 -b 2400k standard_video_2400k.mp4
::转1080*1440
::ffmpeg -ss 00:00:00 -t 64 -i standard_video.mp4 -b 2400k -vf scale=1440:1080 standard_video_2400k_1080.mp4
::转540*720,800k
ffmpeg -ss 00:00:00 -t 6 -i standard_video.mp4 -b 800k -vf scale=720:540 standard_video_800k_540.mp4