$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\erics\AppData\Local\Android\Sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
Set-Location "C:\Users\erics\Desktop\globalconnect-dating\android"
& ".\gradlew.bat" assembleDebug
