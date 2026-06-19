@echo off
echo 正在清除 Vite 缓存...
if exist node_modules\.vite (
    rmdir /s /q node_modules\.vite
    echo Vite 缓存已清除
) else (
    echo Vite 缓存目录不存在
)

echo.
echo 正在清除 dist 目录...
if exist dist (
    rmdir /s /q dist
    echo dist 目录已清除
) else (
    echo dist 目录不存在
)

echo.
echo 缓存清除完成！
pause
