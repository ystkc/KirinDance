@echo off
echo 如果出现文件未更新、文件缺失（没有404但是也没有反应），请临时去除--incremental
jekyll serve --disable-disk-cache --incremental