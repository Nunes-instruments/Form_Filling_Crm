@echo off
setlocal EnableDelayedExpansion
echo Stopping NUNES local services...
for %%P in (5055 5056 8770 8785 8786 8787 8788 8789 8790 8791 8792 8793 8794 8795 8865 8866 8867 8868 8869 8870 8871 8872 8873 8874 8875) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do taskkill /PID %%I /T /F >nul 2>&1
)
echo Done.
pause
