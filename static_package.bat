@echo off
set /p version=Enter version number: 
echo Removing *.map from _site folder...
del /s _site\*.map
echo Building version %version%...
:: Check if spec file exists
if exist "KirinDance Server %version%.spec" (
    echo Spec file found!
    :: Use custom settings
    pyinstaller "KirinDance Server %version%.spec"
) else (
    echo Spec file not found!
    :: Use default settings(with upx and archiev)
    pyinstaller --onefile --name "KirinDance Server %version%" --add-data "_site:." static_server.py
)
echo Done!