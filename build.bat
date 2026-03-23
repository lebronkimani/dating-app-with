@echo off
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%
cd /d C:\Users\erics\Desktop\globalconnect-dating\android
gradlew.bat assembleDebug
